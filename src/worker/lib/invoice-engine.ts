// ── invoice-engine.ts — Helpers PURS facturation (RENFORCEMENT P0-7) ───────
//
// Contrat ADDITIF — 100% : aucun import depuis billing.ts existant,
// aucun remplacement de logique vivante. Helpers PURS (zéro I/O) pour :
//   - Numérotation INV-<YYYY>-<NNNNNN>
//   - Taxes multi-juridictions (Quebec TPS/TVQ, Canada HST, US, EU VAT)
//   - Validation input invoice serveur
//   - Génération payload PDF structuré (HTML + metadata)

// ════════════════════════════════════════════════════════════════════════════
// Codes d'erreur normalisés
// ════════════════════════════════════════════════════════════════════════════

export const INVOICE_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_CLIENT: 'MISSING_CLIENT',
  MISSING_AMOUNT: 'MISSING_AMOUNT',
  NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT',
  EMPTY_LINES: 'EMPTY_LINES',
  INVALID_LINE: 'INVALID_LINE',
  INVALID_REGION: 'INVALID_REGION',
  INVALID_STATUS: 'INVALID_STATUS',
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_PAID_IMMUTABLE: 'INVOICE_PAID_IMMUTABLE',
  TAX_NUMBER_MISSING: 'TAX_NUMBER_MISSING',
  CURRENCY_INVALID: 'CURRENCY_INVALID',
} as const;

