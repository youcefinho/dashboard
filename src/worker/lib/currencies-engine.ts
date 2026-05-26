// ── currencies-engine.ts — Pure helpers FX rates / currency conversion ─────
// Utils P2-2 RENFORCEMENT — ZÉRO I/O, ZÉRO state. Tout est calque/validation.
//
// Couvre :
//   - ISO 4217 3-letter whitelist (top 30 + 5 SupportedCurrencyExt internes)
//   - Validation rate (> 0, fini, < seuil garde-fou)
//   - Cache staleness (TTL 24h, max stale 72h)
//   - Conversion amount avec round per-currency (JPY 0 décimal, autres 2)
//   - Parse filtres list (base/quote/limit/source)
//
// Multi-tenant : currency_rates est partagé (pas de client_id) — ces helpers
// sont neutres et n'introduisent aucun bypass. La capability `settings.manage`
// reste enforced côté handlers.

export const CURRENCIES_ERROR_CODES = Object.freeze({
  INVALID_CODE: 'INVALID_CODE',
  INVALID_RATE: 'INVALID_RATE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  SAME_CODE: 'SAME_CODE',
  STALE_RATE: 'STALE_RATE',
  BUNDLE_TOO_LARGE: 'BUNDLE_TOO_LARGE',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
} as const);

export type CurrenciesErrorCode = (typeof CURRENCIES_ERROR_CODES)[keyof typeof CURRENCIES_ERROR_CODES];

/** TTL d'un taux cache (en heures) avant qu'on le considère "stale" et qu'on doive
 *  ré-interroger la source ECB. */
export const FX_CACHE_TTL_HOURS = 24 as const;

/** Au-delà de ce seuil (en heures), même le fallback stale ne devrait plus être
 *  utilisé : on retourne une erreur explicite au caller. */
export const MAX_FX_AGE_HOURS_STALE = 72 as const;

/** Seuil garde-fou max sur un rate (anti-injection valeurs aberrantes). 1M est
 *  une borne large mais suffisante (USD/IRR ≈ 42K en 2026, marge x20). */
export const MAX_FX_RATE = 1_000_000 as const;

/** Top 30 codes ISO 4217 + nos 5 SupportedCurrencyExt (CAD/USD/EUR/DZD/MAD).
 *  Sert de whitelist défensive sur toute API exposée (override manuel, filtres). */
export const VALID_CURRENCIES_FULL: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // Top 10 majors
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'HKD',
    // Top 11-20
    'SGD', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'ZAR', 'INR', 'KRW', 'TRY',
    // Top 21-30 + nos cibles métier
    'AED', 'SAR', 'PLN', 'CZK', 'HUF', 'THB', 'MYR', 'IDR', 'PHP', 'ILS',
    // SupportedCurrencyExt Intralys (déjà dans top 30 majoritairement)
    'DZD', 'MAD',
  ]),
);

/** Devises qui n'ont PAS de décimales (yen, KRW, IDR partiellement…).
 *  Pour MVP on aligne sur ISO 4217 Table A.1 (entiers stricts). */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = Object.freeze(
  new Set<string>(['JPY', 'KRW', 'IDR', 'CLP', 'VND', 'XOF', 'XAF', 'XPF']),
);

// ───────────────────────────────────────────────────────────────────────────
// Validation primitives
// ───────────────────────────────────────────────────────────────────────────

/** ISO 4217 = 3 lettres uppercase. Réjette tout le reste (lower, chiffres, espaces). */
export function validateCurrencyCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  if (code.length !== 3) return false;
  // strict A-Z uppercase
  for (let i = 0; i < 3; i++) {
    const c = code.charCodeAt(i);
    if (c < 65 || c > 90) return false;
  }
  return true;
}

/** Code DOIT être un format ISO 4217 valide ET dans notre whitelist. */
export function isSupportedCurrency(code: unknown): boolean {
  if (!validateCurrencyCode(code)) return false;
  return VALID_CURRENCIES_FULL.has(code as string);
}

/** Rate doit être un nombre fini, > 0, < MAX_FX_RATE (garde anti-aberrant). */
export function validateFxRate(rate: unknown): boolean {
  if (typeof rate !== 'number') return false;
  if (!Number.isFinite(rate)) return false;
  if (rate <= 0) return false;
  if (rate >= MAX_FX_RATE) return false;
  return true;
}

