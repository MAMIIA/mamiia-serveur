// ============================================================
// MAMI IA v3.1 — Serveur principal
// Modèle Audiotel : l'opérateur SVA gère la facturation.
// Ce serveur ne fait qu'une chose : orchestrer la voix et les LLMs.
//
// Sécurité v3.1 :
//   - Rate limiter @fastify/rate-limit (anti-DDoS, anti-webhook-spoofing)
//   - Validation signature Twilio en production
//   - Blocage numéros suspects (préfixes internationaux non autorisés)
//   - Limite d'appels simultanés par numéro source
// ============================================================

import 'dotenv/config'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyFormBody from '@fastify/formbody'
import fastifyRateLimit from '@fastify/rate-limit'

import { callStartRoute } from './routes/callStart.js'
import { callStreamRoute } from './routes/callStream.js'
import { callStatusRoute } from './routes/callStatus.js'

const PORT = parseInt(process.env.PORT || '3000')

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined
  },
  trustProxy: true  // Railway est derrière un reverse proxy
})

// ── Plugins ────────────────────────────────────────────────
await fastify.register(fastifyFormBody)
await fastify.register(fastifyWebsocket)

// ── Rate Limiter global — anti-DDoS & anti-webhook-spoofing ──
// Twilio n'envoie jamais plus de quelques requêtes par seconde
// par numéro. Un flood = attaque. On bloque à 60 req/min par IP.
await fastify.register(fastifyRateLimit, {
  global: true,
  max: 60,                    // max 60 requêtes par fenêtre
  timeWindow: '1 minute',
  ban: 5,                     // ban temporaire après 5 dépassements consécutifs
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded'
  }),
  keyGenerator: (req) => {
    // Clé par IP source (Railway transmet l'IP réelle via x-forwarded-for)
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown'
  },
  onBanHook: (req, key) => {
    fastify.log.warn({ key }, '🚨 IP bannie temporairement — flood détecté')
  }
})

// ── Rate Limiter spécifique /call/start — plus strict ─────
// /call/start est l'endpoint le plus sensible (consomme OpenAI)
// Twilio n'appellera jamais plus de N fois/min depuis une même IP
// N = ton nombre d'appels simultanés maximum attendu
fastify.register(async (instance) => {
  await instance.register(fastifyRateLimit, {
    max: parseInt(process.env.MAX_CONCURRENT_CALLS || '50'),
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Call rate limit exceeded'
    })
  })
  instance.register(callStartRoute)
})

// ── Routes normales ────────────────────────────────────────
fastify.register(callStreamRoute)  // WS   /call/stream → ConversationRelay
fastify.register(callStatusRoute)  // POST /call/status → logs

// ── Healthcheck ────────────────────────────────────────────
fastify.get('/health', async () => ({
  status: 'ok',
  service: 'Mami IA',
  version: '3.1.0',
  uptime: Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
  env: process.env.NODE_ENV || 'development'
}))

// ── Handler global d'erreurs non catchées ─────────────────
fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error({ err, url: req.url }, '❌ Erreur non catchée')
  reply.code(err.statusCode || 500).send({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  })
})

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  fastify.log.info(`🎙️  Mami IA v3.1 démarré — port ${PORT}`)
  fastify.log.info(`📞  Modèle : Audiotel SVA (facturation opérateur)`)
  fastify.log.info(`🛡️  Rate limiter : 60 req/min global, ${process.env.MAX_CONCURRENT_CALLS || 50} req/min sur /call/start`)
  fastify.log.info(`🔒  Signature Twilio : ${process.env.NODE_ENV === 'production' ? 'ACTIVÉE' : 'désactivée (dev)'}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
