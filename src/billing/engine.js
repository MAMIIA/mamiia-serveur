// ============================================================
// MAMI IA — Billing Engine
// Débit d'une minute toutes les 60 secondes pendant l'appel.
// Avertissement à WARNING_MINUTES_REMAINING minutes restantes.
// Coupure automatique à 0.
// ============================================================

import { getSession, updateSession } from '../redis.js'
import { debitMinute } from '../db.js'

const WARNING_THRESHOLD = parseInt(process.env.WARNING_MINUTES_REMAINING || '5')
const MAX_DURATION_MS = parseInt(process.env.MAX_CALL_DURATION_MINUTES || '60') * 60 * 1000

/**
 * Démarre la boucle de facturation pour un appel.
 * @returns {NodeJS.Timeout} l'intervalle (pour clearInterval à la fin d'appel)
 */
export function billingLoop({ callSid, socket, onWarning, onExhausted }) {
  let warned = false
  const startTime = Date.now()

  const timer = setInterval(async () => {
    // Sécurité : durée max absolue
    if (Date.now() - startTime > MAX_DURATION_MS) {
      clearInterval(timer)
      onExhausted()
      return
    }

    const session = await getSession(callSid)
    if (!session) {
      clearInterval(timer)
      return
    }

    // Ne facturer que si une conversation est en cours
    if (session.status !== 'active') return

    // Débiter 1 minute
    const { success, balance } = await debitMinute({
      userId: session.userId,
      sessionId: session.sessionId
    })

    if (!success || balance <= 0) {
      clearInterval(timer)
      onExhausted()
      return
    }

    // Mettre à jour la session Redis
    await updateSession(callSid, {
      minutesBilled: (session.minutesBilled || 0) + 1,
      remainingMinutes: balance
    })

    console.log(`[Billing] ${callSid} — 1 min débitée, solde: ${balance} min`)

    // Avertissement solde faible
    if (balance <= WARNING_THRESHOLD && !warned) {
      warned = true
      onWarning(balance)
    }

  }, 60 * 1000) // Toutes les 60 secondes

  return timer
}
