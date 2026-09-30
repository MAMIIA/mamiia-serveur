-- ============================================================
-- MAMI IA — Schéma PostgreSQL
-- Exécuter ce fichier pour initialiser la base de données
-- psql $DATABASE_URL -f migrations/001_init.sql
-- ============================================================

-- ── Extension UUID ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Utilisateurs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  phone_number      VARCHAR(20) UNIQUE NOT NULL,
  phone_verified    BOOLEAN DEFAULT FALSE,
  password_hash     VARCHAR(255) NOT NULL,
  plan              VARCHAR(20) DEFAULT 'free'
                    CHECK (plan IN ('free', 'starter', 'pro', 'premium')),
  minutes_balance   INTEGER DEFAULT 5 CHECK (minutes_balance >= 0),
  stripe_customer_id VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sessions d'appel ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_sid         VARCHAR(50) UNIQUE NOT NULL,
  phone_from       VARCHAR(20),
  llm_used         VARCHAR(20) CHECK (llm_used IN ('claude', 'gpt4o', 'gemini', 'mistral')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  minutes_billed   INTEGER DEFAULT 0 CHECK (minutes_billed >= 0),
  tokens_estimated INTEGER,
  status           VARCHAR(20) DEFAULT 'active'
                   CHECK (status IN ('active', 'completed', 'failed'))
);

-- ── Événements de facturation ──────────────────────────────
CREATE TABLE IF NOT EXISTS billing_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  event_type    VARCHAR(30) NOT NULL
                CHECK (event_type IN ('minute_consumed', 'recharge', 'refund', 'bonus')),
  minutes_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Paiements Stripe ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  minutes_credited         INTEGER NOT NULL CHECK (minutes_credited > 0),
  status                   VARCHAR(20) DEFAULT 'pending'
                           CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── Index ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_call_sessions_user ON call_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_sid ON call_sessions(call_sid);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);

-- ── Trigger updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Données de test (développement uniquement) ─────────────
-- INSERT INTO users (email, phone_number, password_hash, phone_verified, minutes_balance)
-- VALUES ('test@mamia.fr', '+33612345678', '$2b$12$PLACEHOLDER', TRUE, 60);

SELECT 'Schéma Mami IA initialisé avec succès ✅' AS status;