/** Amount doit être un nombre fini (peut être négatif pour refund, mais pas NaN/Infinity). */
export function validateAmount(amount: unknown): boolean {
  if (typeof amount !== 'number') return false;
  return Number.isFinite(amount);
}

// ───────────────────────────────────────────────────────────────────────────
// Cache staleness
// ───────────────────────────────────────────────────────────────────────────

/** Calcule l'âge d'un timestamp ISO en heures, par rapport à `now`. */
export function ageInHours(fetchedAtIso: string, now: Date = new Date()): number | null {
  const t = Date.parse(fetchedAtIso);
  if (!Number.isFinite(t)) return null;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60));
}

/** True si le taux est plus vieux que `ttlHours` (24h par défaut). */
export function isRateStale(
  fetchedAtIso: string,
  now: Date = new Date(),
  ttlHours: number = FX_CACHE_TTL_HOURS,
): boolean {
  const age = ageInHours(fetchedAtIso, now);
  if (age === null) return true; // timestamp invalide → considéré stale (défensif)
  return age > ttlHours;
}

/** True si on a dépassé le seuil max — le rate ne devrait même plus servir de fallback. */
export function isRateTooOld(
  fetchedAtIso: string,
  now: Date = new Date(),
  maxStaleHours: number = MAX_FX_AGE_HOURS_STALE,
): boolean {
  const age = ageInHours(fetchedAtIso, now);
  if (age === null) return true;
  return age > maxStaleHours;
}

// ───────────────────────────────────────────────────────────────────────────
// Round per-currency
// ───────────────────────────────────────────────────────────────────────────

/** Renvoie le nombre de décimales standard pour une devise (0 ou 2). */
export function decimalsForCurrency(code: string): number {
  if (!validateCurrencyCode(code)) return 2;
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
}

/** Round un montant selon la convention de la devise.
 *  Approche : banker's rounding désactivé (on garde Math.round standard).
 *  Pour des cas comptables stricts utiliser une lib BigDecimal — out of scope ici. */
export function roundForCurrency(amount: number, code: string): number {
  if (!validateAmount(amount)) return 0;
  const decimals = decimalsForCurrency(code);
  if (decimals === 0) return Math.round(amount);
  const factor = 10 ** decimals;
  // Évite les artéfacts float (ex 1.005 → 1.00 au lieu de 1.01) via toFixed roundtrip.
  return Number((Math.round(amount * factor) / factor).toFixed(decimals));
}

// ───────────────────────────────────────────────────────────────────────────
// Conversion
// ───────────────────────────────────────────────────────────────────────────

export interface ConversionResult {
  converted: number;
  precision: number; // décimales utilisées (0 ou 2)
  from: string;
  to: string;
  rate: number;
}

/** Convertit `amount` de `from` vers `to` en appliquant `rate` (= prix de 1 from en to).
 *  Renvoie null si validation KO. Same-currency court-circuite (rate ignoré). */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rate: number,
): ConversionResult | null {
  if (!validateAmount(amount)) return null;
  if (!validateCurrencyCode(from) || !validateCurrencyCode(to)) return null;
  if (from === to) {
    return {
      converted: roundForCurrency(amount, to),
      precision: decimalsForCurrency(to),
      from,
      to,
      rate: 1,
    };
  }
  if (!validateFxRate(rate)) return null;

  const raw = amount * rate;
  return {
    converted: roundForCurrency(raw, to),
    precision: decimalsForCurrency(to),
    from,
    to,
    rate,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Parse filtres list
// ───────────────────────────────────────────────────────────────────────────

export interface ListRatesFilters {
  base?: string;
  quote?: string;
  limit: number;
  source?: 'ecb' | 'manual';
}

/** Parse + sanitise les filtres GET /api/currencies/rates depuis URLSearchParams.
 *  Limit clampée [1, 500]. Source whitelist 'ecb' | 'manual'. */
export function parseRatesFilters(query: URLSearchParams): ListRatesFilters {
  const out: ListRatesFilters = { limit: 100 };

  const base = query.get('base');
  if (base) {
    const up = base.toUpperCase();
    if (validateCurrencyCode(up)) out.base = up;
  }
  const quote = query.get('quote');
  if (quote) {
    const up = quote.toUpperCase();
    if (validateCurrencyCode(up)) out.quote = up;
  }
  const limitRaw = query.get('limit');
  if (limitRaw) {
    const n = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      out.limit = Math.min(n, 500);
    }
  }
  const src = query.get('source');
  if (src === 'ecb' || src === 'manual') out.source = src;

  return out;
}
