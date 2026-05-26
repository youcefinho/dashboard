// ── lib/reconcile-engine.ts — Core CRM P0-3 (renforcement customer-reconcile) ─
//
// Helpers PURS (zéro I/O, zéro D1) pour le dédoublonnage / réconciliation
// customer↔lead↔contact : email exact, phone normalisé E.164, fuzzy name
// matching via Levenshtein normalisé. Tout est additif.
//
// CONTENU :
//   - RECONCILE_ERROR_CODES        codes erreur stables
//   - DEFAULT_FUZZY_THRESHOLD      0.85
//   - normalizeEmail               trim + lowercase
//   - normalizePhone               digits-only, last 10 (NA fallback)
//   - levenshteinDistance          DP classique O(n*m)
//   - computeFuzzyScore(a,b)       normalisé [0..1] basé Levenshtein
//   - findDuplicates(leads, opts)  retourne Match[] (pairs duplicates)
//   - mergeStrategy(a, b)          décide 'keep_a' / 'keep_b' / 'manual'
//
// AUCUNE dépendance Worker → 100 % unit-testable.

// ════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════

export const RECONCILE_ERROR_CODES = {
  INVALID_INPUT: 'reconcile_invalid_input',
  INVALID_THRESHOLD: 'reconcile_invalid_threshold',
  EMPTY_DATASET: 'reconcile_empty_dataset',
} as const;

