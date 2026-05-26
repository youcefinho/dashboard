// ── catalog-engine.ts — Helpers PURS catalogue (RENFORCEMENT Misc P1-6) ────
//
// Contrat ADDITIF — 100% : aucun import depuis catalog.ts existant, aucun
// remplacement de logique vivante. Helpers PURS (zéro I/O) pour :
//   - Validation des items catalogue (kind, recurrence, price, currency)
//   - Normalisation prix (dollars vs cents)
//   - Validation catégorie / nom
//
// catalog.ts garde son comportement byte-identique. Ces helpers peuvent
// servir aux handlers (refactor opt-in) ou aux tests d'intégration.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const CATALOG_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_NAME: 'MISSING_NAME',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  INVALID_KIND: 'INVALID_KIND',
  INVALID_RECURRENCE: 'INVALID_RECURRENCE',
  INVALID_PRICE: 'INVALID_PRICE',
  NEGATIVE_PRICE: 'NEGATIVE_PRICE',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  CATEGORY_TOO_LONG: 'CATEGORY_TOO_LONG',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
} as const;

export type CatalogErrorCode =
  (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes énumérations (frozen)
// ════════════════════════════════════════════════════════════════════════════

export const VALID_KINDS = Object.freeze([
  'service',
  'product',
  'subscription',
] as const);
export type CatalogKind = (typeof VALID_KINDS)[number];

export const VALID_RECURRENCES = Object.freeze([
  'one_time',
  'monthly',
  'quarterly',
  'yearly',
] as const);
export type CatalogRecurrence = (typeof VALID_RECURRENCES)[number];

// Devises supportées (whitelist applicative — alignée invoice-engine).
export const VALID_CURRENCIES_CATALOG = Object.freeze([
  'CAD',
  'USD',
  'EUR',
  'GBP',
] as const);
export type CatalogCurrency = (typeof VALID_CURRENCIES_CATALOG)[number];

// Bornes max applicatives.
export const CATALOG_NAME_MAX = 200;
export const CATALOG_DESC_MAX = 5000;
export const CATALOG_CATEGORY_MAX = 100;
export const CATALOG_PRICE_MAX = 1_000_000_000; // 1B (dollars ou cents selon contexte)

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

export function isValidKind(v: unknown): v is CatalogKind {
  return typeof v === 'string' && (VALID_KINDS as readonly string[]).includes(v);
}

export function isValidRecurrence(v: unknown): v is CatalogRecurrence {
  return (
    typeof v === 'string' && (VALID_RECURRENCES as readonly string[]).includes(v)
  );
}

export function isValidCurrency(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const up = v.toUpperCase();
  return (VALID_CURRENCIES_CATALOG as readonly string[]).includes(up);
}

/**
 * Valide une catégorie (string libre <= CATALOG_CATEGORY_MAX).
 * null/undefined/'' = autorisé (optionnel).
 */
export function validateCategory(cat: unknown): boolean {
  if (cat == null) return true;
  if (typeof cat !== 'string') return false;
  return cat.length <= CATALOG_CATEGORY_MAX;
}

// ════════════════════════════════════════════════════════════════════════════
// normalizePrice — accepte string|number, retourne nombre >= 0
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalise un prix utilisateur vers un nombre fini >= 0.
 * - string : parseFloat (gère virgule décimale aussi)
 * - number : tel quel si fini
 * - autre : 0
 * Retourne NaN si non parsable (pour permettre détection upstream).
 */
export function normalizePrice(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, value) : Number.NaN;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/,/g, '.');
    if (cleaned === '') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.max(0, n) : Number.NaN;
  }
  return Number.NaN;
}

/**
 * Convertit un prix en dollars (number/string) vers cents (integer).
 * Utile pour module marketplace/invoice ou import de products.base_price.
 */
