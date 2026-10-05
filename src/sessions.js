// ============================================================
// Mami IA v3.2 — Gestion des sessions d'appel (in-memory)
//
// Pas de Redis pour le MVP — Map simple, suffisante pour
// les volumes attendus (Audiotel SVA, mono-instance Railway).
// ============================================================

const sessions = new Map()

/**
 * Crée une nouvelle session pour un appel entrant
 */
export function createSession(callSid, data) {
  sessions.set(callSid, {
    callSid,
    createdAt: Date.now(),
    history: [],
    ...data
  })
}

/**
 * Récupère une session par callSid
 */
export function getSession(callSid) {
  return sessions.get(callSid) || null
}

/**
 * Met à jour les champs d'une session existante
 */
export function updateSession(callSid, updates) {
  const session = sessions.get(callSid)
  if (!session) return
  sessions.set(callSid, { ...session, ...updates })
}

/**
 * Ajoute un message à l'historique de conversation
 */
export function appendHistory(callSid, role, content) {
  const session = sessions.get(callSid)
  if (!session) return
  session.history.push({ role, content })
}

/**
 * Supprime une session (fin d'appel)
 */
export function deleteSession(callSid) {
  sessions.delete(callSid)
}

/**
 * Retourne le nombre de sessions actives
 */
export function getActiveSessions() {
  return sessions.size
}
