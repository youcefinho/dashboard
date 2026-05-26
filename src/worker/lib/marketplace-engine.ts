// ── marketplace-engine.ts — Helpers PURS marketplace (RENFORCEMENT P1-6) ───
//
// Contrat ADDITIF — 100% : aucun import depuis marketplace.ts existant.
// Helpers PURS (zéro I/O) pour :
//   - Validation des listings (kind, title, description, category, status)
//   - Validation des filtres de search (query, type, price range, sort)
//   - Score pondéré pour tri marketplace (popularité + rating + recency)
//   - Validation des reviews (rating 1..5)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const MARKETPLACE_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_KIND: 'INVALID_KIND',
  INVALID_LISTING_TYPE: 'INVALID_LISTING_TYPE',
  MISSING_TITLE: 'MISSING_TITLE',
  TITLE_TOO_LONG: 'TITLE_TOO_LONG',
  DESCRIPTION_TOO_LONG: 'DESCRIPTION_TOO_LONG',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_SORT: 'INVALID_SORT',
  INVALID_PRICE_RANGE: 'INVALID_PRICE_RANGE',
  INVALID_RATING: 'INVALID_RATING',
  LISTING_NOT_FOUND: 'LISTING_NOT_FOUND',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
} as const;

export type MarketplaceErrorCode =
  (typeof MARKETPLACE_ERROR_CODES)[keyof typeof MARKETPLACE_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes énumérations (frozen)
// ════════════════════════════════════════════════════════════════════════════

// Types de templates publiables (calque marketplace.ts:KINDS).
export const VALID_LISTING_TYPES = Object.freeze([
  'funnel',
  'workflow',
  'sequence',
] as const);
export type MarketplaceListingType = (typeof VALID_LISTING_TYPES)[number];

// Statuts (draft = publisher only, published = public).
export const VALID_LISTING_STATUSES = Object.freeze([
  'draft',
  'published',
  'archived',
] as const);
export type MarketplaceListingStatus = (typeof VALID_LISTING_STATUSES)[number];

// Sort options whitelistées (anti-injection ORDER BY).
export const VALID_SORT_OPTIONS = Object.freeze([
  'popular',
  'recent',
  'rating',
] as const);
export type MarketplaceSort = (typeof VALID_SORT_OPTIONS)[number];

// Bornes max applicatives.
export const MARKETPLACE_TITLE_MAX = 200;
export const MARKETPLACE_DESC_MAX = 1000;
export const MARKETPLACE_CATEGORY_MAX = 80;
export const MARKETPLACE_QUERY_MAX = 120;
export const MARKETPLACE_REVIEW_COMMENT_MAX = 2000;
export const MARKETPLACE_RATING_MIN = 1;
export const MARKETPLACE_RATING_MAX = 5;

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

export function isValidListingType(v: unknown): v is MarketplaceListingType {
  return (
    typeof v === 'string' &&
    (VALID_LISTING_TYPES as readonly string[]).includes(v)
  );
}

export function isValidListingStatus(v: unknown): v is MarketplaceListingStatus {
  return (
    typeof v === 'string' &&
    (VALID_LISTING_STATUSES as readonly string[]).includes(v)
  );
}

export function isValidSort(v: unknown): v is MarketplaceSort {
  return (
    typeof v === 'string' && (VALID_SORT_OPTIONS as readonly string[]).includes(v)
  );
}

export function isValidRating(v: unknown): boolean {
  const n = Math.round(Number(v));
  return (
    Number.isFinite(n) &&
    n >= MARKETPLACE_RATING_MIN &&
    n <= MARKETPLACE_RATING_MAX
  );
}

// ════════════════════════════════════════════════════════════════════════════
// validateListingInput
// ════════════════════════════════════════════════════════════════════════════

export type ListingInput = {
  kind?: unknown;
  source_id?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  status?: unknown;
};

export type ListingValidationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; code: MarketplaceErrorCode };

/**
 * Valide un input de publish marketplace.
 * Requis : kind, source_id.
 * Optionnels : title (max 200), description (max 1000), category (max 80),
 * status (draft|published).
 */
