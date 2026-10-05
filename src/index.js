// ============================================================
// Mami IA v3.2 — Point d'entrée principal du serveur
//
// Modèle : Audiotel SVA — facturation opérateur.
// Ce serveur fait une seule chose : orchestrer la voix et le LLM.
//
// Sécurité v3.2 :
//   - Rate limiter @fastify/rate-limit (anti-DDoS, anti-webhook-spoofing)
//   - Validation signature Twilio en production
//   - Blocage numéros suspects (préfixes internationaux non autorisés)
//   - Limite d'appels simultanés par numéro source
// ============================================================

import 'dotenv/config'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyFormbody from '@fastify/formbody'
import fastifyRateLimit from '@fastify/rate-limit'

import { callStartRoute } from './routes/callStart.js'
import { callStreamRoute } from './routes/callStream.js'
import { callStatusRoute } from './routes/callStatus.js'

const PORT = parseInt(process.env.PORT || '3000')

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined
  },
  trustProxy: true  // Railway est derrière un reverse proxy
})

// ── Plugins ───────────────────────────────────────────────────
await app.register(fastifyFormbody)
await app.register(fastifyWebsocket)

// ── Rate limiter global — anti-DDoS et anti-webhook-spoofing ──
// Twilio n'envoie jamais plus de quelques requêtes/seconde par numéro.
// Un flood = attaque. Blocage à 60 req/min par IP.
await app.register(fastifyRateLimit, {
  global: true,
  max: 60,
  timeWindow: '1 minute',
  ban: 5,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded'
  }),
  keyGenerator: (request) => {
    return request.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || request.socket?.remoteAddress
      || 'unknown'
  },
  onBanHook: (request, key) => {
    app.log.warn({ key }, '🚨 IP temporairement bannie — flood détecté')
  }
})

// ── Rate limiter spécifique /call/start — plus strict ────────
await app.register(async (instance) => {
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

// ── Routes ────────────────────────────────────────────────────
app.register(callStreamRoute)  // WS /call/stream → ConversationRelay
app.register(callStatusRoute)  // POST /call/status → nettoyage + logs

// ── Health check ──────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok',
  service: 'Mami IA',
  version: '3.2.0',
  uptime: Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development'
}))

// ── Gestionnaire d'erreurs global ────────────────────────────
app.setErrorHandler((err, request, reply) => {
  app.log.error({ err, url: request.url }, '❌ Erreur non gérée')
  reply.code(err.statusCode || 500).send({
    error: process.env.NODE_ENV === 'production' ? 'Erreur serveur interne' : err.message
  })
})

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  app.log.info(`🟢 Mami IA v3.2 démarré — port ${PORT}`)
  app.log.info(`📞 Modèle : Audiotel SVA (facturation opérateur)`)
  app.log.info(`🛡️ Limite de débit : 60 req/min global, ${process.env.MAX_CONCURRENT_CALLS || 50} req/min sur /call/start`)
  app.log.info(`🔐 Signature Twilio : ${process.env.NODE_ENV === 'production' ? 'ACTIVÉE' : 'désactivée (dev)'}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
