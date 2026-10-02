// ============================================================
// MAMI IA v3.1 — Main server entry point
//
// Model: Audiotel SVA — operator handles billing.
// This server does one thing: orchestrate voice and LLMs.
//
// Security v3.1:
//   - Rate limiter @fastify/rate-limit (anti-DDoS, anti-webhook-spoofing)
//   - Twilio signature validation in production
//   - Suspicious number blocking (unauthorized international prefixes)
//   - Concurrent call limit per source number
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
  trustProxy: true  // Railway is behind a reverse proxy
})

// ── Plugins ──────────────────────────────────────────────────
await app.register(fastifyFormbody)
await app.register(fastifyWebsocket)

// ── Global rate limiter — anti-DDoS and anti-webhook-spoofing
// Twilio never sends more than a few requests per second per number.
// A flood = attack. Block at 60 req/min per IP.
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
    // Key by source IP (Railway forwards real IP via x-forwarded-for)
    return request.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || request.socket?.remoteAddress
      || 'unknown'
  },
  onBanHook: (request, key) => {
    app.log.warn({ key }, '🚨 IP temporarily banned — flood detection')
  }
})

// ── Specific rate limiter for /call/start — stricter ─────────
// /call/start is the most sensitive endpoint (consumes OpenAI)
// Twilio will never call more than N times/min from the same IP
// N = your expected maximum simultaneous calls
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

// ── Normal routes ─────────────────────────────────────────────
app.register(callStreamRoute)  // WS /call/stream → ConversationRelay
app.register(callStatusRoute)  // POST /call/status → logs

// ── Health check ──────────────────────────────────────────────
app.get('/health', async () => ({
  status: 'ok',
  service: 'Mami IA',
  version: '3.1.0',
  uptime: Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development'
}))

// ── Global uncaught error handler ────────────────────────────
app.setErrorHandler((err, request, reply) => {
  app.log.error({ err, url: request.url }, '❌ Uncaught error')
  reply.code(err.statusCode || 500).send({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  })
})

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  app.log.info(`🟢 Mami IA v3.1 started — port ${PORT}`)
  app.log.info(`📞 Model: Audiotel SVA (operator billing)`)
  app.log.info(`🛡️ Rate limit: 60 req/min global, ${process.env.MAX_CONCURRENT_CALLS || 50} req/min on /call/start`)
  app.log.info(`🔐 Twilio signature: ${process.env.NODE_ENV === 'production' ? 'ENABLED' : 'disabled (dev)'}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
