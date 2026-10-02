// ============================================================
// MAMI IA v2 — POST /call/status
// Webhook Twilio de fin d'appel.
// Sans base de données, on logue simplement les métriques.
// En production, brancher ici un service analytics (Mixpanel, etc.)
// ============================================================

import { deleteSession } from '../sessions.js'

export async function callStatusRoute(fastify) {
  fastify.post('/call/status', async (req, reply) => {
    const {
      CallSid,
      CallStatus,
      CallDuration,  // durée en secondes fournie par Twilio
      From,
      To
    } = req.body

    fastify.log.info({
      callSid: CallSid,
      status: CallStatus,
      duration: `${CallDuration}s`,
      from: From,
      to: To
    }, '📊 Statut appel')

    // Nettoyer la session si elle existe encore
    if (CallSid) deleteSession(CallSid)

    // ── Analytics (à brancher en Phase 2) ─────────────────
    // Exemples de métriques utiles à logger :
    // - Durée moyenne par appel
    // - LLM le plus choisi
    // - Heure de pointe
    // → Mixpanel / Amplitude / simple fichier CSV

    reply.send('OK')
  })
}
