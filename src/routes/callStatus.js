// ============================================================
// Mami IA v3.5 — Route POST /call/status
//
// Parser form-urlencoded ici directement (formbody retiré
// de index.js en v3.5 — chaque route gère son propre parsing)
// ============================================================

import { deleteSession } from '../sessions.js'
import { decrementCallCount, clearRecentCall } from './callStart.js'

export async function callStatusRoute(fastify) {

  // Parser form-urlencoded — identique à callStart.js
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      const parsed = {}
      for (const pair of (body || '').split('&')) {
        const idx = pair.indexOf('=')
        if (idx === -1) continue
        const key   = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))
        const value = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '))
        parsed[key] = value
      }
      done(null, parsed)
    }
  )

  fastify.post('/call/status', async (req, reply) => {
    const body       = req.body || {}
    const callSid    = body.CallSid    || ''
    const callStatus = body.CallStatus || ''
    const duration   = body.CallDuration || '0'
    const from       = body.From || ''

    fastify.log.info({ CallSid: callSid, CallStatus: callStatus, CallDuration: duration }, '📊 Statut appel')

    const terminalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled']
    if (terminalStatuses.includes(callStatus)) {
      deleteSession(callSid)
      if (from) {
        decrementCallCount(from, callSid)
        clearRecentCall(from)
      }
      fastify.log.info({ CallSid: callSid, CallStatus: callStatus }, '🧹 Session nettoyée')
    }

    return reply.code(200).send('')
  })
}

