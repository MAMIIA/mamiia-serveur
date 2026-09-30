# 🎙️ Mami IA — Serveur Backend

> Service d'accès vocal multi-LLM par téléphone.  
> Appelez un numéro, choisissez votre IA (Claude, GPT, Gemini, Mistral), parlez.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Node.js 20 + Fastify 4 |
| Téléphonie | Twilio ConversationRelay |
| LLMs | Claude (Anthropic) · GPT-4o (OpenAI) · Gemini (Google) · Mistral |
| Session | Redis (ioredis) |
| Base de données | PostgreSQL |
| Paiement | Stripe |
| Email | Brevo |

---

## Installation

### 1. Prérequis

- Node.js ≥ 20
- PostgreSQL (local ou [Supabase](https://supabase.com))
- Redis (local ou [Upstash](https://upstash.com))
- Compte [Twilio](https://twilio.com) avec numéro français activé
- Clés API : Anthropic, OpenAI, Google AI, Mistral
- Compte [Stripe](https://stripe.com) (mode test pour le dev)
- Compte [Brevo](https://brevo.com) (gratuit jusqu'à 300 emails/jour)

### 2. Installation des dépendances

```bash
cd server
npm install
```

### 3. Configuration

```bash
cp .env.example .env
# Remplir toutes les variables dans .env
```

### 4. Initialisation de la base de données

```bash
psql $DATABASE_URL -f migrations/001_init.sql
```

### 5. Lancement en développement

```bash
# Terminal 1 : Serveur
npm run dev

# Terminal 2 : Tunnel ngrok (pour que Twilio puisse appeler votre serveur local)
ngrok http 3000
```

Copier l'URL ngrok (ex: `https://abc123.ngrok.io`) dans `.env` :
```
APP_URL=https://abc123.ngrok.io
```

### 6. Configuration Twilio

Dans la console Twilio :
1. Acheter un numéro français (09XX recommandé)
2. **Voice Configuration → Webhook entrant** :  
   `POST https://abc123.ngrok.io/call/start`
3. **Status Callback** :  
   `POST https://abc123.ngrok.io/call/status`

---

## Architecture des fichiers

```
server/
├── src/
│   ├── index.js              # Point d'entrée Fastify
│   ├── db.js                 # Connexion & helpers PostgreSQL
│   ├── redis.js              # Gestion sessions Redis
│   ├── email.js              # Emails transactionnels Brevo
│   ├── routes/
│   │   ├── callStart.js      # POST /call/start (TwiML)
│   │   ├── callStatus.js     # POST /call/status (webhook fin appel)
│   │   ├── callStream.js     # WS /call/stream (ConversationRelay)
│   │   ├── auth.js           # POST /auth/* (inscription, connexion)
│   │   └── billing.js        # POST /billing/* (Stripe, historique)
│   ├── llm/
│   │   ├── router.js         # Adaptateurs Claude/GPT/Gemini/Mistral
│   │   └── detector.js       # Détection vocale choix LLM
│   └── billing/
│       └── engine.js         # Boucle facturation minute/minute
├── migrations/
│   └── 001_init.sql          # Schéma PostgreSQL
├── .env.example              # Template variables d'environnement
└── package.json
```

---

## Flux d'un appel

```
Utilisateur appelle → Twilio → POST /call/start
  → Vérification numéro + solde → TwiML ConversationRelay
  → WebSocket /call/stream établi
  → Message d'accueil + choix LLM
  → [Utilisateur dit "Claude"]
  → Détection → session active → LLM = claude
  → [Utilisateur pose une question]
  → Anthropic API (streaming) → tokens → Twilio TTS → voix
  → Billing loop : -1 min/60s
  → [Utilisateur raccroche]
  → POST /call/status → clôture session → email récap
```

---

## Tests manuels

### Test healthcheck
```bash
curl http://localhost:3000/health
```

### Test inscription
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@mamia.fr","phoneNumber":"0612345678","password":"motdepasse123"}'
```

### Simuler un appel Twilio (développement)
```bash
curl -X POST http://localhost:3000/call/start \
  -d "CallSid=CA123test&From=+33612345678&To=+33XXXXXXXXX&CallStatus=ringing"
```

---

## Déploiement production (Railway)

```bash
# Installer Railway CLI
npm install -g @railway/cli

# Connexion
railway login

# Créer le projet
railway init

# Définir les variables d'env
railway vars set NODE_ENV=production PORT=3000 ...

# Déployer
railway up
```

---

## Roadmap Phase 2 (Semaines 3-4)

- [ ] Menu vocal plus élaboré avec confirmation de choix
- [ ] Historique de conversation persisté entre appels (opt-in)
- [ ] Support ElevenLabs TTS pour voix premium distinctes par LLM
- [ ] Vérification OTP SMS (Twilio Verify)
- [ ] Dashboard analytics admin

---

## Licence

Propriétaire — © 2026 Mami IA. Tous droits réservés.
