// ============================================================
// MAMI IA — Redis : gestion des sessions d'appel en temps réel
// ============================================================

import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true
})

redis.on('error', (err) => console.error('Redis error:', err))

const SESSION_TTL = 4 * 60 * 60  // 4 heures en secondes
const SESSION_PREFIX = 'mamia:call:'

// ── Structure d'une session ────────────────────────────────
// {
//   callSid, userId, sessionId (DB), phoneNumber,
//   selectedLLM, startTime, minutesBilled, remainingMinutes,
//   conversationHistory: [{role, content}],
//   status: 'waiting_llm_choice' | 'active' | 'ending'
// }

/**
 * Crée une nouvelle session d'appel dans Redis
 */
export async function createSession({ callSid, userId, sessionId, phoneNumber, remainingMinutes }) {
  const session = {
    callSid,
    userId,
    sessionId,
    phoneNumber,
    selectedLLM: null,
    startTime: Date.now(),
    minutesBilled: 0,
    remainingMinutes,
    conversationHistory: [],
    status: 'waiting_llm_choice'
  }
  await redis.set(
    `${SESSION_PREFIX}${callSid}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL
  )
  return session
}

/**
 * Récupère une session active
 */
export async function getSession(callSid) {
  const data = await redis.get(`${SESSION_PREFIX}${callSid}`)
  return data ? JSON.parse(data) : null
}

/**
 * Met à jour les champs d'une session
 */
export async function updateSession(callSid, updates) {
  const session = await getSession(callSid)
  if (!session) return null
  const updated = { ...session, ...updates }
  await redis.set(
    `${SESSION_PREFIX}${callSid}`,
    JSON.stringify(updated),
    'EX',
    SESSION_TTL
  )
  return updated
}

/**
 * Ajoute un échange à l'historique de conversation (fenêtre glissante 20 tours)
 */
export async function appendHistory(callSid, role, content) {
  const session = await getSession(callSid)
  if (!session) return

  const history = session.conversationHistory || []
  history.push({ role, content })

  // Fenêtre glissante : max 20 échanges (40 messages)
  if (history.length > 40) {
    history.splice(0, history.length - 40)
  }

  await updateSession(callSid, { conversationHistory: history })
}

/**
 * Supprime une session (fin d'appel)
 */
export async function deleteSession(callSid) {
  await redis.del(`${SESSION_PREFIX}${callSid}`)
}
