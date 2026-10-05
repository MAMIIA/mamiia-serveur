// ============================================================
// Mami IA v3.2 — Service email via Brevo (ex-Sendinblue)
// ============================================================

// Fix audit #14 : import db supprimé (inutilisé dans ce fichier)

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

/**
 * Envoie un email transactionnel via l'API Brevo
 */
async function sendEmail({ to, subject, htmlContent, textContent }) {
  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_FROM_NAME || 'Mami IA',
        email: process.env.BREVO_FROM_EMAIL || 'noreply@mamia.fr'
      },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Brevo error: ${err}`)
  }
}

/**
 * Envoie le récapitulatif d'appel après raccrochage
 */
export async function sendCallRecap({
  userEmail,
  durationSeconds,
  llmUsed,
  minutesBilled,
  remainingMinutes
}) {
  if (!userEmail) return

  const durationFormatted = formatDuration(durationSeconds)
  const llmNames = {
    'gpt-4o': 'ChatGPT (OpenAI)',
    null: 'Non sélectionné'
  }
  const llmName = llmNames[llmUsed] || llmUsed

  const subject = `Mami IA — Récapitulatif de votre appel`

  const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .card { background: white; border-radius: 12px; max-width: 500px; margin: 0 auto; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 24px; font-weight: 700; color: #6C3CE1; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    .stat { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .stat:last-of-type { border-bottom: none; }
    .stat-label { color: #555; font-size: 14px; }
    .stat-value { font-weight: 600; color: #111; font-size: 14px; }
    .balance { background: #F0EBFF; border-radius: 8px; padding: 16px; margin-top: 24px; text-align: center; }
    .balance-number { font-size: 32px; font-weight: 700; color: #6C3CE1; }
    .balance-label { color: #888; font-size: 13px; margin-top: 4px; }
    .cta { display: block; text-align: center; margin-top: 24px; background: #6C3CE1; color: white; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .footer { text-align: center; color: #bbb; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🎙️ Mami IA</div>
    <div class="subtitle">Récapitulatif de votre appel</div>

    <div class="stat">
      <span class="stat-label">Modèle utilisé</span>
      <span class="stat-value">${llmName}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Durée de l'appel</span>
      <span class="stat-value">${durationFormatted}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Minutes débitées</span>
      <span class="stat-value">${minutesBilled} min</span>
    </div>

    <div class="balance">
      <div class="balance-number">${remainingMinutes}</div>
      <div class="balance-label">minutes restantes</div>
    </div>

    ${remainingMinutes <= 10 ? `
    <a href="https://mamia.fr/dashboard" class="cta">
      Recharger mon solde →
    </a>
    ` : ''}

    <div class="footer">
      Mami IA · Votre assistant IA par téléphone<br>
      <a href="https://mamia.fr/unsubscribe" style="color: #bbb;">Se désabonner</a>
    </div>
  </div>
</body>
</html>`

  // Fix audit #9 : textContent aligné et sans espaces parasites
  const textContent = [
    'Mami IA — Récapitulatif de votre appel',
    '',
    `Modèle : ${llmName}`,
    `Durée : ${durationFormatted}`,
    `Minutes débitées : ${minutesBilled}`,
    `Solde restant : ${remainingMinutes} minutes`,
    '',
    'Rechargez votre solde sur https://mamia.fr/dashboard'
  ].join('\n')

  await sendEmail({ to: userEmail, subject, htmlContent, textContent })
}

/**
 * Envoie une alerte solde faible
 */
export async function sendLowBalanceAlert({ userEmail, remainingMinutes }) {
  if (!userEmail) return

  await sendEmail({
    to: userEmail,
    subject: `Mami IA — Solde faible : ${remainingMinutes} minutes restantes`,
    htmlContent: `<p>Bonjour,<br><br>
      Votre solde Mami IA est faible : <strong>${remainingMinutes} minutes</strong> restantes.<br><br>
      <a href="https://mamia.fr/dashboard">Recharger maintenant →</a>
    </p>`,
    textContent: `Solde faible : ${remainingMinutes} minutes. Rechargez sur https://mamia.fr/dashboard`
  })
}

// ── Helper ─────────────────────────────────────────────────
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s} secondes`
  return `${m} min ${s.toString().padStart(2, '0')} sec`
}