export function validateListingInput(
  input: ListingInput | null | undefined,
): ListingValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Requête invalide',
      code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
    };
  }

  if (!isValidListingType(input.kind)) {
    return {
      ok: false,
      error: 'Type de template invalide',
      field: 'kind',
      code: MARKETPLACE_ERROR_CODES.INVALID_LISTING_TYPE,
    };
  }

  if (
    typeof input.source_id !== 'string' ||
    input.source_id.trim() === ''
  ) {
    return {
      ok: false,
      error: 'source_id requis',
      field: 'source_id',
      code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
    };
  }

  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string') {
      return {
        ok: false,
        error: 'Titre invalide',
        field: 'title',
        code: MARKETPLACE_ERROR_CODES.MISSING_TITLE,
      };
    }
    if (input.title.length > MARKETPLACE_TITLE_MAX) {
      return {
        ok: false,
        error: 'Titre trop long',
        field: 'title',
        code: MARKETPLACE_ERROR_CODES.TITLE_TOO_LONG,
      };
    }
  }

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') {
      return {
        ok: false,
        error: 'Description invalide',
        field: 'description',
        code: MARKETPLACE_ERROR_CODES.DESCRIPTION_TOO_LONG,
      };
    }
    if (input.description.length > MARKETPLACE_DESC_MAX) {
      return {
        ok: false,
        error: 'Description trop longue',
        field: 'description',
        code: MARKETPLACE_ERROR_CODES.DESCRIPTION_TOO_LONG,
      };
    }
  }

  if (input.category !== undefined && input.category !== null) {
    if (typeof input.category !== 'string') {
      return {
        ok: false,
        error: 'Catégorie invalide',
        field: 'category',
        code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
      };
    }
    if (input.category.length > MARKETPLACE_CATEGORY_MAX) {
      return {
        ok: false,
        error: 'Catégorie trop longue',
        field: 'category',
        code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
      };
    }
  }

  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!isValidListingStatus(input.status)) {
      return {
        ok: false,
        error: 'Statut invalide',
        field: 'status',
        code: MARKETPLACE_ERROR_CODES.INVALID_STATUS,
      };
    }
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// validateSearchFilters
// ════════════════════════════════════════════════════════════════════════════

export type SearchFilters = {
  q?: unknown;
  type?: unknown;
  kind?: unknown;
  category?: unknown;
  sort?: unknown;
  min_price?: unknown;
  max_price?: unknown;
};

export type SearchValidationResult =
  | { ok: true; normalized: NormalizedSearchFilters }
  | { ok: false; error: string; field?: string; code: MarketplaceErrorCode };

export type NormalizedSearchFilters = {
  q: string | null;
  type: MarketplaceListingType | null;
  category: string | null;
  sort: MarketplaceSort;
  minPrice: number | null;
  maxPrice: number | null;
};

/**
 * Valide + normalise des filtres de search marketplace.
 * - q : max MARKETPLACE_QUERY_MAX chars
 * - type : optionnel, doit appartenir à VALID_LISTING_TYPES
 * - category : optionnel, max MARKETPLACE_CATEGORY_MAX
 * - sort : optionnel, défaut 'popular'
 * - min_price / max_price : optionnel, >= 0, min <= max
 */
