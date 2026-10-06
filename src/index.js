// ============================================================
// Mami IA v3.5 — Point d'entrée principal du serveur
//
// Modèle : Audiotel SVA — facturation opérateur.
// v3.5 : formbody retiré — parsing géré dans callStart.js
//        pour permettre la validation signature Twilio sur raw body.
// ============================================================

import 'dotenv/config'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
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
  trustProxy: true
})

// ── Plugins ───────────────────────────────────────────────────
// Note : pas de fastifyFormbody ici — callStart.js gère son propre parsing
await app.register(fastifyWebsocket)

// ── Rate limiter global ───────────────────────────────────────
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

// ── Rate limiter spécifique /call/start ───────────────────────
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
app.register(callStreamRoute)
app.register(callStatusRoute)

// ── Health check ──────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok',
  service: 'Mami IA',
  version: '3.5.0',
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
  app.log.info(`🟢 Mami IA v3.5 démarré — port ${PORT}`)
  app.log.info(`📞 Modèle : Audiotel SVA (facturation opérateur)`)
  app.log.info(`🛡️ Limite de débit : 60 req/min global, ${process.env.MAX_CONCURRENT_CALLS || 50} req/min sur /call/start`)
  app.log.info(`🔐 Signature Twilio : ${process.env.NODE_ENV === 'production' ? 'ACTIVÉE' : 'désactivée (dev)'}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