export type ReconcileErrorCode =
  (typeof RECONCILE_ERROR_CODES)[keyof typeof RECONCILE_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════════════════

export const DEFAULT_FUZZY_THRESHOLD = 0.85 as const;
export const STRONG_MATCH_SCORE = 1.0 as const;       // email/phone exact
export const FUZZY_MATCH_FLOOR = 0.7 as const;        // sous ce score → ignoré

// ════════════════════════════════════════════════════════════
//  NORMALIZE
// ════════════════════════════════════════════════════════════

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Normalise un numéro de téléphone en gardant uniquement les chiffres,
 * puis prend les 10 derniers (cas North America +1 prefix optionnel).
 * Retourne '' si moins de 7 digits (numéros trop courts).
 */
export function normalizePhone(phone: unknown): string {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '';
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

/**
 * Normalise un nom pour comparaison fuzzy : lowercase, trim, espaces
 * collapsés. NE retire PAS les accents (le test compare verbatim normalisé).
 */
export function normalizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ════════════════════════════════════════════════════════════
//  LEVENSHTEIN
// ════════════════════════════════════════════════════════════

/**
 * Distance de Levenshtein classique (DP O(n*m), single-row optimization).
 * Pas de Damerau-transposition (Levenshtein pur).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  // Optimisation : single-row DP (O(m) mémoire au lieu de O(n*m))
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,        // suppression
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}

/**
 * Score fuzzy normalisé [0..1] basé sur Levenshtein.
 * Formule : 1 - distance / max(len(a), len(b)).
 *
 * Cas particuliers :
 *   - a === b               → 1.0
 *   - l'une des deux vide   → 0
 *   - non-strings           → 0
 *
 * NORMALISE en interne (lowercase + trim + collapse espaces).
 */
export function computeFuzzyScore(a: unknown, b: unknown): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  return Math.max(0, 1 - dist / maxLen);
}

// ════════════════════════════════════════════════════════════
//  FIND DUPLICATES
// ════════════════════════════════════════════════════════════

export interface LeadLike {
  id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export type MatchKind = 'email' | 'phone' | 'name';

export interface Match {
  a: string;          // lead id A
  b: string;          // lead id B
  score: number;      // [0..1]
  kind: MatchKind;
  reason: string;     // human-readable
}

export interface FindDuplicatesOptions {
  threshold?: number;   // défaut DEFAULT_FUZZY_THRESHOLD
  requireName?: boolean; // exiger un name pour fuzzy (défaut true)
}

/**
 * Détecte les paires de leads dupliqués. Stratégie en cascade :
 *   1) email exact normalisé → match score = 1.0, kind='email'
 *   2) phone exact normalisé (dernier 10 digits) → score = 1.0, kind='phone'
 *   3) fuzzy name ≥ threshold → score = computed, kind='name'
 *
 * Une paire (a,b) n'est listée qu'UNE FOIS (a.id < b.id en compare).
 * Threshold doit être [0..1]. Hors range → retourne erreur via console + 0 matches.
 *
 * COMPLEXITÉ : O(n²) — adapté pour batchs ≤ quelques milliers. Pour
 * datasets plus gros, l'appelant doit pre-bucketize par email/phone.
 */
export function findDuplicates(
  leads: readonly LeadLike[],
  opts: FindDuplicatesOptions = {},
): Match[] {
  const threshold =
    opts.threshold !== undefined ? opts.threshold : DEFAULT_FUZZY_THRESHOLD;
  if (
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    return [];
  }
  if (!Array.isArray(leads) || leads.length < 2) return [];

  const requireName = opts.requireName !== false; // défaut true
  const matches: Match[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < leads.length; i++) {
    const a = leads[i]!;
    for (let j = i + 1; j < leads.length; j++) {
      const b = leads[j]!;
      if (a.id === b.id) continue;

      const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(pairKey)) continue;

      // 1) Email exact
      const ea = normalizeEmail(a.email);
      const eb = normalizeEmail(b.email);
      if (ea && eb && ea === eb) {
        matches.push({
          a: a.id,
          b: b.id,
          score: 1,
          kind: 'email',
          reason: `email exact: ${ea}`,
        });
        seen.add(pairKey);
        continue;
      }

      // 2) Phone exact
      const pa = normalizePhone(a.phone);
      const pb = normalizePhone(b.phone);
      if (pa && pb && pa === pb) {
        matches.push({
          a: a.id,
          b: b.id,
          score: 1,
          kind: 'phone',
          reason: `phone exact: ${pa}`,
        });
        seen.add(pairKey);
        continue;
      }

      // 3) Fuzzy name
      const na = normalizeName(a.name);
      const nb = normalizeName(b.name);
      if (requireName && (!na || !nb)) continue;
      if (!na || !nb) continue;
      const score = computeFuzzyScore(a.name, b.name);
      if (score >= threshold) {
        matches.push({
          a: a.id,
          b: b.id,
          score,
          kind: 'name',
          reason: `name fuzzy: "${na}" ~ "${nb}" (score ${score.toFixed(2)})`,
        });
        seen.add(pairKey);
      }
    }
  }

  // Tri descendant par score (les meilleurs matches first)
  matches.sort((x, y) => y.score - x.score);
  return matches;
}

// ════════════════════════════════════════════════════════════
//  MERGE STRATEGY
// ════════════════════════════════════════════════════════════

export interface MergeCandidate {
  id: string;
  created_at?: string;
  updated_at?: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  status?: string;
  // signaux qualité optionnels
  score?: number | null;     // lead score
  activity_count?: number;   // nb d'activités
  is_verified?: boolean;
}

export type MergeDecision = 'keep_a' | 'keep_b' | 'manual';

/**
 * Heuristique de résolution merge : décide quel lead garder en cas de
 * duplicate. Règles :
 *   1) is_verified gagne sur non-verified
 *   2) Status 'won' > autres status (jamais perdre un lead converti)
 *   3) activity_count plus élevé gagne (si écart ≥ 3)
 *   4) lead score plus élevé gagne (si écart ≥ 10)
 *   5) plus récent gagne (updated_at puis created_at)
 *   6) ex æquo / signaux contradictoires → 'manual' (review humain)
 *
 * Retourne 'manual' aussi en cas d'inputs invalides (sans throw).
 */
export function mergeStrategy(
  a: MergeCandidate,
  b: MergeCandidate,
): MergeDecision {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return 'manual';
  }
  if (!a.id || !b.id || a.id === b.id) return 'manual';

  // 1) Verified
  if (a.is_verified && !b.is_verified) return 'keep_a';
  if (b.is_verified && !a.is_verified) return 'keep_b';

  // 2) Status 'won'
  const aWon = a.status === 'won';
  const bWon = b.status === 'won';
  if (aWon && !bWon) return 'keep_a';
  if (bWon && !aWon) return 'keep_b';

  // 3) Activity count
  const actA = typeof a.activity_count === 'number' ? a.activity_count : 0;
  const actB = typeof b.activity_count === 'number' ? b.activity_count : 0;
  if (Math.abs(actA - actB) >= 3) {
    return actA > actB ? 'keep_a' : 'keep_b';
  }

  // 4) Lead score
  const scA = typeof a.score === 'number' ? a.score : 0;
  const scB = typeof b.score === 'number' ? b.score : 0;
  if (Math.abs(scA - scB) >= 10) {
    return scA > scB ? 'keep_a' : 'keep_b';
  }

  // 5) Plus récent (updated_at puis created_at)
  const uaA = a.updated_at ? Date.parse(a.updated_at) : NaN;
  const uaB = b.updated_at ? Date.parse(b.updated_at) : NaN;
  if (!Number.isNaN(uaA) && !Number.isNaN(uaB) && uaA !== uaB) {
    return uaA > uaB ? 'keep_a' : 'keep_b';
  }
  const caA = a.created_at ? Date.parse(a.created_at) : NaN;
  const caB = b.created_at ? Date.parse(b.created_at) : NaN;
  if (!Number.isNaN(caA) && !Number.isNaN(caB) && caA !== caB) {
    return caA > caB ? 'keep_a' : 'keep_b';
  }

  // 6) Indécidable
  return 'manual';
}
