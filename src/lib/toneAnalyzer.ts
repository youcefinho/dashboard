// ── toneAnalyzer — Sprint 49 M1.2 — Real-time tone detection ────────────────
// Détection de ton heuristique locale (instant, zéro réseau) + mismatch
// contexte lead. Optionnel : refine Claude si draft long (non bloquant).
//
// API publique :
//   - analyzeTone(text): ToneResult                          (sync heuristique)
//   - toneLeadMismatch(tone, leadStage?): string | null      (suggestion subtile)
//
// Stripe SUBTLE : retourne juste label + key, l'UI mappe vers Tag neutre.

export type ToneKey = 'formel' | 'amical' | 'urgent' | 'neutre';

export interface ToneResult {
  tone: ToneKey;
  label: string;
  /** Score de confiance 0-1 (informatif, pas affiché). */
  confidence: number;
}

export const TONE_LABELS: Record<ToneKey, string> = {
  formel: 'Formel',
  amical: 'Amical',
  urgent: 'Urgent',
  neutre: 'Neutre',
};

// ── Lexiques signaux ────────────────────────────────────────────────────────

const FORMAL_MARKERS = [
  'cordialement',
  'veuillez',
  'je vous prie',
  'monsieur',
  'madame',
  'au plaisir',
  'dans l\'attente',
  'je vous remercie',
  'sincères salutations',
  'bien à vous',
  'nous vous',
];

const CASUAL_MARKERS = [
  'salut',
  'allo',
  'coucou',
  'hey',
  'yo',
  'à bientôt',
  'à+',
  'ciao',
  'tu ',
  ' ton ',
  ' ta ',
  'sympa',
  'cool',
  'top',
  'génial',
  'super',
  'pas de souci',
  'haha',
  'lol',
];

const URGENT_MARKERS = [
  'urgent',
  'asap',
  'au plus vite',
  'rapidement',
  'immédiatement',
  'dès que possible',
  'avant ce soir',
  'avant demain',
  'pressé',
  'le plus tôt',
  'sans tarder',
  'critique',
];

function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/\s+/g, ' ')} `;
}

function countMarkers(haystack: string, markers: string[]): number {
  let n = 0;
  for (const m of markers) {
    if (haystack.includes(m)) n += 1;
  }
  return n;
}

/**
 * Analyse le ton d'un brouillon — heuristique locale instant.
 *
 * Signaux pondérés :
 *   - Marqueurs lexicaux (formel / amical / urgent)
 *   - Émojis & exclamations → amical/urgent
 *   - MAJUSCULES soutenues → urgent
 *   - Longueur de phrases (très courtes + ! → urgent ; longues → formel)
 *
 * Retourne 'neutre' si aucun signal dominant (défaut sûr, Stripe sober).
 */
export function analyzeTone(text: string): ToneResult {
  const raw = (text || '').trim();
  if (!raw || raw.split(/\s+/).filter(Boolean).length < 3) {
    return { tone: 'neutre', label: TONE_LABELS.neutre, confidence: 0.3 };
  }

  const hay = normalize(raw);

  let formal = countMarkers(hay, FORMAL_MARKERS);
  let casual = countMarkers(hay, CASUAL_MARKERS);
  let urgent = countMarkers(hay, URGENT_MARKERS);

  // Émojis → amical
  const emojiCount = (raw.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emojiCount > 0) casual += Math.min(emojiCount, 2);

  // Exclamations multiples → urgent ou amical (selon contexte)
  const exclam = (raw.match(/!/g) || []).length;
  if (exclam >= 2) {
    urgent += 1;
    casual += 0.5;
  }

  // MAJUSCULES soutenues (mots ≥4 lettres tout en capitales) → urgent
  const shoutWords = (raw.match(/\b[A-ZÀ-Þ]{4,}\b/g) || []).length;
  if (shoutWords >= 1) urgent += shoutWords;

  // Phrases longues moyennes → formel
  const sentences = raw.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgLen =
    sentences.length > 0
      ? raw.replace(/\s+/g, ' ').length / sentences.length
      : raw.length;
  if (avgLen > 120) formal += 1;
  if (avgLen < 40 && exclam >= 1) urgent += 0.5;

  // Vouvoiement explicite → léger formel
  if (/\bvous\b/.test(hay) && !/\btu\b/.test(hay)) formal += 0.5;

  const scores: Array<[ToneKey, number]> = [
    ['formel', formal],
    ['amical', casual],
    ['urgent', urgent],
  ];
  scores.sort((a, b) => b[1] - a[1]);

  const [topKey, topScore] = scores[0];
  const [, secondScore] = scores[1];

  // Seuil : signal dominant requis, sinon neutre (évite faux positifs Stripe)
  if (topScore < 1 || topScore - secondScore < 0.5) {
    return { tone: 'neutre', label: TONE_LABELS.neutre, confidence: 0.4 };
  }

  const confidence = Math.min(0.95, 0.55 + (topScore - secondScore) * 0.12);
  return { tone: topKey, label: TONE_LABELS[topKey], confidence };
}

// ── Mismatch contexte lead ──────────────────────────────────────────────────

/**
 * Stages "froids" où un ton trop familier détonne (phase initiale).
 * Match insensible à la casse / partiel (status libre côté lead).
 */
const COLD_STAGE_HINTS = ['nouveau', 'new', 'froid', 'cold', 'initial', 'prospect', 'non qualifié', 'unqualified', 'à contacter'];

/**
 * Retourne une suggestion subtile (string FR) si le ton détecté détonne
 * avec la phase du lead. null si pas de mismatch (rien affiché).
 *
 * Non-intrusif : c'est une suggestion dismissible, jamais un blocage.
 */
export function toneLeadMismatch(
  tone: ToneKey,
  leadStage?: string | null,
): string | null {
  if (!leadStage) return null;
  const stage = leadStage.toLowerCase();
  const isCold = COLD_STAGE_HINTS.some((h) => stage.includes(h));

  if (isCold && tone === 'amical') {
    return 'Ce lead est en phase initiale — un ton plus formel pourrait mieux convenir.';
  }
  return null;
}
