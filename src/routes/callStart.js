// ============================================================
// MAMI IA v3.1 — POST /call/start
//
// TwiML : MGIT obligatoire ARCEP, connexion directe à Mami.
//
// Sécurité v3.1 :
//   - Validation signature Twilio (production)
//   - Filtre numéros suspects (préfixes internationaux, anonymes)
//   - Limite d'appels simultanés par numéro source (anti-toll-fraud)
//   - Blocage appels trop fréquents depuis un même numéro
// ============================================================

import twilio from 'twilio'
import { createSession, getActiveSessions } from '../sessions.js'

const { validateRequest } = twilio

// ── Prefixes autorisés ────────────────────────────────────
const ALLOWED_PREFIXES = [
  '+33',  // France métropolitaine
  '+590', // Guadeloupe
  '+594', // Guyane
  '+596', // Martinique
  '+262', // Réunion / Mayotte
  '+687', // Nouvelle-Calédonie
  '+689', // Polynésie française
]

// ── Numéros masqués / anonymes ────────────────────────────
const BLOCKED_NUMBERS = [
  'anonymous',
  'restricted',
  'unknown',
  '+266696687',
]

// ── Anti-toll-fraud : max appels simultanés par numéro ────
const callsPerNumber = new Map()
const MAX_CALLS_PER_NUMBER = parseInt(process.env.MAX_CALLS_PER_NUMBER || '2')

setInterval(() => callsPerNumber.clear(), 5 * 60 * 1000)

// ── Anti-rappel trop fréquent ─────────────────────────────
const recentCalls = new Map()
const MIN_CALL_INTERVAL_MS = parseInt(process.env.MIN_CALL_INTERVAL_MS || '30000')

setInterval(() => recentCalls.clear(), 10 * 60 * 1000)

function isSuspicious(from) {
  const f = (from || '').toLowerCase().trim()
  if (BLOCKED_NUMBERS.some(b => f.includes(b))) return 'anonymous'
  if (f.startsWith('+') && !ALLOWED_PREFIXES.some(p => f.startsWith(p))) return 'international'
  return null
}

function twimlReject(reason) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-FR" voice="Polly.Lea">
    Nous sommes désolés, ce service n'est pas disponible depuis votre ligne. Au revoir.
  </Say>
  <Hangup/>
</Response>`
}

const MGIT = `Bienvenue sur Mami IA.
Ce service est facturé zéro virgule soixante euros par minute, soit le coût d'un appel local en sus.
Ce service est réservé aux personnes majeures.
Vous pouvez raccrocher sans frais maintenant.`

const WELCOME = `Bonjour ! Je suis Mami, votre assistante IA. Comment puis-je vous aider ?`

export async function callStartRoute(fastify) {
  fastify.post('/call/start', async (req, reply) => {

    // ── 1. Validation signature Twilio (production) ────────
    if (process.env.NODE_ENV === 'production') {
      const body = (req.body && typeof req.body === 'object') ? { ...req.body } : {}
      const valid = validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        req.headers['x-twilio-signature'] || '',
        `${process.env.APP_URL}/call/start`,
        body
      )
      if (!valid) {
        fastify.log.warn({ ip: req.ip }, '🚨 Signature Twilio invalide — webhook spoofing probable')
        return reply.code(403).send('Forbidden')
      }
    }

    const callSid = req.body?.CallSid || ''
    const from    = (req.body?.From || '').trim() || 'inconnu'

    // ── 2. Filtre numéros suspects ─────────────────────────
    const suspicionReason = isSuspicious(from)
    if (suspicionReason) {
      fastify.log.warn({ callSid, from, reason: suspicionReason }, '🚫 Appel suspect bloqué')
      return reply.type('text/xml').send(twimlReject(suspicionReason))
    }

    // ── 3. Anti-rappel trop fréquent (anti-bot) ───────────
    const lastCall = recentCalls.get(from)
    const now = Date.now()
    if (lastCall && (now - lastCall) < MIN_CALL_INTERVAL_MS) {
      fastify.log.warn({ callSid, from, gap: now - lastCall }, '⏱️ Rappel trop fréquent bloqué')
      return reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-FR" voice="Polly.Lea">
    Merci de patienter quelques instants avant de rappeler. Au revoir.
  </Say>
  <Hangup/>
</Response>`)
    }
    recentCalls.set(from, now)

    // ── 4. Anti-toll-fraud : appels simultanés par numéro ─
    const activeCalls = callsPerNumber.get(from) || 0
    if (activeCalls >= MAX_CALLS_PER_NUMBER) {
      fastify.log.warn({ callSid, from, activeCalls }, '🚫 Trop d\'appels simultanés depuis ce numéro')
      return reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-FR" voice="Polly.Lea">
    Un appel est déjà en cours depuis votre ligne. Merci de patienter. Au revoir.
  </Say>
  <Hangup/>
</Response>`)
    }
    callsPerNumber.set(from, activeCalls + 1)

    req.raw.on('close', () => {
      const current = callsPerNumber.get(from) || 1
      if (current <= 1) callsPerNumber.delete(from)
      else callsPerNumber.set(from, current - 1)
    })

    fastify.log.info({ callSid, from, activeSessions: getActiveSessions() }, '📞 Appel entrant autorisé')
    createSession({ callSid, from })

    const appUrl = process.env.APP_URL || ''
    const wsUrl = appUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/call/stream'

    reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>

  <!-- MGIT obligatoire ARCEP — diffusé AVANT facturation -->
  <Say language="fr-FR" voice="Polly.Lea">${MGIT}</Say>
  <Pause length="1"/>

  <!-- Connexion directe à Mami IA -->
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${WELCOME}"
      language="fr-FR"
      ttsProvider="google"
      voice="fr-FR-Wavenet-A"
      transcriptionProvider="deepgram"
      speechModel="nova-2"
      interruptByDtmf="false"
      interruptOnCustomerSpeech="true"
    />
  </Connect>

</Response>`)
  })
}