export function dollarsToCents(value: unknown): number {
  const dollars = normalizePrice(value);
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/**
 * Convertit des cents vers dollars (avec 2 décimales).
 */
export function centsToDollars(cents: unknown): number {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

// ════════════════════════════════════════════════════════════════════════════
// validateCatalogItemInput
// ════════════════════════════════════════════════════════════════════════════

export type CatalogItemInput = {
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  unit_price?: unknown;
  currency?: unknown;
  category?: unknown;
  recurrence?: unknown;
  is_active?: unknown;
};

export type CatalogValidationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; code: CatalogErrorCode };

/**
 * Valide un input de création/update d'item catalogue.
 * - Champs requis : name (non vide).
 * - Champs optionnels validés : kind, recurrence, unit_price, currency, category.
 * - Mode 'create' = name requis ; mode 'update' = champs partiels.
 */
export function validateCatalogItemInput(
  input: CatalogItemInput | null | undefined,
  mode: 'create' | 'update' = 'create',
): CatalogValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Requête invalide',
      code: CATALOG_ERROR_CODES.INVALID_INPUT,
    };
  }

  // name : requis en create, optionnel en update (mais si fourni doit être valide).
  if (mode === 'create') {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return {
        ok: false,
        error: 'Le nom est requis',
        field: 'name',
        code: CATALOG_ERROR_CODES.MISSING_NAME,
      };
    }
    if (input.name.length > CATALOG_NAME_MAX) {
      return {
        ok: false,
        error: 'Nom trop long',
        field: 'name',
        code: CATALOG_ERROR_CODES.NAME_TOO_LONG,
      };
    }
  } else if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return {
        ok: false,
        error: 'Le nom ne peut pas être vide',
        field: 'name',
        code: CATALOG_ERROR_CODES.MISSING_NAME,
      };
    }
    if (input.name.length > CATALOG_NAME_MAX) {
      return {
        ok: false,
        error: 'Nom trop long',
        field: 'name',
        code: CATALOG_ERROR_CODES.NAME_TOO_LONG,
      };
    }
  }

  // kind : optionnel mais si fourni doit appartenir à VALID_KINDS.
  if (input.kind !== undefined && !isValidKind(input.kind)) {
    return {
      ok: false,
      error: 'Type invalide',
      field: 'kind',
      code: CATALOG_ERROR_CODES.INVALID_KIND,
    };
  }

  // recurrence : optionnel mais si fourni doit appartenir à VALID_RECURRENCES.
  if (input.recurrence !== undefined && !isValidRecurrence(input.recurrence)) {
    return {
      ok: false,
      error: 'Récurrence invalide',
      field: 'recurrence',
      code: CATALOG_ERROR_CODES.INVALID_RECURRENCE,
    };
  }

  // unit_price : optionnel mais si fourni doit être un nombre >= 0.
  if (input.unit_price !== undefined && input.unit_price !== null) {
    // Détection négatif AVANT clamp (normalizePrice clampe avec Math.max(0,…)).
    const raw = input.unit_price;
    let rawNumber: number = Number.NaN;
    if (typeof raw === 'number') {
      rawNumber = raw;
    } else if (typeof raw === 'string') {
      const cleaned = raw.trim().replace(/,/g, '.');
      if (cleaned !== '') rawNumber = Number(cleaned);
    }
    if (!Number.isFinite(rawNumber)) {
      // string vide → 0 (cas accepté), sinon invalid.
      const isEmptyString = typeof raw === 'string' && raw.trim() === '';
      if (!isEmptyString) {
        return {
          ok: false,
          error: 'Prix invalide',
          field: 'unit_price',
          code: CATALOG_ERROR_CODES.INVALID_PRICE,
        };
      }
    } else if (rawNumber < 0) {
      return {
        ok: false,
        error: 'Prix négatif interdit',
        field: 'unit_price',
        code: CATALOG_ERROR_CODES.NEGATIVE_PRICE,
      };
    } else if (rawNumber > CATALOG_PRICE_MAX) {
      return {
        ok: false,
        error: 'Prix hors borne',
        field: 'unit_price',
        code: CATALOG_ERROR_CODES.INVALID_PRICE,
      };
    }
  }

  // currency : optionnel (défaut CAD). Si fourni → whitelist.
  if (input.currency !== undefined && input.currency !== null && input.currency !== '') {
    if (!isValidCurrency(input.currency)) {
      return {
        ok: false,
        error: 'Devise invalide',
        field: 'currency',
        code: CATALOG_ERROR_CODES.INVALID_CURRENCY,
      };
    }
  }

  // category : optionnel mais longueur bornée.
  if (input.category !== undefined && input.category !== null) {
    if (!validateCategory(input.category)) {
      return {
        ok: false,
        error: 'Catégorie invalide',
        field: 'category',
        code: CATALOG_ERROR_CODES.CATEGORY_TOO_LONG,
      };
    }
  }

  return { ok: true };
}
