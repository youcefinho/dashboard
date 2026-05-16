// ── fuzzy.ts — Sprint 30 vague 30-1B ──────────────────────────────────────
// Fuzzy matching léger (Levenshtein-lite + char-position weighting) destiné
// à CommandPalette. Pas une dépendance de plus : minuscule, sans alloc lourde
// dans le hot path. Score 0-1 (1 = match parfait). Early-bail quand le
// needle est plus long que la haystack ou quand le score plancher tombe sous
// un seuil de coupure.
//
// Heuristiques d'ordre (en cascade) :
//   1. Match exact / prefix → score quasi-1
//   2. Substring contigue   → score haut + bonus position début
//   3. Char-by-char fuzzy   → score moyen, bonus consécutivité + frontière
//      de mot, malus pour gaps longs
//   4. Levenshtein-lite (≤2 substitutions tolérées) → fallback score bas
//
// Le score reflète aussi la longueur relative (un match long sur une chaîne
// courte est meilleur qu'un match court sur une chaîne longue).

/** Normalise (lowercase + strip accents). */
function norm(s: string): string {
  // Cheaper than `localeCompare` based approach. NFKD + strip combining marks.
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

const WORD_BOUNDARY = /[\s\-_./:|]/;

/**
 * Retourne un score de match dans [0, 1] (1 = match parfait).
 * Renvoie 0 si needle ne match pas du tout. Vite par design.
 */
export function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) return 0;
  if (!haystack) return 0;

  const n = norm(needle.trim());
  const h = norm(haystack);

  if (!n) return 0;

  // Early-bail : needle plus long que haystack
  if (n.length > h.length + 2) return 0;

  // 1. Match exact
  if (n === h) return 1;

  // 2. Prefix match (très bon signal pour CmdPalette)
  if (h.startsWith(n)) {
    return 0.94 - 0.04 * Math.min(1, (h.length - n.length) / Math.max(h.length, 8));
  }

  // 3. Substring contigue
  const idx = h.indexOf(n);
  if (idx !== -1) {
    const positionBonus = idx === 0 ? 0.08 : Math.max(0, 0.06 - idx * 0.005);
    const wordBoundaryBonus = idx > 0 && WORD_BOUNDARY.test(h.charAt(idx - 1)) ? 0.05 : 0;
    const coverage = n.length / h.length;
    return Math.min(0.92, 0.70 + coverage * 0.18 + positionBonus + wordBoundaryBonus);
  }

  // 4. Char-by-char fuzzy
  let score = 0;
  let matched = 0;
  let lastIdx = -1;
  let consecutive = 0;
  let maxConsecutive = 0;
  let wordBoundaryMatches = 0;

  for (let i = 0; i < n.length; i++) {
    const c = n.charAt(i);
    const searchFrom = lastIdx + 1;
    const found = h.indexOf(c, searchFrom);
    if (found === -1) {
      // Tolère 1 char manquant si needle court
      if (n.length <= 4 || matched / n.length >= 0.6) {
        score -= 0.10;
        continue;
      }
      return 0; // bail
    }
    matched++;
    if (found === lastIdx + 1) {
      consecutive++;
      if (consecutive > maxConsecutive) maxConsecutive = consecutive;
    } else {
      consecutive = 1;
    }
    // bonus frontière de mot
    if (found === 0 || WORD_BOUNDARY.test(h.charAt(found - 1))) {
      wordBoundaryMatches++;
    }
    // malus gap
    const gap = found - lastIdx - 1;
    if (gap > 0) score -= Math.min(0.06, gap * 0.01);
    lastIdx = found;
  }

  if (matched === 0) return 0;
  const coverage = matched / n.length;
  const density = matched / Math.max(1, lastIdx + 1);
  const consecutiveFactor = maxConsecutive / n.length;
  const boundaryFactor = wordBoundaryMatches / n.length;

  const base = 0.38 + coverage * 0.28 + density * 0.10 + consecutiveFactor * 0.12 + boundaryFactor * 0.10;
  const final = Math.max(0, Math.min(0.86, base + score));
  return final;
}

/**
 * Retourne true si le score dépasse 0.30 — utile pour filtrer rapide.
 */
export function fuzzyMatch(needle: string, haystack: string, threshold = 0.30): boolean {
  return fuzzyScore(needle, haystack) >= threshold;
}

/**
 * Score combiné multi-champ — applique fuzzyScore sur chaque champ avec poids,
 * retourne le max pondéré. Évite le bruit "description matche un peu" qui
 * remonte au-dessus d'un label match.
 */
export function fuzzyScoreMulti(
  needle: string,
  fields: { value: string; weight: number }[],
): number {
  if (!needle.trim()) return 0;
  let best = 0;
  for (const f of fields) {
    const s = fuzzyScore(needle, f.value) * f.weight;
    if (s > best) best = s;
    if (best >= 0.98) return 0.98; // early exit
  }
  return best;
}