export function validateSearchFilters(
  filters: SearchFilters | null | undefined,
): SearchValidationResult {
  const f = filters && typeof filters === 'object' ? filters : {};

  let q: string | null = null;
  if (f.q !== undefined && f.q !== null && f.q !== '') {
    if (typeof f.q !== 'string') {
      return {
        ok: false,
        error: 'Query invalide',
        field: 'q',
        code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
      };
    }
    q = f.q.length > MARKETPLACE_QUERY_MAX
      ? f.q.slice(0, MARKETPLACE_QUERY_MAX)
      : f.q;
  }

  // type ou kind (aliases — marketplace.ts utilise kind, certains tests utilisent type).
  let type: MarketplaceListingType | null = null;
  const rawType = f.type !== undefined ? f.type : f.kind;
  if (rawType !== undefined && rawType !== null && rawType !== '') {
    if (!isValidListingType(rawType)) {
      return {
        ok: false,
        error: 'Type invalide',
        field: 'type',
        code: MARKETPLACE_ERROR_CODES.INVALID_LISTING_TYPE,
      };
    }
    type = rawType;
  }

  let category: string | null = null;
  if (f.category !== undefined && f.category !== null && f.category !== '') {
    if (typeof f.category !== 'string') {
      return {
        ok: false,
        error: 'Catégorie invalide',
        field: 'category',
        code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
      };
    }
    category =
      f.category.length > MARKETPLACE_CATEGORY_MAX
        ? f.category.slice(0, MARKETPLACE_CATEGORY_MAX)
        : f.category;
  }

  let sort: MarketplaceSort = 'popular';
  if (f.sort !== undefined && f.sort !== null && f.sort !== '') {
    if (!isValidSort(f.sort)) {
      return {
        ok: false,
        error: 'Tri invalide',
        field: 'sort',
        code: MARKETPLACE_ERROR_CODES.INVALID_SORT,
      };
    }
    sort = f.sort;
  }

  let minPrice: number | null = null;
  if (f.min_price !== undefined && f.min_price !== null && f.min_price !== '') {
    const n = Number(f.min_price);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        error: 'Prix min invalide',
        field: 'min_price',
        code: MARKETPLACE_ERROR_CODES.INVALID_PRICE_RANGE,
      };
    }
    minPrice = n;
  }

  let maxPrice: number | null = null;
  if (f.max_price !== undefined && f.max_price !== null && f.max_price !== '') {
    const n = Number(f.max_price);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        error: 'Prix max invalide',
        field: 'max_price',
        code: MARKETPLACE_ERROR_CODES.INVALID_PRICE_RANGE,
      };
    }
    maxPrice = n;
  }

  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return {
      ok: false,
      error: 'Plage de prix invalide (min > max)',
      field: 'min_price',
      code: MARKETPLACE_ERROR_CODES.INVALID_PRICE_RANGE,
    };
  }

  return {
    ok: true,
    normalized: { q, type, category, sort, minPrice, maxPrice },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// computeListingScore — sort pondéré (helper interne pour tri custom)
// ════════════════════════════════════════════════════════════════════════════

export type ListingForScore = {
  install_count?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  created_at?: number | string | null;
};

/**
 * Calcule un score pondéré pour ranking marketplace.
 *
 * Formule (poids tunable) :
 *   score = installs * 1.0 + ratingAvg * ratingCount * 5.0 + recencyBonus
 *
 * recencyBonus = boost décroissant pour items créés < 30j.
 */
export function computeListingScore(
  listing: ListingForScore | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!listing) return 0;
  const installs = Number(listing.install_count) || 0;
  const ratingAvg = Number(listing.rating_avg) || 0;
  const ratingCount = Number(listing.rating_count) || 0;

  let recency = 0;
  if (listing.created_at != null) {
    const createdMs =
      typeof listing.created_at === 'number'
        ? listing.created_at * (listing.created_at < 1e12 ? 1000 : 1)
        : Date.parse(String(listing.created_at));
    if (Number.isFinite(createdMs)) {
      const ageDays = (nowMs - createdMs) / (1000 * 60 * 60 * 24);
      if (ageDays >= 0 && ageDays < 30) {
        // boost linéaire : 30 → 0, 0 → 30
        recency = Math.max(0, 30 - ageDays);
      }
    }
  }

  return installs * 1.0 + ratingAvg * ratingCount * 5.0 + recency;
}

// ════════════════════════════════════════════════════════════════════════════
// validateReviewInput
// ════════════════════════════════════════════════════════════════════════════

export type ReviewInput = {
  rating?: unknown;
  comment?: unknown;
};

export type ReviewValidationResult =
  | { ok: true; rating: number; comment: string }
  | { ok: false; error: string; field?: string; code: MarketplaceErrorCode };

export function validateReviewInput(
  input: ReviewInput | null | undefined,
): ReviewValidationResult {
  const i = input && typeof input === 'object' ? input : {};
  const rating = Math.round(Number(i.rating));
  if (!isValidRating(rating)) {
    return {
      ok: false,
      error: 'Note invalide (1 à 5)',
      field: 'rating',
      code: MARKETPLACE_ERROR_CODES.INVALID_RATING,
    };
  }
  let comment = '';
  if (i.comment != null) {
    if (typeof i.comment !== 'string') {
      return {
        ok: false,
        error: 'Commentaire invalide',
        field: 'comment',
        code: MARKETPLACE_ERROR_CODES.INVALID_INPUT,
      };
    }
    comment = i.comment.slice(0, MARKETPLACE_REVIEW_COMMENT_MAX);
  }
  return { ok: true, rating, comment };
}
