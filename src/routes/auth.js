// ============================================================
// MAMI IA — Routes authentification
// POST /auth/register
// POST /auth/login
// POST /auth/refresh
// GET  /auth/me
// ============================================================

import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db } from '../db.js'

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12')
const JWT_SECRET = process.env.JWT_SECRET
const ACCESS_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m'
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d'
const FREE_MINUTES = 5  // Minutes offertes à l'inscription

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_EXPIRY })
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRY })
  return { accessToken, refreshToken }
}

export async function authRoutes(fastify) {

  // ── POST /auth/register ──────────────────────────────────
  fastify.post('/auth/register', async (req, reply) => {
    const { email, phoneNumber, password } = req.body

    if (!email || !phoneNumber || !password) {
      return reply.code(400).send({ error: 'Email, téléphone et mot de passe requis' })
    }

    // Validation basique
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Mot de passe trop court (8 caractères minimum)' })
    }

    // Normaliser le numéro (ex: 0612345678 → +33612345678)
    const normalizedPhone = normalizePhone(phoneNumber)
    if (!normalizedPhone) {
      return reply.code(400).send({ error: 'Numéro de téléphone invalide' })
    }

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      const result = await db.query(
        `INSERT INTO users (email, phone_number, password_hash, minutes_balance)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, phone_number, minutes_balance, created_at`,
        [email.toLowerCase(), normalizedPhone, passwordHash, FREE_MINUTES]
      )

      const user = result.rows[0]
      const tokens = generateTokens(user.id)

      // TODO: envoyer OTP SMS pour vérification du numéro (Phase 3)

      return reply.code(201).send({
        message: `Bienvenue sur Mami IA ! Vous avez ${FREE_MINUTES} minutes offertes.`,
        user: {
          id: user.id,
          email: user.email,
          phoneNumber: user.phone_number,
          minutesBalance: user.minutes_balance
        },
        ...tokens
      })

    } catch (err) {
      if (err.code === '23505') {  // Violation contrainte unique
        if (err.constraint?.includes('email')) {
          return reply.code(409).send({ error: 'Cet email est déjà utilisé' })
        }
        if (err.constraint?.includes('phone')) {
          return reply.code(409).send({ error: 'Ce numéro de téléphone est déjà utilisé' })
        }
      }
      fastify.log.error(err)
      return reply.code(500).send({ error: 'Erreur serveur' })
    }
  })

  // ── POST /auth/login ─────────────────────────────────────
  fastify.post('/auth/login', async (req, reply) => {
    const { email, password } = req.body

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email et mot de passe requis' })
    }

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    )

    const user = result.rows[0]

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Identifiants incorrects' })
    }

    const tokens = generateTokens(user.id)

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phone_number,
        minutesBalance: user.minutes_balance,
        plan: user.plan
      },
      ...tokens
    })
  })

  // ── POST /auth/refresh ───────────────────────────────────
  fastify.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body
    if (!refreshToken) return reply.code(400).send({ error: 'Refresh token requis' })

    try {
      const payload = jwt.verify(refreshToken, JWT_SECRET)
      if (payload.type !== 'refresh') throw new Error('Token invalide')

      const tokens = generateTokens(payload.userId)
      return reply.send(tokens)
    } catch {
      return reply.code(401).send({ error: 'Refresh token invalide ou expiré' })
    }
  })

  // ── GET /auth/me ─────────────────────────────────────────
  fastify.get('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const result = await db.query(
      'SELECT id, email, phone_number, minutes_balance, plan, created_at FROM users WHERE id = $1',
      [req.userId]
    )
    const user = result.rows[0]
    if (!user) return reply.code(404).send({ error: 'Utilisateur introuvable' })

    return reply.send({
      id: user.id,
      email: user.email,
      phoneNumber: user.phone_number,
      minutesBalance: user.minutes_balance,
      plan: user.plan,
      createdAt: user.created_at
    })
  })
}

// ── Middleware d'authentification ──────────────────────────
export async function requireAuth(req, reply) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Token manquant' })
  }

  try {
    const token = authHeader.slice(7)
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.type !== 'access') throw new Error()
    req.userId = payload.userId
  } catch {
    return reply.code(401).send({ error: 'Token invalide ou expiré' })
  }
}

// ── Helper normalisation numéro FR ────────────────────────
function normalizePhone(phone) {
  const cleaned = phone.replace(/[\s\-\.]/g, '')

  // Déjà au format international
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned

  // Format français 06/07/09 → +336/+337/+339
  if (/^0[1-9]\d{8}$/.test(cleaned)) {
    return '+33' + cleaned.slice(1)
  }

  return null
}
