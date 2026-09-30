// ============================================================
// MAMI IA v2 — Sessions en mémoire (Map)
// Sans compte utilisateur ni facturation côté serveur,
// une simple Map Node.js suffit pour les sessions actives.
// Chaque session vit le temps d'un appel (max 30 min).
// ============================================================

// Map callSid → session
const sessions = new Map()

// ── Structure d'une session ────────────────────────────────
// {
//   callSid:     string
//   from:        string  (numéro appelant)
//   selectedLLM: string | null
//   startTime:   number  (timestamp ms)
//   status:      'waiting_choice' | 'active' | 'ending'
//   history:     Array<{role: 'user'|'assistant', content: string}>
// }

export function createSession({ callSid, from }) {
  const session = {
    callSid,
    from,
    selectedLLM: null,
    startTime: Date.now(),
    status: 'waiting_choice',
    history: []
  }
  sessions.set(callSid, session)
  return session
}

export function getSession(callSid) {
  return sessions.get(callSid) || null
}

export function updateSession(callSid, updates) {
  const session = sessions.get(callSid)
  if (!session) return null
  const updated = { ...session, ...updates }
  sessions.set(callSid, updated)
  return updated
}

export function appendHistory(callSid, role, content) {
  const session = sessions.get(callSid)
  if (!session) return
  session.history.push({ role, content })
  // Fenêtre glissante : max 30 échanges pour maîtriser les tokens
  if (session.history.length > 60) {
    session.history.splice(0, session.history.length - 60)
  }
}

export function deleteSession(callSid) {
  sessions.delete(callSid)
}

// Stats utiles pour le monitoring
export function getActiveSessions() {
  return sessions.size
}