export type InvoiceErrorCode =
  (typeof INVOICE_ERROR_CODES)[keyof typeof INVOICE_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
// Constantes statuts / régions
// ════════════════════════════════════════════════════════════════════════════

export const VALID_INVOICE_STATUSES = ['draft', 'sent', 'paid', 'cancelled', 'overdue'] as const;
export type InvoiceStatus = (typeof VALID_INVOICE_STATUSES)[number];

export const VALID_TAX_REGIONS = ['QC', 'CA', 'US', 'EU', 'OTHER'] as const;
export type TaxRegion = (typeof VALID_TAX_REGIONS)[number];

export const VALID_CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP'] as const;
export type Currency = (typeof VALID_CURRENCIES)[number];

// ════════════════════════════════════════════════════════════════════════════
// Numérotation INV-YYYY-NNNNNN (6 digits, scope tenant + year)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format un numéro de facture INV-YYYY-NNNNNN.
 * @param seq Séquence 1-based dans le scope (year, tenant).
 * @param year Année 4 digits (défaut: année courante).
 * @param digits Padding digits (défaut 6, billing.ts legacy = 4).
 */
export function formatInvoiceNumber(
  seq: number,
  year?: number,
  digits = 6,
): string {
  if (!Number.isFinite(seq) || seq < 1) seq = 1;
  if (!Number.isFinite(digits) || digits < 1) digits = 6;
  if (digits > 10) digits = 10;
  const y = Number.isFinite(year) ? year! : new Date().getFullYear();
  const padded = String(Math.floor(seq)).padStart(digits, '0');
  return `INV-${y}-${padded}`;
}

/** Parse un numéro INV-YYYY-NNNNNN. Renvoie null si invalide. */
export function parseInvoiceNumber(
  num: string,
): { year: number; seq: number } | null {
  if (typeof num !== 'string') return null;
  const m = /^INV-(\d{4})-(\d{1,10})$/.exec(num.trim());
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
}

// ════════════════════════════════════════════════════════════════════════════
// Taxes — multi-juridictions
// ════════════════════════════════════════════════════════════════════════════

export interface TaxBreakdown {
  /** Sous-total avant taxes en cents/unités selon caller. */
  subtotal: number;
  /** TPS / GST Canada. 0 si N/A. */
  tps: number;
  /** TVQ Quebec. 0 si N/A. */
  tvq: number;
  /** HST (provinces canadiennes 13%/15%). 0 si N/A. */
  hst: number;
  /** Sales tax US (variable par état, fourni en input). 0 si N/A. */
  salesTax: number;
  /** VAT EU (variable par pays, fourni en input). 0 si N/A. */
  vat: number;
  /** Total taxes. */
  totalTax: number;
  /** Total final (subtotal + totalTax). */
  total: number;
  /** Région utilisée pour computation. */
  region: TaxRegion;
}

export interface TaxRules {
  /** Pour US : taux state sales tax (ex 0.0625 NY). */
  usSalesTaxRate?: number;
  /** Pour EU : taux VAT pays (ex 0.20 FR, 0.19 DE). */
  euVatRate?: number;
  /** Pour CA hors QC : taux HST (ex 0.13 ON, 0.15 NS). */
  caHstRate?: number;
}

const QC_TPS_RATE = 0.05;
const QC_TVQ_RATE = 0.09975;

/** Arrondi monétaire 2 décimales. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Calcule le breakdown taxes selon région.
 *
 * Régions :
 *   - QC  : TPS 5% + TVQ 9.975% (calque billing.ts legacy)
 *   - CA  : HST (taux fourni par caller, ex 0.13 ON / 0.15 NS)
 *   - US  : sales tax (taux state fourni par caller)
 *   - EU  : VAT (taux pays fourni par caller)
 *   - OTHER : pas de taxes (subtotal === total)
 *
 * Edge cases :
 *   - subtotal négatif → traité comme 0 (refund handled séparément).
 *   - taux invalide/missing → 0 pour ce champ.
 */
export function computeTaxBreakdown(
  subtotal: number,
  region: TaxRegion | string,
  rules: TaxRules = {},
): TaxBreakdown {
  if (!Number.isFinite(subtotal) || subtotal < 0) subtotal = 0;
  subtotal = round2(subtotal);

  const reg: TaxRegion = (VALID_TAX_REGIONS as readonly string[]).includes(region)
    ? (region as TaxRegion)
    : 'OTHER';

  let tps = 0;
  let tvq = 0;
  let hst = 0;
  let salesTax = 0;
  let vat = 0;

  switch (reg) {
    case 'QC':
      tps = round2(subtotal * QC_TPS_RATE);
      tvq = round2(subtotal * QC_TVQ_RATE);
      break;
    case 'CA': {
      const rate = Number(rules.caHstRate);
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        hst = round2(subtotal * rate);
      }
      break;
    }
    case 'US': {
      const rate = Number(rules.usSalesTaxRate);
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        salesTax = round2(subtotal * rate);
      }
      break;
    }
    case 'EU': {
      const rate = Number(rules.euVatRate);
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        vat = round2(subtotal * rate);
      }
      break;
    }
    case 'OTHER':
    default:
      // Pas de taxes.
      break;
  }

  const totalTax = round2(tps + tvq + hst + salesTax + vat);
  const total = round2(subtotal + totalTax);

  return {
    subtotal,
    tps,
    tvq,
    hst,
    salesTax,
    vat,
    totalTax,
    total,
    region: reg,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Validation input invoice
// ════════════════════════════════════════════════════════════════════════════

export interface InvoiceLineInput {
  label?: unknown;
  qty?: unknown;
  unit_price?: unknown;
}

export interface InvoiceInputDraft {
  client_id?: unknown;
  lead_id?: unknown;
  description?: unknown;
  amount?: unknown;
  items?: unknown;
  due_date?: unknown;
  tps_number?: unknown;
  tvq_number?: unknown;
  currency?: unknown;
  region?: unknown;
}

export interface InvoiceValidationResult {
  ok: boolean;
  error?: string;
  code?: InvoiceErrorCode;
  field?: string;
}

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LABEL_LENGTH = 300;
const MAX_LINES = 200;

/**
 * Valide un input invoice côté serveur (avant INSERT D1).
 * Accepte SOIT { items: [...] } (chemin enrichi billing.ts §6.C)
 * SOIT { amount: number } (chemin legacy rétro-compat).
 */
export function validateInvoiceInput(input: InvoiceInputDraft): InvoiceValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input invalide', code: 'INVALID_INPUT' };
  }
  // client_id requis
  if (!input.client_id || typeof input.client_id !== 'string' || !input.client_id.trim()) {
    return {
      ok: false,
      error: 'Client requis',
      code: 'MISSING_CLIENT',
      field: 'client_id',
    };
  }
  // Currency optional (default CAD via caller)
  if (input.currency != null) {
    if (typeof input.currency !== 'string' ||
      !(VALID_CURRENCIES as readonly string[]).includes(input.currency)) {
      return {
        ok: false,
        error: 'Devise invalide',
        code: 'CURRENCY_INVALID',
        field: 'currency',
      };
    }
  }
  // Region optional
  if (input.region != null) {
    if (typeof input.region !== 'string' ||
      !(VALID_TAX_REGIONS as readonly string[]).includes(input.region)) {
      return {
        ok: false,
        error: 'Région fiscale invalide',
        code: 'INVALID_REGION',
        field: 'region',
      };
    }
  }
  // description length
  if (input.description != null && typeof input.description === 'string') {
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: 'Description trop longue',
        code: 'INVALID_INPUT',
        field: 'description',
      };
    }
  }
  // Chemin enrichi : items présents → valider chaque ligne
  if (Array.isArray(input.items)) {
    const items = input.items as InvoiceLineInput[];
    if (items.length === 0) {
      return {
        ok: false,
        error: 'Au moins une ligne requise',
        code: 'EMPTY_LINES',
        field: 'items',
      };
    }
    if (items.length > MAX_LINES) {
      return {
        ok: false,
        error: 'Trop de lignes',
        code: 'INVALID_INPUT',
        field: 'items',
      };
    }
    for (let i = 0; i < items.length; i++) {
      const line = items[i];
      if (!line || typeof line !== 'object') {
        return {
          ok: false,
          error: `Ligne ${i + 1} invalide`,
          code: 'INVALID_LINE',
          field: `items[${i}]`,
        };
      }
      const label = String(line.label ?? '').trim();
      if (!label) {
        return {
          ok: false,
          error: `Ligne ${i + 1} : label requis`,
          code: 'INVALID_LINE',
          field: `items[${i}].label`,
        };
      }
      if (label.length > MAX_LABEL_LENGTH) {
        return {
          ok: false,
          error: `Ligne ${i + 1} : label trop long`,
          code: 'INVALID_LINE',
          field: `items[${i}].label`,
        };
      }
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return {
          ok: false,
          error: `Ligne ${i + 1} : quantité invalide`,
          code: 'INVALID_LINE',
          field: `items[${i}].qty`,
        };
      }
      const unitPrice = Number(line.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return {
          ok: false,
          error: `Ligne ${i + 1} : prix invalide`,
          code: 'INVALID_LINE',
          field: `items[${i}].unit_price`,
        };
      }
    }
    return { ok: true };
  }
  // Chemin legacy : amount seul
  if (input.amount != null) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount)) {
      return {
        ok: false,
        error: 'Montant invalide',
        code: 'MISSING_AMOUNT',
        field: 'amount',
      };
    }
    if (amount <= 0) {
      return {
        ok: false,
        error: 'Montant doit être positif',
        code: 'NEGATIVE_AMOUNT',
        field: 'amount',
      };
    }
    return { ok: true };
  }
  // Ni items ni amount
  return {
    ok: false,
    error: 'Items ou amount requis',
    code: 'MISSING_AMOUNT',
    field: 'amount',
  };
}

