// ── ecommerce-reco-engine.ts ──────────────────────────────────────────────
// Helpers PURS pour `ecommerce-reco.ts` (P2-3) :
//   - RECO_ERROR_CODES (frozen)
//   - VALID_ALGORITHMS (popularity|collaborative|cross_sell|recently_viewed|
//     bestsellers, frozen)
//   - computePopularityScore(views, addToCart, purchases) → number (pondéré)
//   - findCrossSellCandidates(productOrders, targetProductId, threshold)
//     → string[] (co-occurrence)
//   - rankRecommendations(products, scoreFn) → top N
//   - validateRecoQuery(query) → Result
//
// Conventions strictes :
//   - PURS : aucune dépendance DB / Env.
//   - Garde défensive : entrées invalides ⇒ tableaux vides (jamais throw).
//   - Bornage : RECO_LIMIT_MAX aligné sur ecommerce-reco.ts:26.
//   - Additif strict — NE modifie PAS ecommerce-reco.ts.

/** Codes d'erreur normalisés (frozen). */
export const RECO_ERROR_CODES = Object.freeze({
  ALGORITHM_INVALID: 'ALGORITHM_INVALID',
  PRODUCT_ID_INVALID: 'PRODUCT_ID_INVALID',
  LIMIT_INVALID: 'LIMIT_INVALID',
  THRESHOLD_INVALID: 'THRESHOLD_INVALID',
  QUERY_INVALID: 'QUERY_INVALID',
} as const);

export type RecoErrorCode = (typeof RECO_ERROR_CODES)[keyof typeof RECO_ERROR_CODES];

/** Algorithmes whitelistés (frozen). */
export const VALID_ALGORITHMS = Object.freeze([
  'popularity',
  'collaborative',
  'cross_sell',
  'recently_viewed',
  'bestsellers',
] as const);

export type RecoAlgorithm = (typeof VALID_ALGORITHMS)[number];

// Bornes défensives (aligné ecommerce-reco.ts:26 RECO_LIMIT = 8).
export const RECO_LIMIT_DEFAULT = 8;
export const RECO_LIMIT_MAX = 50;

// Poids du score de popularité (ajustables — somme = 1.0).
const POPULARITY_WEIGHTS = Object.freeze({
  view: 0.1, // vue produit = signal faible
  addToCart: 0.3, // ajout panier = signal moyen
  purchase: 0.6, // achat = signal fort
});

// ────────────────────────────────────────────────────────────────────────────
// computePopularityScore — score pondéré multi-signaux.
//
// Score = views×0.1 + addToCart×0.3 + purchases×0.6. Garde défensive : valeurs
// non finies / négatives ⇒ 0. Retour arrondi entier (rangs comparables).
// ────────────────────────────────────────────────────────────────────────────

export function computePopularityScore(
  views: number,
  addToCart: number,
  purchases: number,
): number {
  const v = Number.isFinite(views) ? Math.max(0, views) : 0;
  const a = Number.isFinite(addToCart) ? Math.max(0, addToCart) : 0;
  const p = Number.isFinite(purchases) ? Math.max(0, purchases) : 0;
  const score =
    v * POPULARITY_WEIGHTS.view +
    a * POPULARITY_WEIGHTS.addToCart +
    p * POPULARITY_WEIGHTS.purchase;
  return Math.round(score * 100) / 100; // 2 décimales
}

// ────────────────────────────────────────────────────────────────────────────
// findCrossSellCandidates — co-occurrence simple par commande.
//
// productOrders : Map<orderId, productId[]>. Retourne les productIds qui
// apparaissent dans ≥ threshold commandes contenant targetProductId, triés
// par fréquence DESC.
//
// Garde défensive : Map non itérable ⇒ [] ; threshold < 1 ⇒ 1.
// ────────────────────────────────────────────────────────────────────────────

export function findCrossSellCandidates(
  productOrders: Map<string, string[]> | Array<[string, string[]]>,
  targetProductId: string,
  threshold: number = 1,
): string[] {
  if (!targetProductId || typeof targetProductId !== 'string') return [];
  const minCount = Math.max(1, Math.round(Number.isFinite(threshold) ? threshold : 1));

  // Normaliser en Map.
  let iter: Iterable<[string, string[]]>;
  if (productOrders instanceof Map) {
    iter = productOrders.entries();
  } else if (Array.isArray(productOrders)) {
    iter = productOrders as Array<[string, string[]]>;
  } else {
    return [];
  }

  const coOccur = new Map<string, number>();
  for (const [, items] of iter) {
    if (!Array.isArray(items)) continue;
    if (!items.includes(targetProductId)) continue;
    for (const pid of items) {
      if (typeof pid !== 'string' || pid === targetProductId) continue;
      coOccur.set(pid, (coOccur.get(pid) || 0) + 1);
    }
  }

  return Array.from(coOccur.entries())
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([pid]) => pid);
}

