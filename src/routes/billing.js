// ============================================================
// MAMI IA — Routes facturation Stripe
// POST /billing/checkout  → Créer une session de paiement
// POST /billing/webhook   → Webhook Stripe (créditer les minutes)
// GET  /billing/history   → Historique des paiements
// ============================================================

import Stripe from 'stripe'
import { requireAuth } from './auth.js'
import { db } from '../db.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// ── Packs de minutes disponibles ──────────────────────────
const PACKS = {
  starter: { minutes: 60, priceEuros: 12, label: 'Pack Starter — 60 minutes' },
  pro:     { minutes: 200, priceEuros: 39, label: 'Pack Pro — 200 minutes' },
  premium: { minutes: 500, priceEuros: 79, label: 'Pack Premium — 500 minutes' }
}

export async function billingRoutes(fastify) {

  // ── POST /billing/checkout ───────────────────────────────
  // Crée une session Stripe Checkout et retourne l'URL de paiement
  fastify.post('/billing/checkout', { preHandler: requireAuth }, async (req, reply) => {
    const { pack } = req.body  // 'starter' | 'pro' | 'premium'

    if (!PACKS[pack]) {
      return reply.code(400).send({ error: 'Pack invalide. Choisissez starter, pro ou premium.' })
    }

    const packData = PACKS[pack]

    // Récupérer ou créer le client Stripe
    const userResult = await db.query(
      'SELECT email, stripe_customer_id FROM users WHERE id = $1',
      [req.userId]
    )
    const user = userResult.rows[0]

    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email })
      customerId = customer.id
      await db.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, req.userId]
      )
    }

    // Créer la session Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: packData.priceEuros * 100,  // En centimes
          product_data: {
            name: packData.label,
            description: `${packData.minutes} minutes d'accès aux IAs par téléphone`
          }
        },
        quantity: 1
      }],
      metadata: {
        userId: req.userId,
        pack,
        minutesToCredit: packData.minutes.toString()
      },
      success_url: `${process.env.APP_URL}/dashboard?payment=success&pack=${pack}`,
      cancel_url: `${process.env.APP_URL}/dashboard?payment=cancelled`
    })

    return reply.send({ checkoutUrl: session.url })
  })

  // ── POST /billing/webhook ────────────────────────────────
  // Stripe appelle ce endpoint après paiement réussi
  fastify.post('/billing/webhook', async (req, reply) => {
    const signature = req.headers['stripe-signature']

    let event
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      fastify.log.warn('Signature webhook Stripe invalide')
      return reply.code(400).send('Webhook signature invalide')
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      if (session.payment_status === 'paid') {
        const { userId, pack, minutesToCredit } = session.metadata
        const minutes = parseInt(minutesToCredit)
        const amountCents = session.amount_total

        const client = await db.connect()
        try {
          await client.query('BEGIN')

          // Créditer les minutes
          await client.query(
            'UPDATE users SET minutes_balance = minutes_balance + $1 WHERE id = $2',
            [minutes, userId]
          )

          // Enregistrer le paiement
          await client.query(
            `INSERT INTO payments (user_id, stripe_payment_intent_id, amount_cents, minutes_credited, status)
             VALUES ($1, $2, $3, $4, 'succeeded')`,
            [userId, session.payment_intent, amountCents, minutes]
          )

          // Logger l'événement billing
          const balanceResult = await client.query(
            'SELECT minutes_balance FROM users WHERE id = $1', [userId]
          )
          const newBalance = balanceResult.rows[0].minutes_balance

          await client.query(
            `INSERT INTO billing_events (user_id, event_type, minutes_delta, balance_after)
             VALUES ($1, 'recharge', $2, $3)`,
            [userId, minutes, newBalance]
          )

          await client.query('COMMIT')
          fastify.log.info({ userId, minutes, pack }, 'Paiement Stripe crédité')

        } catch (err) {
          await client.query('ROLLBACK')
          fastify.log.error(err, 'Erreur crédit minutes après paiement')
        } finally {
          client.release()
        }
      }
    }

    return reply.send({ received: true })
  })

  // ── GET /billing/history ─────────────────────────────────
  fastify.get('/billing/history', { preHandler: requireAuth }, async (req, reply) => {
    const [callsResult, paymentsResult] = await Promise.all([
      db.query(
        `SELECT call_sid, llm_used, started_at, duration_seconds, minutes_billed, status
         FROM call_sessions
         WHERE user_id = $1
         ORDER BY started_at DESC
         LIMIT 50`,
        [req.userId]
      ),
      db.query(
        `SELECT amount_cents, minutes_credited, status, created_at
         FROM payments
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [req.userId]
      )
    ])

    return reply.send({
      calls: callsResult.rows,
      payments: paymentsResult.rows
    })
  })
}