/** Valide une transition de statut invoice. */
export function validateStatusTransition(
  from: string,
  to: string,
): { ok: boolean; reason?: string } {
  if (!(VALID_INVOICE_STATUSES as readonly string[]).includes(from)) {
    return { ok: false, reason: 'unknown_source_status' };
  }
  if (!(VALID_INVOICE_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, reason: 'unknown_target_status' };
  }
  // paid + cancelled = terminal (immutable, sauf override admin).
  if (from === 'paid' || from === 'cancelled') {
    if (from === to) return { ok: true }; // idempotent
    return { ok: false, reason: 'terminal_status' };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// PDF payload generator
// ════════════════════════════════════════════════════════════════════════════

export interface InvoicePdfMetadata {
  invoiceNumber: string;
  issuedAt: string;
  dueDate: string | null;
  currency: Currency | string;
  region: TaxRegion | string;
}

export interface InvoicePdfPayload {
  html: string;
  metadata: InvoicePdfMetadata;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  issuedAt?: string | null;
  dueDate?: string | null;
  currency?: string;
  region?: string;
  issuer: {
    name?: string | null;
    tps_number?: string | null;
    tvq_number?: string | null;
  };
  customer: {
    name?: string | null;
    email?: string | null;
  };
  lines: Array<{ label: string; qty: number; unit_price: number; line_total: number }>;
  breakdown: TaxBreakdown;
}

/** Échappe HTML basique pour éviter XSS dans le PDF rendu. */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formate un montant en string monnaie (2 décimales). */
function formatMoney(amount: number, currency: string): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(2)} ${currency}`;
}

/**
 * Génère payload PDF structuré (HTML + metadata) — PURE.
 * Caller responsable du rendu binaire (Puppeteer/HTML2PDF/etc.) à partir
 * de l'HTML structuré ici.
 */
export function generateInvoicePdfPayload(
  invoice: InvoicePdfInput,
): InvoicePdfPayload {
  const currency = invoice.currency || 'CAD';
  const region = invoice.region || 'QC';
  const issuedAt = invoice.issuedAt || new Date().toISOString();
  const issuerName = escapeHtml(invoice.issuer?.name || '');
  const customerName = escapeHtml(invoice.customer?.name || '');
  const customerEmail = escapeHtml(invoice.customer?.email || '');
  const tps = invoice.issuer?.tps_number || '';
  const tvq = invoice.issuer?.tvq_number || '';

  const linesHtml = invoice.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.label)}</td><td>${l.qty}</td><td>${formatMoney(
          l.unit_price,
          currency,
        )}</td><td>${formatMoney(l.line_total, currency)}</td></tr>`,
    )
    .join('\n');

  const bd = invoice.breakdown;
  const taxRows: string[] = [];
  if (bd.tps > 0) taxRows.push(`<tr><td>TPS</td><td>${formatMoney(bd.tps, currency)}</td></tr>`);
  if (bd.tvq > 0) taxRows.push(`<tr><td>TVQ</td><td>${formatMoney(bd.tvq, currency)}</td></tr>`);
  if (bd.hst > 0) taxRows.push(`<tr><td>HST</td><td>${formatMoney(bd.hst, currency)}</td></tr>`);
  if (bd.salesTax > 0) taxRows.push(`<tr><td>Sales tax</td><td>${formatMoney(bd.salesTax, currency)}</td></tr>`);
  if (bd.vat > 0) taxRows.push(`<tr><td>VAT</td><td>${formatMoney(bd.vat, currency)}</td></tr>`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNumber)}</title></head>
