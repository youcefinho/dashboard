// ── Multi-currency engine — Sprint 39 (2026-05-26) ────────────────────────
//
// Helpers PURS additifs complétant `currency-converter.ts` (A1) sans le
// remplacer. Aucun I/O. Aucune dépendance sur `ecommerce-tax-engine.ts`
// (FIGÉ régression-zéro QC/EU/DZ).
//
// Responsabilités :
//   - convertCurrency()          : conversion cents → cents (Math.round, refus mismatch).
//   - isRateStale()              : détection fraîcheur (default >7j = stale).
//   - formatCurrency()           : affichage Intl.NumberFormat per locale.
//   - safeAdd()                  : addition garde-fou same-currency (anti-bug cross-cur).
//   - getDefaultCurrencyForRegion(): mapping région → ISO 4217.
//   - parseRateFromApi()         : normalise réponses openexchangerates / frankfurter.
//   - MULTICURRENCY_ERROR_CODES  : enum codes erreurs structurés.
//
// Conventions strictes :
//   - Money TOUJOURS en cents (INTEGER). Math.round on output.
//   - Currency codes : ISO 4217 UPPERCASE strict (whitelist partagée
//     `pricing-engine.ts` — ~170 codes).
//   - PURE — pas de throw (retour { ok, error? } ou null/false pour validation).
//
// Régression-zéro : ces helpers sont strictement opt-in. Aucun consumer
// existant n'est modifié. Le tax engine S39 reste INTOUCHÉ.

import { ISO_4217_CODES } from './pricing-engine';

// ── Error codes ────────────────────────────────────────────────────────────

/**
 * Codes erreurs structurés (calque PRICING_ERROR_CODES). Stable cross-handler
 * pour mapping HTTP / logging / i18n côté UI.
 */
export const MULTICURRENCY_ERROR_CODES = {
  RATE_NOT_FOUND: 'RATE_NOT_FOUND',
  RATE_STALE: 'RATE_STALE',
  MISMATCH: 'MISMATCH',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_RATE: 'INVALID_RATE',
} as const;

export type MulticurrencyErrorCode =
  (typeof MULTICURRENCY_ERROR_CODES)[keyof typeof MULTICURRENCY_ERROR_CODES];

// ── Region → default currency ──────────────────────────────────────────────

/**
 * Régions supportées par le moteur multi-currency. Calque tax_regions.type
 * (qc=gst_pst, eu=vat, dz=tva_dz) + ajouts US/rest.
 */
export type SupportedRegion = 'qc' | 'eu' | 'dz' | 'us' | 'rest';

const REGION_DEFAULT_CURRENCY: Record<SupportedRegion, string> = {
  qc: 'CAD',
  eu: 'EUR',
  dz: 'DZD',
  us: 'USD',
  rest: 'USD',
};

/**
 * Retourne la devise par défaut (ISO 4217) pour une région donnée.
 * Fallback 'USD' si région inconnue (équivalent 'rest').
 */
export function getDefaultCurrencyForRegion(region: SupportedRegion): string {
  return REGION_DEFAULT_CURRENCY[region] ?? 'USD';
}

// ── Currency validation (re-export ISO 4217 whitelist) ────────────────────

/**
 * Vérifie qu'un code devise est valide ISO 4217 UPPERCASE. Délègue à la
 * whitelist partagée de `pricing-engine.ts` (single source of truth).
 *
 * Strict : pas de trim, lowercase rejeté.
 */
function isValidCurrency(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  if (code.length !== 3) return false;
  if (code !== code.toUpperCase()) return false;
  return ISO_4217_CODES.has(code);
}

// ── convertCurrency — pure ─────────────────────────────────────────────────

/**
 * Convertit un montant en cents d'une devise source vers une devise cible.
 *
 * Différences avec `currency-converter.ts:convertCents` (intentionnel) :
 *   - Valide les codes ISO 4217 (whitelist ~170 codes) avant conversion.
 *   - Retourne `null` (pas 0) si invalide → le caller distingue "0 légitime"
 *     de "rejet". `convertCents` legacy renvoie 0 par contrat (compat).
 *   - Same-currency court-circuit (identity) AVANT validation rate.
 *
 * @param amountCents montant en cents (INTEGER fini, ≥0 ou ≤0 tolérés)
 * @param from        devise source (ISO 4217 UPPERCASE)
 * @param to          devise cible (ISO 4217 UPPERCASE)
 * @param rate        taux 1 from = rate to (>0, fini)
 * @returns           cents convertis (INTEGER, Math.round) ou null si invalide
 */
export function convertCurrency(
  amountCents: number,
  from: string,
  to: string,
  rate: number,
): number | null {
  if (!Number.isFinite(amountCents)) return null;
  if (!isValidCurrency(from) || !isValidCurrency(to)) return null;
  if (from === to) return Math.round(amountCents);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amountCents * rate);
}

// ── isRateStale — pure ─────────────────────────────────────────────────────

/**
 * Vérifie si un taux est "stale" (plus vieux que maxDays jours).
 *
 * @param rateUpdatedAt ISO string ou Date (UTC recommandé)
 * @param maxDays       seuil en jours (default 7)
 * @returns             true si stale ou date invalide (fail-safe — un taux
 *                      sans timestamp doit être traité comme suspect).
 */
export function isRateStale(
  rateUpdatedAt: string | Date,
  maxDays = 7,
): boolean {
  if (!Number.isFinite(maxDays) || maxDays < 0) return true;

  const date =
    rateUpdatedAt instanceof Date
      ? rateUpdatedAt
      : new Date(rateUpdatedAt);

  const ts = date.getTime();
  if (!Number.isFinite(ts)) return true; // Invalid date → stale (fail-safe).

  const ageMs = Date.now() - ts;
  // Negative age (future timestamp) → on tolère (clock skew possible).
  if (ageMs < 0) return false;

  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  return ageMs > maxMs;
}

