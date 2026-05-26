// ── Products engine — Sprint P0-4 renforcement (2026-05-26) ────────────────
//
// Helpers PURS (zéro D1, zéro réseau) extraits/complémentaires à
// `ecommerce-products.ts` pour :
//   - centraliser la validation SKU (regex stricte, longueur ≤ 64).
//   - validation produit (titre, prix cents int ≥ 0, currency ISO 4217).
//   - validation matrice variantes (axes cartésiens, pas de doublons).
//   - normalisation prix (string "12.50" / "$12.50" / 1250 → 1250 cents).
//   - whitelist currencies supportées (FIGÉE — alignée multicurrency-engine).
//
// Politique :
//   - Aucun helper ne throw — résultats structurés `{ ok, error?, field? }`
//     ou boolean (calque `lib/product-reviews-engine.ts`).
//   - Codes d'erreur stables `PRODUCT_ERROR_CODES` (logs / audit / tests).
//   - 100% additif : handlers `ecommerce-products.ts` peuvent CONSOMMER ces
//     helpers (refactor optionnel), mais leur contrat reste FIGÉ.
//   - Multi-tenant : ce module ne touche PAS la DB ; l'unicité SKU par tenant
//     reste vérifiée dans le handler (qui injecte clientId au SELECT).
//   - JAMAIS log le prix raw ni la currency (PII budget hygiène — pas
//     sensible mais on aligne le pattern engines existants).

// ── Constantes contrat figées ───────────────────────────────────────────────

/** Longueur max SKU (calque schémas Shopify/WooCommerce courants). */
export const MAX_SKU_LENGTH = 64;
/** Longueur min SKU significative (anti-SKU "x" / "1"). */
export const MIN_SKU_LENGTH = 2;
/** Cap variantes par produit (anti-DoS matrice 1000×1000). */
export const MAX_VARIANTS = 100;
/** Cap axes (taille / couleur / matériau …) — calque Shopify (3 axes). */
export const MAX_VARIANT_AXES = 3;
/** Longueur max nom produit (calque handler `sanitizeInput(_, 200)`). */
export const MAX_PRODUCT_NAME_LENGTH = 200;
/** Prix max en cents — garde-fou anti-overflow JS Number (2^53 / 100). */
export const MAX_PRICE_CENTS = 9_999_999_999_99; // ~9999 milliards CAD
/** Prix min — gratuit autorisé (samples, lead magnets, etc.). */
export const MIN_PRICE_CENTS = 0;

/**
 * Regex SKU : ASCII alphanumérique + tirets/underscores/points. INTERDIT :
 * espaces, accents, slash, quotes, semicolons (anti-injection / search query).
 * Cas-insensible côté unicité (le handler normalise toUpperCase avant SELECT).
 */
export const SKU_REGEX = /^[A-Za-z0-9._-]+$/;

/** Whitelist currencies — alignée multicurrency-engine + region-context. */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  'CAD', 'USD', 'EUR', 'GBP', 'DZD',
];
const SUPPORTED_CURRENCIES_SET = new Set<string>(SUPPORTED_CURRENCIES);

/** Codes d'erreur stables (logs + audit + assertions tests). */
export const PRODUCT_ERROR_CODES = {
  INVALID_NAME: 'INVALID_NAME',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  INVALID_SKU: 'INVALID_SKU',
  SKU_TOO_SHORT: 'SKU_TOO_SHORT',
  SKU_TOO_LONG: 'SKU_TOO_LONG',
  INVALID_PRICE: 'INVALID_PRICE',
  PRICE_NEGATIVE: 'PRICE_NEGATIVE',
  PRICE_OVERFLOW: 'PRICE_OVERFLOW',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  TOO_MANY_VARIANTS: 'TOO_MANY_VARIANTS',
  TOO_MANY_AXES: 'TOO_MANY_AXES',
  DUPLICATE_VARIANT: 'DUPLICATE_VARIANT',
  MISSING_AXIS_VALUE: 'MISSING_AXIS_VALUE',
} as const;

export type ProductErrorCode = typeof PRODUCT_ERROR_CODES[keyof typeof PRODUCT_ERROR_CODES];

// ── SKU validation ──────────────────────────────────────────────────────────

/**
 * Valide la forme d'un SKU. PUR — ne touche pas la DB (l'unicité par tenant
 * reste vérifiée dans le handler via `skuCollision`).
 * Règles :
 *   - non vide après trim ;
 *   - longueur ∈ [MIN_SKU_LENGTH, MAX_SKU_LENGTH] ;
 *   - matche SKU_REGEX (ASCII alphanumérique + . _ -).
 */