<body>
<header>
  <h1>${escapeHtml(invoice.invoiceNumber)}</h1>
  <div class="issuer">
    <div>${issuerName}</div>
    ${tps ? `<div>TPS: ${escapeHtml(tps)}</div>` : ''}
    ${tvq ? `<div>TVQ: ${escapeHtml(tvq)}</div>` : ''}
  </div>
  <div class="customer">
    <div>${customerName}</div>
    <div>${customerEmail}</div>
  </div>
  <div class="dates">
    <div>Émise: ${escapeHtml(issuedAt)}</div>
    ${invoice.dueDate ? `<div>Due: ${escapeHtml(invoice.dueDate)}</div>` : ''}
  </div>
</header>
<table class="lines">
  <thead><tr><th>Description</th><th>Qté</th><th>Prix unitaire</th><th>Total</th></tr></thead>
  <tbody>${linesHtml}</tbody>
</table>
<table class="totals">
  <tr><td>Sous-total</td><td>${formatMoney(bd.subtotal, currency)}</td></tr>
  ${taxRows.join('\n  ')}
  <tr class="total"><td>Total</td><td>${formatMoney(bd.total, currency)}</td></tr>
</table>
</body></html>`;

  return {
    html,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      issuedAt,
      dueDate: invoice.dueDate || null,
      currency,
      region,
    },
  };
}
