// ============================================================
// MAMI IA — Connexion PostgreSQL
// ============================================================

import pg from 'pg'

const { Pool } = pg

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
})

db.on('error', (err) => {
  console.error('PostgreSQL pool error:', err)
})

// ── Helpers ────────────────────────────────────────────────

/**
 * Trouve un utilisateur par son numéro de téléphone
 */
export async function findUserByPhone(phoneNumber) {
  const result = await db.query(
    'SELECT * FROM users WHERE phone_number = $1 AND phone_verified = TRUE',
    [phoneNumber]
  )
  return result.rows[0] || null
}

/**
 * Crée une session d'appel en base
 */
export async function createCallSession({ callSid, userId, phoneFrom }) {
  const result = await db.query(
    `INSERT INTO call_sessions (call_sid, user_id, phone_from, started_at, status)
     VALUES ($1, $2, $3, NOW(), 'active')
     RETURNING id`,
    [callSid, userId, phoneFrom]
  )
  return result.rows[0].id
}

/**
 * Clôture une session d'appel
 */
export async function closeCallSession({ callSid, llmUsed, durationSeconds, minutesBilled }) {
  await db.query(
    `UPDATE call_sessions
     SET ended_at = NOW(),
         status = 'completed',
         llm_used = $2,
         duration_seconds = $3,
         minutes_billed = $4
     WHERE call_sid = $1`,
    [callSid, llmUsed, durationSeconds, minutesBilled]
  )
}

/**
 * Débite des minutes du solde utilisateur et log l'événement
 */
export async function debitMinute({ userId, sessionId }) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // Décrémenter le solde
    const result = await client.query(
      `UPDATE users SET minutes_balance = minutes_balance - 1
       WHERE id = $1 AND minutes_balance > 0
       RETURNING minutes_balance`,
      [userId]
    )

    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return { success: false, balance: 0 }
    }

    const newBalance = result.rows[0].minutes_balance

    // Logger l'événement
    await client.query(
      `INSERT INTO billing_events (user_id, session_id, event_type, minutes_delta, balance_after)
       VALUES ($1, $2, 'minute_consumed', -1, $3)`,
      [userId, sessionId, newBalance]
    )

    await client.query('COMMIT')
    return { success: true, balance: newBalance }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Retourne le solde actuel d'un utilisateur
 */
export async function getUserBalance(userId) {
  const result = await db.query(
    'SELECT minutes_balance FROM users WHERE id = $1',
    [userId]
  )
  return result.rows[0]?.minutes_balance ?? 0
}
