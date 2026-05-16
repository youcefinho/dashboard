// ── langDetect — Sprint 49 M1.4 — Détection langue conversation ─────────────
// Détecte la langue d'un message inbound (stop-words FR/EN/ES) pour proposer
// de répondre dans la même langue. Wiré avec i18n locale (Sprint 48).
//
// API publique :
//   - detectLang(text): DetectedLang                  (sync heuristique)
//   - shouldSuggestLangSwitch(inbound, draft): {...}|null
//
// Heuristique seule (offline-safe). Le backend /api/ai/drafts accepte déjà
// un param targetLang pour générer un draft dans la langue détectée.

export type DetectedLang = 'fr' | 'en' | 'es' | 'unknown';

// Stop-words très fréquents & discriminants par langue
const FR_STOP = [
  'le', 'la', 'les', 'un', 'une', 'des', 'et', 'est', 'vous', 'nous',
  'je', 'pour', 'avec', 'pas', 'que', 'qui', 'dans', 'sur', 'merci',
  'bonjour', 'votre', 'notre', 'mais', 'donc', 'aussi', 'bien',
];
const EN_STOP = [
  'the', 'a', 'an', 'and', 'is', 'are', 'you', 'we', 'i', 'for',
  'with', 'not', 'that', 'this', 'in', 'on', 'thanks', 'thank',
  'hello', 'hi', 'your', 'our', 'but', 'so', 'also', 'please',
];
const ES_STOP = [
  'el', 'la', 'los', 'las', 'un', 'una', 'y', 'es', 'usted', 'nosotros',
  'yo', 'para', 'con', 'no', 'que', 'quien', 'en', 'sobre', 'gracias',
  'hola', 'su', 'nuestro', 'pero', 'tambien', 'bien', 'por',
];

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreLang(tokens: string[], stop: string[]): number {
  const set = new Set(stop);
  let hits = 0;
  for (const t of tokens) if (set.has(t)) hits += 1;
  return tokens.length > 0 ? hits / tokens.length : 0;
}

/**
 * Détecte la langue d'un texte via fréquence de stop-words.
 * Retourne 'unknown' si pas de signal net (texte court / ambigu).
 */
export function detectLang(text: string): DetectedLang {
  const tokens = tokenize(text);
  if (tokens.length < 3) return 'unknown';

  const scores: Array<[DetectedLang, number]> = [
    ['fr', scoreLang(tokens, FR_STOP)],
    ['en', scoreLang(tokens, EN_STOP)],
    ['es', scoreLang(tokens, ES_STOP)],
  ];
  scores.sort((a, b) => b[1] - a[1]);

  const [topLang, topScore] = scores[0]!;
  const [, secondScore] = scores[1]!;

  // Seuils : signal minimal + écart suffisant avec le 2e (anti-ambiguïté)
  if (topScore < 0.06 || topScore - secondScore < 0.02) return 'unknown';
  return topLang;
}

const LANG_LABEL: Record<Exclude<DetectedLang, 'unknown'>, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
};

/** Map langue détectée → locale i18n pour le param backend targetLang. */
export const LANG_TO_LOCALE: Record<
  Exclude<DetectedLang, 'unknown'>,
  string
> = {
  fr: 'fr-CA',
  en: 'en',
  es: 'es',
};

export interface LangSwitchSuggestion {
  /** Langue détectée du message inbound. */
  inboundLang: Exclude<DetectedLang, 'unknown'>;
  /** Locale i18n correspondante (pour aiDrafts targetLang). */
  targetLocale: string;
  /** Message FR subtil à afficher dans le chip. */
  message: string;
  /** Libellé court du CTA toggle. */
  cta: string;
}

/**
 * Décide s'il faut suggérer un changement de langue de réponse.
 *
 * @param inboundText  Dernier message reçu du client.
 * @param draftText    Brouillon en cours côté user.
 * @returns Suggestion si mismatch détecté, sinon null (rien affiché).
 */
export function shouldSuggestLangSwitch(
  inboundText: string,
  draftText: string,
): LangSwitchSuggestion | null {
  const inbound = detectLang(inboundText);
  if (inbound === 'unknown') return null;

  const draft = detectLang(draftText);
  // Pas encore assez de draft pour juger, ou même langue → rien.
  if (draft === 'unknown') {
    // Si le client écrit dans une langue ≠ fr et le user n'a rien tapé,
    // on propose quand même (cas fréquent : client EN, composer vide).
    if (inbound === 'fr') return null;
  } else if (draft === inbound) {
    return null;
  }

  if (draft !== 'unknown' && draft === inbound) return null;

  const label = LANG_LABEL[inbound];
  return {
    inboundLang: inbound,
    targetLocale: LANG_TO_LOCALE[inbound],
    message: `Ce client écrit en ${label}. Répondre en ${label} ?`,
    cta: `Brouillon en ${label}`,
  };
}
