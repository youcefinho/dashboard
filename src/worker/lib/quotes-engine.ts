// ── quotes-engine.ts — Helpers PURS devis (RENFORCEMENT P1-6) ──────────────
//
// Contrat ADDITIF — 100% : aucun import depuis quotes.ts existant. Helpers
// PURS (zéro I/O) pour :
//   - Validation des inputs devis (items, customer, expiry)
//   - Calcul totaux (subtotal/tax/total) avec discount + tax rates configurables
//   - State machine status (draft|sent|accepted|rejected|expired)
//   - Expiry detection (isQuoteExpired)
//
// Compatibilité quotes.ts disque : utilise mêmes statuts (draft/sent/accepted/
// declined/expired) — on aliase 'rejected' = 'declined' pour le brief P1-6.

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const QUOTES_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  EMPTY_ITEMS: 'EMPTY_ITEMS',
  INVALID_LINE: 'INVALID_LINE',
  INVALID_QTY: 'INVALID_QTY',
  INVALID_PRICE: 'INVALID_PRICE',
  NEGATIVE_PRICE: 'NEGATIVE_PRICE',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_EXPIRY: 'INVALID_EXPIRY',
  QUOTE_NOT_FOUND: 'QUOTE_NOT_FOUND',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  INVALID_TAX_RATE: 'INVALID_TAX_RATE',
  INVALID_DISCOUNT: 'INVALID_DISCOUNT',
} as const;