export function validateSku(sku: unknown): boolean {
  if (typeof sku !== 'string') return false;
  const trimmed = sku.trim();
  if (trimmed.length < MIN_SKU_LENGTH) return false;
  if (trimmed.length > MAX_SKU_LENGTH) return false;
  return SKU_REGEX.test(trimmed);
}

/** Variante détaillée de `validateSku` qui retourne le code d'erreur. */
export function validateSkuDetailed(sku: unknown): {
  ok: boolean;
  code?: ProductErrorCode;
} {
  if (typeof sku !== 'string') return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_SKU };
  const trimmed = sku.trim();
  if (trimmed.length === 0) return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_SKU };
  if (trimmed.length < MIN_SKU_LENGTH) return { ok: false, code: PRODUCT_ERROR_CODES.SKU_TOO_SHORT };
  if (trimmed.length > MAX_SKU_LENGTH) return { ok: false, code: PRODUCT_ERROR_CODES.SKU_TOO_LONG };
  if (!SKU_REGEX.test(trimmed)) return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_SKU };
  return { ok: true };
}

// ── Currency validation ─────────────────────────────────────────────────────

/**
 * Valide un code devise ISO 4217 (3 lettres majuscules) ET présent dans la
 * whitelist projet `SUPPORTED_CURRENCIES`. Refuse les codes ISO non supportés
 * (JPY, BRL, MXN, …) pour rester aligné sur le moteur fiscal/region.
 */
export function validateCurrency(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) return false;
  return SUPPORTED_CURRENCIES_SET.has(upper);
}

// ── Price normalization ─────────────────────────────────────────────────────

/**
 * Normalise un prix en cents INTEGER ≥ 0. Accepte :
 *   - number (12.50 → 1250, 1250 → 1250 si déjà cents) ;
 *   - string ("12.50", "$12.50", "12,50", "1250" → 1250).
 *
 * Heuristique : présence d'un séparateur décimal (., ,) ⇒ valeur en dollars
 * (multiplie par 100 + round). Sinon ⇒ valeur déjà en cents (round seul).
 *
 * Retourne null si entrée invalide / non finie / négative. NE throw JAMAIS.
 */
export function normalizePriceCents(input: unknown): number | null {
  if (input == null) return null;

  let numeric: number;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    if (input < 0) return null;
    // Heuristique : float avec partie décimale ⇒ dollars. Entier ⇒ cents déjà.
    // Cas-limite : 12.0 (Number.isInteger=true) ⇒ traité comme cents (12¢).
    numeric = Number.isInteger(input) ? input : Math.round(input * 100);
  } else if (typeof input === 'string') {
    // Strip currency symbols + espaces + retire séparateurs milliers.
    let cleaned = input.trim().replace(/[$€£\s]/g, '');
    // Format européen "12,50" → "12.50"
    cleaned = cleaned.replace(',', '.');
    if (cleaned.length === 0) return null;
    // Refuse les chaînes avec lettres résiduelles (anti "12abc")
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

    const hasDecimal = cleaned.includes('.');
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 0) return null;
    numeric = hasDecimal ? Math.round(parsed * 100) : Math.round(parsed);
  } else {
    return null;
  }

  if (numeric < MIN_PRICE_CENTS) return null;
  if (numeric > MAX_PRICE_CENTS) return null;
  return numeric;
}

// ── Product input validation (used optionally by handler) ───────────────────

export interface ProductInput {
  name?: unknown;
  title?: unknown; // alias (legacy handler key)
  sku?: unknown;
  price_cents?: unknown;
  base_price?: unknown; // alias (legacy handler key)
  currency?: unknown;
}

export interface ValidationResult<T = unknown> {
  ok: boolean;
  code?: ProductErrorCode;
  field?: keyof ProductInput | 'variants';
  data?: T;
}

/**
 * Valide un payload produit minimal. Optionnel — le handler legacy garde son
 * propre pipeline `sanitizeInput` + schémas Zod (`createProductSchema`). Ce
 * helper sert :
 *   - les call sites secondaires (scripts CLI, BulkOps, imports CSV) ;
 *   - les assertions tests croisées ;
 *   - les futurs endpoints admin sans Zod.
 */
