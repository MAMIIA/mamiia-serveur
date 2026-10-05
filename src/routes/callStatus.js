// ============================================================
// Mami IA v3.2 — Route POST /call/status
//
// Reçoit les callbacks de statut Twilio après raccrochage.
// Nettoie la session et les compteurs anti-fraude.
// ============================================================

import { deleteSession } from '../sessions.js'
import { decrementCallCount, clearRecentCall } from './callStart.js'

const FINAL_STATUSES = ['completed', 'busy', 'no-answer', 'canceled', 'failed']

export async function callStatusRoute(fastify) {
  fastify.post('/call/status', async (req, reply) => {
    const { CallSid, CallStatus, From, CallDuration } = req.body || {}

    fastify.log.info({ CallSid, CallStatus, CallDuration }, '📊 Statut appel')

    if (CallSid && FINAL_STATUSES.includes(CallStatus)) {
      deleteSession(CallSid)
      if (From) {
        decrementCallCount(From, CallSid)
        clearRecentCall(From)
      }
      fastify.log.info({ CallSid, CallStatus }, '🧹 Session nettoyée')
    }

    return reply.code(200).send()
  })
}
