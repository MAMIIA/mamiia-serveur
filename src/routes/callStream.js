// ============================================================
// Mami IA v3.5 — WS /call/stream  [DIAG]
//
// Version diagnostic : log ALL messages bruts reçus de Twilio
// pour identifier pourquoi setup/prompt n'arrivent pas.
// ============================================================

import {
  getSession, updateSession, appendHistory,
  deleteSession, getActiveSessions
} from '../sessions.js'
import { streamFromLLM } from '../llm/router.js'

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
      // ── DIAG : log tous les messages bruts ──────────────
      const rawStr = raw.toString()
      fastify.log.info({ rawMessage: rawStr.slice(0, 500) }, '📨 Message WebSocket reçu')

      let event
      try { event = JSON.parse(rawStr) } catch (e) {
        fastify.log.warn({ parseError: e.message, raw: rawStr.slice(0, 200) }, '⚠️ Message non-JSON reçu')
        return
      }

      fastify.log.info({ eventType: event.type, callSid: event.callSid }, '📋 Event parsé')

      switch (event.type) {

        case 'setup': {
          callSid = event.callSid
          fastify.log.info({ callSid }, '✅ Session prête')

          durationTimer = setTimeout(() => {
            send(socket, 'Vous avez atteint la durée maximale de trente minutes. Merci d\'avoir utilisé Mami IA. À bientôt !')
            setTimeout(() => socket.close(), 4000)
          }, MAX_MS)

          warnTimer = setTimeout(() => {
            send(socket, 'Information : il vous reste cinq minutes de communication.')
          }, WARN_MS)

          break
        }

        case 'prompt': {
          const session = getSession(callSid)
          if (!session) {
            fastify.log.warn({ callSid, eventCallSid: event.callSid }, '⚠️ Session introuvable pour prompt')
            return
          }

          const text = (event.voicePrompt || '').trim()
          if (!text) {
            fastify.log.warn({ callSid }, '⚠️ voicePrompt vide')
            return
          }

          fastify.log.info({ callSid, text }, '🗣️  Question')
          await handleQuery(socket, callSid, session, text, fastify)
          break
        }

        case 'interrupt': {
          socket.send(JSON.stringify({ type: 'clear' }))
          fastify.log.info({ callSid }, '✋ Interruption')
          break
        }

        case 'end': {
          fastify.log.info({ callSid }, '📴 Fin d\'appel')
          cleanup()
          break
        }

        default: {
          fastify.log.info({ eventType: event.type, callSid }, '❓ Event inconnu reçu')
        }
      }
    })

    socket.on('close', (code, reason) => {
      fastify.log.info({ callSid, closeCode: code, closeReason: reason?.toString() }, '🔌 WebSocket fermé')
      cleanup()
    })
    socket.on('error', (err) => { fastify.log.error({ callSid, err }); cleanup() })

    function cleanup() {
      if (durationTimer) { clearTimeout(durationTimer); durationTimer = null }
      if (warnTimer)     { clearTimeout(warnTimer);     warnTimer = null }
      if (callSid)       deleteSession(callSid)
    }
  })
}

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

