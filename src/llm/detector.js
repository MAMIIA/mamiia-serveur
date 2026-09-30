// ============================================================
// MAMI IA — Détection vocale du choix LLM et commandes switch
// ============================================================

// Mots-clés par modèle (insensible à la casse, accents tolérés)
const LLM_KEYWORDS = {
  claude: ['claude', 'klod', 'anthropic', '1', 'un'],
  gpt4o: ['gpt', 'chatgpt', 'chat gpt', 'openai', 'open ai', '2', 'deux', 'deep'],
  gemini: ['gemini', 'jemini', 'google', '3', 'trois'],
  mistral: ['mistral', 'mistra', '4', 'quatre']
}

// Mots déclencheurs de switch
const SWITCH_TRIGGERS = [
  'changer', 'change', 'switch', 'passe-moi', 'passe moi',
  'bascule', 'autre modèle', 'autre ia', 'essaye', 'essaie'
]

/**
 * Détecte le LLM demandé dans un texte libre
 * @param {string} text
 * @returns {'claude'|'gpt4o'|'gemini'|'mistral'|null}
 */
export function detectLLMChoice(text) {
  const normalized = normalizeText(text)

  for (const [llm, keywords] of Object.entries(LLM_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return llm
      }
    }
  }
  return null
}

/**
 * Détecte une demande de changement de LLM
 * Ex: "passe-moi sur GPT" → 'gpt4o'
 * @param {string} text
 * @returns {'claude'|'gpt4o'|'gemini'|'mistral'|null}
 */
export function detectSwitchCommand(text) {
  const normalized = normalizeText(text)

  // Vérifier si le texte contient un trigger de switch
  const hasSwitchTrigger = SWITCH_TRIGGERS.some(trigger =>
    normalized.includes(trigger)
  )

  if (!hasSwitchTrigger) return null

  // Si oui, chercher le modèle cible
  return detectLLMChoice(normalized)
}

// ── Helpers ────────────────────────────────────────────────

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Supprimer les accents
    .replace(/[^a-z0-9\s\-]/g, ' ')  // Garder lettres, chiffres, espaces, tirets
    .replace(/\s+/g, ' ')
    .trim()
}
