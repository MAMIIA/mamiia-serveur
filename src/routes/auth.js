// ============================================================
// Mami IA v3.2 — Routes authentification
//
// PHASE 3 — Non enregistré dans index.js pour le MVP
// À activer quand PostgreSQL et JWT seront configurés
// ============================================================

import { db } from '../db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 12

export async function authRoutes(fastify) {

  // ── Inscription ──────────────────────────────────────────
  fastify.post('/auth/register', async (req, reply) => {
    const { email, password } = req.body || {}

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email et mot de passe requis' })
    }

    if (password.length < 8) {
      return reply.code(400).send({ error: 'Le mot de passe doit contenir au moins 8 caractères' })
    }

    try {
      const hash = await bcrypt.hash(password, SALT_ROUNDS)
      const result = await db.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email.toLowerCase().trim(), hash]
      )

      const user = result.rows[0]
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })

      return reply.code(201).send({ token, user: { id: user.id, email: user.email } })

    } catch (err) {
      // Fix audit #8 : regex sur le nom de contrainte PostgreSQL (plus robuste que .includes)
      // Le nom de contrainte standard pour UNIQUE sur email est "users_email_key"
      if (err.constraint && /users_email_key/.test(err.constraint)) {
        return reply.code(409).send({ error: 'Cet email est déjà utilisé' })
      }
      fastify.log.error({ err }, '❌ Erreur inscription')
      return reply.code(500).send({ error: 'Erreur serveur' })
    }
  })

  // ── Connexion ────────────────────────────────────────────
  fastify.post('/auth/login', async (req, reply) => {
    const { email, password } = req.body || {}

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email et mot de passe requis' })
    }

    try {
      const result = await db.query(
        'SELECT id, email, password_hash FROM users WHERE email = $1',
        [email.toLowerCase().trim()]
      )

      const user = result.rows[0]
      if (!user) {
        return reply.code(401).send({ error: 'Email ou mot de passe incorrect' })
      }

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        return reply.code(401).send({ error: 'Email ou mot de passe incorrect' })
      }

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })

      return reply.send({ token, user: { id: user.id, email: user.email } })

    } catch (err) {
      fastify.log.error({ err }, '❌ Erreur connexion')
      return reply.code(500).send({ error: 'Erreur serveur' })
    }
  })

  // ── Vérification token (middleware optionnel) ────────────
  fastify.get('/auth/me', {
    preHandler: async (req, reply) => {
      const auth = req.headers.authorization
      if (!auth?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Token manquant' })
      }
      try {
        req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET)
      } catch {
        return reply.code(401).send({ error: 'Token invalide ou expiré' })
      }
    }
  }, async (req, reply) => {
    try {
      const result = await db.query(
        'SELECT id, email, created_at FROM users WHERE id = $1',
        [req.user.userId]
      )
      const user = result.rows[0]
      if (!user) return reply.code(404).send({ error: 'Utilisateur non trouvé' })
      return reply.send({ user })
    } catch (err) {
      fastify.log.error({ err }, '❌ Erreur /auth/me')
      return reply.code(500).send({ error: 'Erreur serveur' })
    }
  })
}

// TODO (GitHub issue à créer) : ajouter refresh token, route /auth/logout,
// et blacklist JWT côté serveur pour la révocation immédiate.
// À implémenter en Phase 3 avec Redis ou table tokens_revoked en DB.