// ── formatCurrency — pure ──────────────────────────────────────────────────

/**
 * Formate un montant en cents pour affichage UI via Intl.NumberFormat.
 *
 * @param amountCents montant en cents (INTEGER fini)
 * @param currency    code ISO 4217 UPPERCASE
 * @param locale      BCP 47 (default 'fr-CA' — pivot tenant)
 * @returns           string formatté (ex "$1,234.56" en-US, "1 234,56 $" fr-CA)
 *                    ou empty string si entrée invalide (fail-safe — pas de
 *                    throw côté render).
 *
 * Nb : Intl.NumberFormat gère les devises sans subunits (JPY, KRW, CLP) :
 * pour JPY, amountCents=1234 affiche ¥12 (pas ¥1,234) — pivot reste cents
 * mais l'affichage suit minimumFractionDigits par devise.
 */
export function formatCurrency(
  amountCents: number,
  currency: string,
  locale = 'fr-CA',
): string {
  if (!Number.isFinite(amountCents)) return '';
  if (!isValidCurrency(currency)) return '';

  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    });
    // Cents → unités. Pour devises sans subunit (JPY), Intl ignore les décimales.
    return formatter.format(amountCents / 100);
  } catch {
    // Locale invalide / runtime ICU absent → fallback brut.
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

// ── safeAdd — pure ─────────────────────────────────────────────────────────

export interface SafeAddResult {
  ok: boolean;
  value?: number;
  error?: MulticurrencyErrorCode;
}

/**
 * Addition garde-fou same-currency. Refuse cross-currency arithmetic (anti-
 * bug classique : additionner CAD + USD sans conversion → total dénué de sens).
 *
 * @param a        montant cents (INTEGER fini)
 * @param b        montant cents (INTEGER fini)
 * @param currency code ISO 4217 (validé) — informationnel, pas appliqué au calcul
 * @returns        { ok: true, value } ou { ok: false, error }
 *
 * Surcharge tolérée (overload) : si caller passe deux devises distinctes,
 * utiliser la signature `safeAdd(a, currencyA, b, currencyB)` pour détecter
 * le mismatch. Ici on prend le contrat le plus simple : 1 currency, 2 amounts.
 */
export function safeAdd(
  a: number,
  b: number,
  currency: string,
): SafeAddResult {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: MULTICURRENCY_ERROR_CODES.INVALID_AMOUNT };
  }
  if (!isValidCurrency(currency)) {
    return { ok: false, error: MULTICURRENCY_ERROR_CODES.INVALID_CURRENCY };
  }
  return { ok: true, value: Math.round(a + b) };
}

/**
 * Variante explicite mismatch-detection : addition refusée si les devises
 * diffèrent. Utile quand on assemble des line items depuis plusieurs sources.
 */
export function safeAddCrossCurrency(
  a: number,
  currencyA: string,
  b: number,
  currencyB: string,
): SafeAddResult {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: MULTICURRENCY_ERROR_CODES.INVALID_AMOUNT };
  }
  if (!isValidCurrency(currencyA) || !isValidCurrency(currencyB)) {
    return { ok: false, error: MULTICURRENCY_ERROR_CODES.INVALID_CURRENCY };
  }
  if (currencyA !== currencyB) {
    return { ok: false, error: MULTICURRENCY_ERROR_CODES.MISMATCH };
  }
  return { ok: true, value: Math.round(a + b) };
}

// ── parseRateFromApi — pure ────────────────────────────────────────────────

export interface ParsedRate {
  rate: number;
  updatedAt: string; // ISO 8601 UTC
}

/**
 * Normalise une réponse API taux change vers `{rate, updatedAt}`.
 *
 * Supporte plusieurs shapes :
 *   - openexchangerates : `{ rates: {EUR: 0.91}, timestamp: 1716537600, base: 'USD' }`
 *     (avec `target` pour sélectionner la paire désirée)
 *   - frankfurter       : `{ rates: {EUR: 0.91}, date: '2026-05-24', base: 'USD' }`
 *   - shape directe     : `{ rate: 0.91, updatedAt: '2026-05-24T00:00:00Z' }`
 *
 * @param raw    payload brut (JSON parsé) — typage unknown intentionnel
 * @param target code devise cible à extraire de `rates{}` (si shape ECB-like)
 * @returns      `{rate, updatedAt}` ou null si invalide.
 */
export function parseRateFromApi(
  raw: unknown,
  target?: string,
): ParsedRate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Shape directe { rate, updatedAt }.
  if (typeof obj.rate === 'number' && Number.isFinite(obj.rate) && obj.rate > 0) {
    const updatedAt = normalizeTimestamp(obj.updatedAt ?? obj.timestamp ?? obj.date);
    if (updatedAt) return { rate: obj.rate, updatedAt };
  }

  // Shape ECB-like { rates: {CODE: rate}, timestamp|date|updatedAt, base }.
  const rates = obj.rates;
  if (rates && typeof rates === 'object' && target) {
    const code = target.toUpperCase();
    const candidate = (rates as Record<string, unknown>)[code];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      const updatedAt = normalizeTimestamp(
        obj.updatedAt ?? obj.timestamp ?? obj.date,
      );
      if (updatedAt) return { rate: candidate, updatedAt };
    }
  }

  return null;
}

/** Normalise un timestamp (unix seconds | ISO string | Date) → ISO 8601 UTC. */
function normalizeTimestamp(raw: unknown): string | null {
  if (raw == null) return null;

  // Unix seconds (openexchangerates pattern).
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Heuristique : <1e12 → seconds, sinon ms.
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw.toISOString() : null;
  }

  return null;
}