export type QuotesErrorCode =
  (typeof QUOTES_ERROR_CODES)[keyof typeof QUOTES_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes
// ════════════════════════════════════════════════════════════════════════════

// Statuts canoniques (quotes.ts disque + alias brief).
export const VALID_QUOTE_STATUSES = Object.freeze([
  'draft',
  'sent',
  'accepted',
  'declined',
  'rejected', // alias brief P1-6 (mappe à 'declined' côté DB).
  'expired',
] as const);
export type QuoteStatus = (typeof VALID_QUOTE_STATUSES)[number];

// Statuts effectifs côté DB (quotes.ts utilise 'declined' pas 'rejected').
export const QUOTE_STATUS_DB = Object.freeze([
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
] as const);

export const QUOTE_EXPIRY_DAYS_DEFAULT = 30;
export const QUOTE_LABEL_MAX = 300;
export const QUOTE_DESCRIPTION_MAX = 500;
export const QUOTE_ITEMS_MAX = 200;
export const QUOTE_PRICE_MAX = 1_000_000_000;
export const QUOTE_QTY_MAX = 100_000;

// Taux par défaut Quebec (calque quotes.ts:14-15).
export const QUOTE_TAX_TPS = 0.05;
export const QUOTE_TAX_TVQ = 0.09975;

// ════════════════════════════════════════════════════════════════════════════
// Round helper (2 décimales monétaire)
// ════════════════════════════════════════════════════════════════════════════

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

export function isValidQuoteStatus(v: unknown): v is QuoteStatus {
  return (
    typeof v === 'string' &&
    (VALID_QUOTE_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Normalise un statut brief → DB (rejected → declined).
 */
export function normalizeQuoteStatus(status: QuoteStatus): string {
  if (status === 'rejected') return 'declined';
  return status;
}

// ════════════════════════════════════════════════════════════════════════════
// State machine — validateQuoteTransition
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_QUOTE_TRANSITIONS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  draft: ['sent', 'declined', 'rejected', 'expired'],
  sent: ['accepted', 'declined', 'rejected', 'expired'],
  accepted: [], // terminal — facture créée
  declined: [], // terminal
  rejected: [], // alias terminal
  expired: ['sent'], // peut être renvoyé manuellement (re-quote)
};

/**
 * Valide une transition de statut devis.
 * Retourne true si transition légale, false sinon.
 */
export function validateQuoteTransition(from: unknown, to: unknown): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  if (from === to) return true; // no-op
  if (!isValidQuoteStatus(from) || !isValidQuoteStatus(to)) return false;
  const allowed = ALLOWED_QUOTE_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

// ════════════════════════════════════════════════════════════════════════════
// computeQuoteTotals — subtotal/tax/total avec discount support
// ════════════════════════════════════════════════════════════════════════════

export type QuoteLineInput = {
  label?: unknown;
  qty?: unknown;
  unit_price?: unknown;
};

export type QuoteLineNormalized = {
  label: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type QuoteTaxConfig = {
  // Si fourni : taux unique applicable (override tps/tvq).
  rate?: number;
  // Sinon : taux multi-juridiction (défaut Quebec).
  tps?: number;
  tvq?: number;
};

export type QuoteTotals = {
  lines: QuoteLineNormalized[];
  subtotal: number;
  discount: number;
  taxable_base: number;
  tax: number;
  tax_tps: number;
  tax_tvq: number;
  total: number;
};

export type QuoteTotalsResult =
  | { ok: true; totals: QuoteTotals }
  | { ok: false; error: string; code: QuotesErrorCode; field?: string };

/**
 * Calcule les totaux d'un devis depuis ses items.
 * - items : array de QuoteLineInput
 * - taxConfig : {rate} OU {tps, tvq} (défaut Quebec 5% + 9.975%)
 * - discount : montant fixe à soustraire du subtotal (défaut 0)
 *
 * Retourne lines normalisées + subtotal + tax(es) + total, le tout round2.
 */
export function computeQuoteTotals(
  items: unknown,
  taxConfig: QuoteTaxConfig = {},
  discount: number = 0,
): QuoteTotalsResult {
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: 'Items invalides',
      code: QUOTES_ERROR_CODES.INVALID_INPUT,
      field: 'items',
    };
  }

  if (items.length > QUOTE_ITEMS_MAX) {
    return {
      ok: false,
      error: 'Trop de lignes',
      code: QUOTES_ERROR_CODES.EMPTY_ITEMS,
      field: 'items',
    };
  }

  // Discount : >= 0 et fini.
  let normalizedDiscount = Number(discount);
  if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
    return {
      ok: false,
      error: 'Discount invalide',
      code: QUOTES_ERROR_CODES.INVALID_DISCOUNT,
      field: 'discount',
    };
  }
  normalizedDiscount = round2(normalizedDiscount);

  const lines: QuoteLineNormalized[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const label = String(o.label ?? '').slice(0, QUOTE_LABEL_MAX);
    const qty = Number(o.qty);
    const unit_price = Number(o.unit_price);

    if (!label) continue;
    if (!Number.isFinite(qty) || qty <= 0 || qty > QUOTE_QTY_MAX) {
      return {
        ok: false,
        error: 'Quantité invalide',
        code: QUOTES_ERROR_CODES.INVALID_QTY,
        field: 'qty',
      };
    }
    if (!Number.isFinite(unit_price)) {
      return {
        ok: false,
        error: 'Prix unitaire invalide',
        code: QUOTES_ERROR_CODES.INVALID_PRICE,
        field: 'unit_price',
      };
    }
    if (unit_price < 0) {
      return {
        ok: false,
        error: 'Prix négatif interdit',
        code: QUOTES_ERROR_CODES.NEGATIVE_PRICE,
        field: 'unit_price',
      };
    }
    if (unit_price > QUOTE_PRICE_MAX) {
      return {
        ok: false,
        error: 'Prix hors borne',
        code: QUOTES_ERROR_CODES.INVALID_PRICE,
        field: 'unit_price',
      };
    }
    const line_total = round2(qty * unit_price);
    lines.push({ label, qty, unit_price, line_total });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: 'Au moins une ligne est requise',
      code: QUOTES_ERROR_CODES.EMPTY_ITEMS,
      field: 'items',
    };
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  // Discount ne peut pas dépasser le subtotal.
  const effectiveDiscount = round2(Math.min(normalizedDiscount, subtotal));
  const taxable_base = round2(subtotal - effectiveDiscount);

  let tax_tps = 0;
  let tax_tvq = 0;
  let tax = 0;

  if (typeof taxConfig.rate === 'number' && Number.isFinite(taxConfig.rate)) {
    if (taxConfig.rate < 0 || taxConfig.rate > 1) {
      return {
        ok: false,
        error: 'Taux de taxe invalide',
        code: QUOTES_ERROR_CODES.INVALID_TAX_RATE,
        field: 'rate',
      };
    }
    tax = round2(taxable_base * taxConfig.rate);
  } else {
    const tps = taxConfig.tps != null ? Number(taxConfig.tps) : QUOTE_TAX_TPS;
    const tvq = taxConfig.tvq != null ? Number(taxConfig.tvq) : QUOTE_TAX_TVQ;
    if (
      !Number.isFinite(tps) ||
      !Number.isFinite(tvq) ||
      tps < 0 ||
      tvq < 0 ||
      tps > 1 ||
      tvq > 1
    ) {
      return {
        ok: false,
        error: 'Taux de taxe invalide',
        code: QUOTES_ERROR_CODES.INVALID_TAX_RATE,
      };
    }
    tax_tps = round2(taxable_base * tps);
    tax_tvq = round2(taxable_base * tvq);
    tax = round2(tax_tps + tax_tvq);
  }

  const total = round2(taxable_base + tax);

  return {
    ok: true,
    totals: {
      lines,
      subtotal,
      discount: effectiveDiscount,
      taxable_base,
      tax,
      tax_tps,
      tax_tvq,
      total,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Expiry helpers
// ════════════════════════════════════════════════════════════════════════════

export type QuoteForExpiry = {
  valid_until?: number | string | Date | null;
  created_at?: number | string | Date | null;
  status?: string | null;
};

/**
 * Calcule l'epoch ms d'une date de validité.
 * Retourne null si non parsable.
 */
function parseToMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') {
    return v < 1e12 ? v * 1000 : v;
  }
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Détermine si un devis est expiré.
 * - status terminal (accepted/declined/rejected) : jamais expiré.
 * - valid_until passé : expiré.
 * - sinon : created_at + QUOTE_EXPIRY_DAYS_DEFAULT passé : expiré.
 */
export function isQuoteExpired(
  quote: QuoteForExpiry | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (!quote) return false;
  const status = String(quote.status ?? '');
  if (status === 'accepted' || status === 'declined' || status === 'rejected') {
    return false;
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  const validUntilMs = parseToMs(quote.valid_until);
  if (validUntilMs != null) return nowMs > validUntilMs;

  const createdMs = parseToMs(quote.created_at);
  if (createdMs != null) {
    const deadline =
      createdMs + QUOTE_EXPIRY_DAYS_DEFAULT * 24 * 60 * 60 * 1000;
    return nowMs > deadline;
  }
  return false;
}

/**
 * Calcule la date d'expiration par défaut (created + N jours).
 */
export function computeQuoteExpiry(
  createdAt: Date | number | string = Date.now(),
  days: number = QUOTE_EXPIRY_DAYS_DEFAULT,
): Date {
  const ms = parseToMs(createdAt) ?? Date.now();
  return new Date(ms + days * 24 * 60 * 60 * 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// validateQuoteInput
// ════════════════════════════════════════════════════════════════════════════

export type QuoteInput = {
  items?: unknown;
  description?: unknown;
  client_id?: unknown;
  lead_id?: unknown;
  valid_until?: unknown;
  status?: unknown;
};

export type QuoteValidationResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; code: QuotesErrorCode };

/**
 * Valide un input de création/update devis.
 * - mode 'create' : items requis (au moins 1 ligne valide).
 * - mode 'update' : champs partiels.
 */
export function validateQuoteInput(
  input: QuoteInput | null | undefined,
  mode: 'create' | 'update' = 'create',
): QuoteValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Requête invalide',
      code: QUOTES_ERROR_CODES.INVALID_INPUT,
    };
  }

  // items : requis en create.
  if (mode === 'create') {
    const totals = computeQuoteTotals(input.items, {}, 0);
    if (!totals.ok) {
      return {
        ok: false,
        error: totals.error,
        field: totals.field,
        code: totals.code,
      };
    }
  } else if (input.items !== undefined) {
    const totals = computeQuoteTotals(input.items, {}, 0);
    if (!totals.ok) {
      return {
        ok: false,
        error: totals.error,
        field: totals.field,
        code: totals.code,
      };
    }
  }

  // description max 500.
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') {
      return {
        ok: false,
        error: 'Description invalide',
        field: 'description',
        code: QUOTES_ERROR_CODES.INVALID_INPUT,
      };
    }
    if (input.description.length > QUOTE_DESCRIPTION_MAX) {
      return {
        ok: false,
        error: 'Description trop longue',
        field: 'description',
        code: QUOTES_ERROR_CODES.INVALID_INPUT,
      };
    }
  }

  // status (optionnel).
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!isValidQuoteStatus(input.status)) {
      return {
        ok: false,
        error: 'Statut invalide',
        field: 'status',
        code: QUOTES_ERROR_CODES.INVALID_STATUS,
      };
    }
  }

  // valid_until (optionnel) — string parsable.
  if (
    input.valid_until !== undefined &&
    input.valid_until !== null &&
    input.valid_until !== ''
  ) {
    const ms = parseToMs(input.valid_until);
    if (ms == null) {
      return {
        ok: false,
        error: 'Date de validité invalide',
        field: 'valid_until',
        code: QUOTES_ERROR_CODES.INVALID_EXPIRY,
      };
    }
  }

  return { ok: true };
}
