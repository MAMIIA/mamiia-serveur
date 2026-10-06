// ============================================================
// Mami IA v3.5 — Route POST /call/start
//
// Parsing géré ici directement via addContentTypeParser.
// @fastify/formbody retiré de index.js — plus de conflit.
//
// Validation Twilio : HMAC-SHA1 sur raw body (non décodé)
// pour que les valeurs URL-encoded soient signées exactement
// comme Twilio les a envoyées.
// ============================================================

import crypto from 'crypto'
import { createSession } from '../sessions.js'

const activeCallsPerNumber = new Map()
const recentCalls          = new Map()

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

const ALLOWED_PREFIXES = (process.env.ALLOWED_PREFIXES || '+33,+32,+41,+352').split(',')

/**
 * Validation Twilio sur le raw body (avant décodage URL)
 * Twilio signe la chaîne : URL + params triés + valeurs tels qu'encodés
 * Référence : https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function validateTwilioRaw(authToken, signature, url, rawBody) {
  try {
    const params = {}
    for (const pair of rawBody.split('&')) {
      const idx = pair.indexOf('=')
      if (idx === -1) continue
      const key = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))
      const val = pair.slice(idx + 1) // valeur NON décodée — telle que Twilio l'a signée
      params[key] = val
    }

    const sorted = Object.keys(params).sort()
    let s = url
    for (const key of sorted) {
      s += key + (params[key] ?? '')
    }

    const expected = crypto
      .createHmac('sha1', authToken)
      .update(Buffer.from(s, 'utf-8'))
      .digest('base64')

    if (expected.length !== signature.length) return false

    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    )
  } catch {
    return false
  }
}

export async function callStartRoute(fastify) {

  // Parser le raw body nous-mêmes — @fastify/formbody retiré de index.js
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      req.rawBody = body

      // Parser aussi pour que req.body soit disponible normalement
      const parsed = {}
      for (const pair of body.split('&')) {
        const idx = pair.indexOf('=')
        if (idx === -1) continue
        const key   = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))
        const value = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '))
        parsed[key] = value
      }
      done(null, parsed)
    }
  )

  fastify.post('/call/start', async (req, reply) => {

    const body    = req.body    || {}
    const rawBody = req.rawBody || ''

    const skipValidation = process.env.TWILIO_SKIP_VALIDATION === 'true'

    if (process.env.NODE_ENV === 'production' && !skipValidation) {
      const authToken = process.env.TWILIO_AUTH_TOKEN || ''
      const signature = req.headers['x-twilio-signature'] || ''
      const appUrl    = (process.env.APP_URL || '').replace(/\/$/, '')
      const url       = `${appUrl}/call/start`

      fastify.log.debug({ url, signatureLen: signature.length, rawBodyLen: rawBody.length }, '🔐 Validation Twilio')

      const valid = validateTwilioRaw(authToken, signature, url, rawBody)

      if (!valid) {
        fastify.log.warn({ ip: req.ip }, '🚨 Signature Twilio invalide')
        return reply.code(403).send(twimlReject('signature_invalide'))
      }
    }

    const from    = body.From    || ''
    const callSid = body.CallSid || ''
    const to      = body.To      || ''

    if (!from || !callSid) {
      fastify.log.warn({ body }, '⚠️ Paramètres manquants')
      return reply.code(400).send(twimlReject('parametres_manquants'))
    }

    const allowed = ALLOWED_PREFIXES.some(p => from.startsWith(p))
    if (!allowed) {
      fastify.log.warn({ from }, '🚫 Préfixe non autorisé')
      return reply.code(200).type('text/xml').send(twimlReject('prefixe_non_autorise'))
    }

    const maxPerNumber = parseInt(process.env.MAX_CALLS_PER_NUMBER || '2')
    const activeCalls  = activeCallsPerNumber.get(from)?.size || 0
    if (activeCalls >= maxPerNumber) {
      fastify.log.warn({ from, activeCalls }, '🚫 Trop d\'appels simultanés')
      return reply.code(200).type('text/xml').send(twimlReject('trop_d_appels'))
    }

    const lastCall = recentCalls.get(from) || 0
    const cooldown = parseInt(process.env.CALL_COOLDOWN_MS || '3000')
    if (Date.now() - lastCall < cooldown) {
      fastify.log.warn({ from }, '🚫 Appel trop rapide (anti-boucle)')
      return reply.code(200).type('text/xml').send(twimlReject('appel_trop_rapide'))
    }
    recentCalls.set(from, Date.now())

    createSession(callSid, { from, to, llmUsed: process.env.LLM_MODEL || 'gpt-4o' })
    incrementCallCount(from, callSid)
    fastify.log.info({ callSid, from }, '📞 Appel entrant — session créée')

    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
    const wsUrl  = appUrl.replace(/^https/, 'wss') + '/call/stream'

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" welcomeGreeting="Bonjour, je suis Mami, votre assistante IA. Comment puis-je vous aider ?" language="fr-FR" voice="Google.fr-FR-Standard-A" />
  </Connect>
</Response>`

    return reply.code(200).type('text/xml').send(twiml)
  })
}

function twimlReject(reason) {
  const messages = {
    signature_invalide:   'Cette ligne est réservée à nos partenaires agréés. Merci.',
    parametres_manquants: 'Appel non reconnu. Merci de réessayer.',
    prefixe_non_autorise: 'Ce service est disponible uniquement depuis la France et les pays francophones limitrophes.',
    trop_d_appels:        'Vous avez déjà plusieurs appels en cours. Merci de patienter avant de rappeler.',
    appel_trop_rapide:    'Merci de patienter quelques secondes avant de rappeler.'
  }
  const msg = messages[reason] || 'Service temporairement indisponible. Merci de réessayer.'
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-FR" voice="Google.fr-FR-Standard-A">${msg}</Say>
  <Hangup/>
</Response>`
}