// ────────────────────────────────────────────────────────────────────────────
// rankRecommendations — top N selon scoreFn (générique).
//
// Garde défensive : products non array ⇒ [] ; scoreFn non function ⇒ ordre
// d'entrée préservé ; limit > RECO_LIMIT_MAX ⇒ cap à RECO_LIMIT_MAX.
//
// Tri stable : si scores égaux, ordre d'entrée préservé.
// ────────────────────────────────────────────────────────────────────────────

export interface RankedProduct<T> {
  product: T;
  score: number;
}

export function rankRecommendations<T>(
  products: T[],
  scoreFn: (p: T) => number,
  limit: number = RECO_LIMIT_DEFAULT,
): T[] {
  if (!Array.isArray(products) || products.length === 0) return [];
  const n =
    Number.isFinite(limit) && limit > 0 ? Math.min(RECO_LIMIT_MAX, Math.round(limit)) : RECO_LIMIT_DEFAULT;

  const scorer = typeof scoreFn === 'function' ? scoreFn : () => 0;

  // Indexé pour tri stable (préserve l'ordre d'entrée si scores égaux).
  const indexed: Array<{ p: T; s: number; i: number }> = products.map((p, i) => {
    let s = 0;
    try {
      s = scorer(p);
    } catch {
      s = 0;
    }
    if (!Number.isFinite(s)) s = 0;
    return { p, s, i };
  });

  indexed.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    return a.i - b.i; // stabilité
  });

  return indexed.slice(0, n).map((x) => x.p);
}

// ────────────────────────────────────────────────────────────────────────────
// validateRecoQuery — valide { algorithm, productId, limit?, threshold? }.
// ────────────────────────────────────────────────────────────────────────────

export interface RecoQuery {
  algorithm?: unknown;
  productId?: unknown;
  limit?: unknown;
  threshold?: unknown;
}

export interface RecoValidation {
  ok: boolean;
  error?: string;
  code?: RecoErrorCode;
  field?: string;
}

export function validateRecoQuery(query: RecoQuery): RecoValidation {
  if (!query || typeof query !== 'object') {
    return {
      ok: false,
      error: 'Requête reco requise',
      code: RECO_ERROR_CODES.QUERY_INVALID,
    };
  }
  if (
    typeof query.algorithm !== 'string' ||
    !VALID_ALGORITHMS.includes(query.algorithm as RecoAlgorithm)
  ) {
    return {
      ok: false,
      error: `Algorithme invalide (attendu: ${VALID_ALGORITHMS.join('|')})`,
      code: RECO_ERROR_CODES.ALGORITHM_INVALID,
      field: 'algorithm',
    };
  }
  // productId obligatoire pour algos contextuels.
  const needsProduct =
    query.algorithm === 'collaborative' ||
    query.algorithm === 'cross_sell' ||
    query.algorithm === 'recently_viewed';
  if (needsProduct) {
    if (typeof query.productId !== 'string' || !query.productId.trim()) {
      return {
        ok: false,
        error: `productId requis pour algorithm=${query.algorithm}`,
        code: RECO_ERROR_CODES.PRODUCT_ID_INVALID,
        field: 'productId',
      };
    }
  }
  if (query.limit != null) {
    if (typeof query.limit !== 'number' || !Number.isFinite(query.limit) || query.limit < 1) {
      return {
        ok: false,
        error: 'limit invalide (≥ 1 requis)',
        code: RECO_ERROR_CODES.LIMIT_INVALID,
        field: 'limit',
      };
    }
    if (query.limit > RECO_LIMIT_MAX) {
      return {
        ok: false,
        error: `limit trop grand (max ${RECO_LIMIT_MAX})`,
        code: RECO_ERROR_CODES.LIMIT_INVALID,
        field: 'limit',
      };
    }
  }
  if (query.threshold != null) {
    if (
      typeof query.threshold !== 'number' ||
      !Number.isFinite(query.threshold) ||
      query.threshold < 1
    ) {
      return {
        ok: false,
        error: 'threshold invalide (≥ 1 requis)',
        code: RECO_ERROR_CODES.THRESHOLD_INVALID,
        field: 'threshold',
      };
    }
  }
  return { ok: true };
}
