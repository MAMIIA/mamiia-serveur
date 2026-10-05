// ============================================================
// Mami IA v3.2 — WS /call/stream
//
// L'appelant est connecté directement à Mami dès le début
// de la conversation via Twilio ConversationRelay.
// ============================================================

import {
  getSession, updateSession, appendHistory,
  deleteSession, getActiveSessions
} from '../sessions.js'
import { streamFromLLM } from '../llm/router.js'

// Fix audit #4 : constantes explicites pour la lisibilité
const MAX_CALL_DURATION_MINUTES  = parseInt(process.env.MAX_CALL_DURATION_MINUTES  || '30')
const WARNING_MINUTES_REMAINING  = parseInt(process.env.WARNING_MINUTES_REMAINING  || '5')
const MAX_MS  = MAX_CALL_DURATION_MINUTES * 60 * 1000
const WARN_MS = (MAX_CALL_DURATION_MINUTES - WARNING_MINUTES_REMAINING) * 60 * 1000

export async function callStreamRoute(fastify) {
  fastify.get('/call/stream', { websocket: true }, async (socket) => {

    let callSid      = null
    let durationTimer = null
    let warnTimer     = null

    fastify.log.info(`🔌 WebSocket ouvert — sessions actives : ${getActiveSessions()}`)

    socket.on('message', async (raw) => {
      let event
      try { event = JSON.parse(raw.toString()) } catch { return }

      switch (event.type) {

        // ── Setup : session initialisée ──────────────────
        case 'setup': {
          callSid = event.callSid
          fastify.log.info({ callSid }, '✅ Session prête')

          // Coupure à 30 min (ARCEP)
          durationTimer = setTimeout(() => {
            send(socket, 'Vous avez atteint la durée maximale de trente minutes. Merci d\'avoir utilisé Mami IA. À bientôt !')
            setTimeout(() => socket.close(), 4000)
          }, MAX_MS)

          // Avertissement à 5 min de la fin
          warnTimer = setTimeout(() => {
            send(socket, 'Information : il vous reste cinq minutes de communication.')
          }, WARN_MS)

          break
        }

        // ── Prompt : question de l'appelant ─────────────
        case 'prompt': {
          const session = getSession(callSid)
          if (!session) return

          const text = (event.voicePrompt || '').trim()
          if (!text) return

          fastify.log.info({ callSid, text }, '🗣️  Question')
          await handleQuery(socket, callSid, session, text, fastify)
          break
        }

        // ── Interruption : l'appelant coupe la réponse ──
        case 'interrupt': {
          socket.send(JSON.stringify({ type: 'clear' }))
          fastify.log.info({ callSid }, '✋ Interruption')
          break
        }

        // ── Fin d'appel ──────────────────────────────────
        case 'end': {
          fastify.log.info({ callSid }, '📴 Fin d\'appel')
          cleanup()
          break
        }
      }
    })

    socket.on('close', () => { fastify.log.info({ callSid }, '🔌 WebSocket fermé'); cleanup() })
    socket.on('error', (err) => { fastify.log.error({ callSid, err }); cleanup() })

    function cleanup() {
      if (durationTimer) { clearTimeout(durationTimer); durationTimer = null }
      if (warnTimer)     { clearTimeout(warnTimer);     warnTimer = null }
      if (callSid)       deleteSession(callSid)
    }
  })
}

// ── Envoie la question au LLM et streame la réponse ───────
async function handleQuery(socket, callSid, session, userText, fastify) {
  appendHistory(callSid, 'user', userText)

  const fresh = getSession(callSid)
  if (!fresh) return

  let fullResponse = ''

  try {
    for await (const token of streamFromLLM(fresh.history)) {
      if (!token) continue
      fullResponse += token
      socket.send(JSON.stringify({ type: 'text', token, last: false }))
    }
    socket.send(JSON.stringify({ type: 'text', token: '', last: true }))

    if (fullResponse) appendHistory(callSid, 'assistant', fullResponse)

  } catch (err) {
    fastify.log.error({ callSid, err }, '❌ Erreur LLM')
    send(socket, 'Une erreur est survenue. Veuillez reformuler votre question.')
  }
}

function send(socket, text) {
  socket.send(JSON.stringify({ type: 'text', token: text, last: true }))
}
