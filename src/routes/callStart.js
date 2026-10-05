// ============================================================
// Mami IA v3.2 — Route POST /call/start
//
// Reçoit le webhook Twilio à chaque appel entrant,
// valide la signature, filtre les fraudes, démarre ConversationRelay.
// ============================================================

import twilio from 'twilio'
import { createSession } from '../sessions.js'

const { validateRequest } = twilio

// ── Anti-fraude ───────────────────────────────────────────
const activeCallsPerNumber = new Map()   // from → Set<callSid>
const recentCalls          = new Map()   // from → timestamp dernier appel

// Fix audit #1 : exports pour callStatus.js
export function incrementCallCount(from, callSid) {
  if (!activeCallsPerNumber.has(from)) activeCallsPerNumber.set(from, new Set())
  activeCallsPerNumber.get(from).add(callSid)
}

export function decrementCallCount(from, callSid) {
  const set = activeCallsPerNumber.get(from)
  if (!set) return
  set.delete(callSid)
  if (set.size === 0) activeCallsPerNumber.delete(from)
}

export function clearRecentCall(from) {
  recentCalls.delete(from)
}

// ── Préfixes autorisés ────────────────────────────────────
// Fix audit #2 : externalisation en variable (plus maintenable)
const ALLOWED_PREFIXES = (process.env.ALLOWED_PREFIXES || '+33,+32,+41,+352').split(',')

export async function callStartRoute(fastify) {
  fastify.post('/call/start', async (req, reply) => {

    // Fix audit #8 : body passé directement sans spread pour préserver l'ordre des clés
    // (le HMAC Twilio est calculé sur les paramètres dans l'ordre reçu)
    const body = req.body

    // ── Validation signature Twilio ────────────────────────
    if (process.env.NODE_ENV === 'production') {
      // Fix audit #5 : argument order correct (authToken, signature, url, body)
      const valid = validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        req.headers['x-twilio-signature'] || '',
        `${(process.env.APP_URL || '').replace(/\/$/, '')}/call/start`,
        body
      )
      if (!valid) {
        fastify.log.warn({ ip: req.ip }, '🚨 Signature Twilio invalide')
        return reply.code(403).send(twimlReject('signature_invalide'))
      }
    }

    const from     = body?.From     || ''
    const callSid  = body?.CallSid  || ''
    const to       = body?.To       || ''

    if (!from || !callSid) {
      return reply.code(400).send(twimlReject('parametres_manquants'))
    }

    // ── Filtrage préfixes internationaux non autorisés ─────
    const allowed = ALLOWED_PREFIXES.some(p => from.startsWith(p))
    if (!allowed) {
      fastify.log.warn({ from }, '🚫 Préfixe non autorisé')
      return reply.code(200).type('text/xml').send(twimlReject('prefixe_non_autorise'))
    }

    // ── Limite appels simultanés par numéro ───────────────
    const maxPerNumber = parseInt(process.env.MAX_CALLS_PER_NUMBER || '2')
    const activeCalls  = activeCallsPerNumber.get(from)?.size || 0
    if (activeCalls >= maxPerNumber) {
      fastify.log.warn({ from, activeCalls }, '🚫 Trop d\'appels simultanés')
      return reply.code(200).type('text/xml').send(twimlReject('trop_d_appels'))
    }

    // ── Anti-double-appel rapide ───────────────────────────
    const lastCall = recentCalls.get(from) || 0
    const cooldown = parseInt(process.env.CALL_COOLDOWN_MS || '3000')
    if (Date.now() - lastCall < cooldown) {
      fastify.log.warn({ from }, '🚫 Appel trop rapide (anti-boucle)')
      return reply.code(200).type('text/xml').send(twimlReject('appel_trop_rapide'))
    }
    recentCalls.set(from, Date.now())

    // ── Création session ───────────────────────────────────
    createSession(callSid, { from, to, llmUsed: process.env.LLM_MODEL || 'gpt-4o' })
    incrementCallCount(from, callSid)
    fastify.log.info({ callSid, from }, '📞 Appel entrant — session créée')

    // ── TwiML ConversationRelay ────────────────────────────
    // Fix audit #7 : APP_URL nettoyé du slash final
    const appUrl  = (process.env.APP_URL || '').replace(/\/$/, '')
    const wsUrl   = appUrl.replace(/^https/, 'wss') + '/call/stream'

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" welcomeGreeting="Bonjour, je suis Mami, votre assistante IA. Comment puis-je vous aider ?" language="fr-FR" voice="Google.fr-FR-Standard-A" />
  </Connect>
</Response>`

    return reply.code(200).type('text/xml').send(twiml)
  })
}

// ── Helper TwiML rejet vocal ───────────────────────────────
// Fix audit #6 : utilise le paramètre reason avec messages distincts
function twimlReject(reason) {
  const messages = {
    signature_invalide:    'Cette ligne est réservée à nos partenaires agréés. Merci.',
    parametres_manquants:  'Appel non reconnu. Merci de réessayer.',
    prefixe_non_autorise:  'Ce service est disponible uniquement depuis la France et les pays francophones limitrophes.',
    trop_d_appels:         'Vous avez déjà plusieurs appels en cours. Merci de patienter avant de rappeler.',
    appel_trop_rapide:     'Merci de patienter quelques secondes avant de rappeler.'
  }
  const msg = messages[reason] || 'Service temporairement indisponible. Merci de réessayer.'
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-FR" voice="Google.fr-FR-Standard-A">${msg}</Say>
  <Hangup/>
</Response>`
}