export function validateProductInput(input: ProductInput): ValidationResult<{
  name: string;
  sku: string | null;
  price_cents: number;
  currency: string;
}> {
  const name = (input.name ?? input.title);
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_NAME, field: 'name' };
  }
  const trimmedName = name.trim();
  if (trimmedName.length > MAX_PRODUCT_NAME_LENGTH) {
    return { ok: false, code: PRODUCT_ERROR_CODES.NAME_TOO_LONG, field: 'name' };
  }

  // SKU optionnel (catalogue legacy supporte variants sans SKU).
  let normalizedSku: string | null = null;
  if (input.sku != null && input.sku !== '') {
    const v = validateSkuDetailed(input.sku);
    if (!v.ok) return { ok: false, code: v.code, field: 'sku' };
    normalizedSku = (input.sku as string).trim();
  }

  // Prix : accepte price_cents (canonique) OU base_price (alias legacy).
  const rawPrice = input.price_cents ?? input.base_price ?? 0;
  const cents = normalizePriceCents(rawPrice);
  if (cents == null) {
    // Distinction : négatif explicite vs overflow vs garbage.
    if (typeof rawPrice === 'number' && rawPrice < 0) {
      return { ok: false, code: PRODUCT_ERROR_CODES.PRICE_NEGATIVE, field: 'price_cents' };
    }
    if (typeof rawPrice === 'number' && rawPrice > MAX_PRICE_CENTS) {
      return { ok: false, code: PRODUCT_ERROR_CODES.PRICE_OVERFLOW, field: 'price_cents' };
    }
    return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_PRICE, field: 'price_cents' };
  }

  // Currency : default CAD (alignement handler legacy ligne 257).
  const rawCurrency = (input.currency ?? 'CAD') as unknown;
  if (!validateCurrency(rawCurrency)) {
    return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_CURRENCY, field: 'currency' };
  }
  const currency = String(rawCurrency).trim().toUpperCase();

  return {
    ok: true,
    data: { name: trimmedName, sku: normalizedSku, price_cents: cents, currency },
  };
}

// ── Variant matrix validation ───────────────────────────────────────────────

export interface VariantInput {
  /** Options réelles : { size: 'M', color: 'red' }. */
  options?: Record<string, string> | null;
  /** Forme legacy DB : `options_json` (string JSON). */
  options_json?: string | Record<string, string> | null;
  sku?: string | null;
}

/**
 * Valide une matrice de variantes contre un set d'axes attendu :
 *   - chaque variante a une valeur pour CHAQUE axe ;
 *   - aucune combinaison d'axes n'apparaît deux fois ;
 *   - cap MAX_VARIANTS / MAX_VARIANT_AXES respecté ;
 *   - SKU (si présent) passe `validateSku`.
 *
 * Retourne `{ ok, code?, field? }`. PUR — pas de DB.
 *
 * NB : ne vérifie PAS que la matrice est COMPLÈTE (toutes combinaisons
 * cartésiennes présentes) — un catalogue peut volontairement omettre des
 * combos (rupture stock définitive). Vérifie juste : pas de doublon + tous
 * les axes renseignés + pas plus que MAX_VARIANTS.
 */
export function validateVariantMatrix(
  variants: VariantInput[],
  axes: readonly string[],
): { ok: boolean; code?: ProductErrorCode; field?: string; duplicateKey?: string } {
  if (!Array.isArray(variants)) {
    return { ok: false, code: PRODUCT_ERROR_CODES.DUPLICATE_VARIANT, field: 'variants' };
  }
  if (variants.length > MAX_VARIANTS) {
    return { ok: false, code: PRODUCT_ERROR_CODES.TOO_MANY_VARIANTS, field: 'variants' };
  }
  if (axes.length > MAX_VARIANT_AXES) {
    return { ok: false, code: PRODUCT_ERROR_CODES.TOO_MANY_AXES, field: 'axes' };
  }

  const seen = new Set<string>();
  for (const v of variants) {
    let opts: Record<string, string>;
    if (v.options && typeof v.options === 'object') {
      opts = v.options;
    } else if (typeof v.options_json === 'string') {
      try { opts = JSON.parse(v.options_json) as Record<string, string>; }
      catch { opts = {}; }
    } else if (v.options_json && typeof v.options_json === 'object') {
      opts = v.options_json as Record<string, string>;
    } else {
      opts = {};
    }

    // Tous les axes doivent être renseignés (string non-vide).
    for (const ax of axes) {
      const value = opts[ax];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, code: PRODUCT_ERROR_CODES.MISSING_AXIS_VALUE, field: ax };
      }
    }

    // SKU : si présent, doit être bien formé (l'unicité reste DB-checked).
    if (v.sku != null && v.sku !== '') {
      if (!validateSku(v.sku)) {
        return { ok: false, code: PRODUCT_ERROR_CODES.INVALID_SKU, field: 'sku' };
      }
    }

    // Clé déterministe pour détection doublon (axes triés alphabétiquement).
    const key = axes.slice().sort().map((ax) => `${ax}=${opts[ax]}`).join('|');
    if (seen.has(key)) {
      return { ok: false, code: PRODUCT_ERROR_CODES.DUPLICATE_VARIANT, field: 'variants', duplicateKey: key };
    }
    seen.add(key);
  }

  return { ok: true };
}
