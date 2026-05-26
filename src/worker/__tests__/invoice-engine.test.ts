// ── invoice-engine.test.ts — Tests RENFORCEMENT invoice-engine.ts ──────────
//
// Couvre helpers PURS facturation :
//   - INVOICE_ERROR_CODES + status/region constants
//   - formatInvoiceNumber + parseInvoiceNumber
//   - computeTaxBreakdown (QC/CA/US/EU/OTHER)
//   - validateInvoiceInput (chemin enrichi + legacy)
//   - validateStatusTransition
//   - generateInvoicePdfPayload (structure HTML)

import { describe, it, expect } from 'vitest';
import {
  INVOICE_ERROR_CODES,
  VALID_INVOICE_STATUSES,
  VALID_TAX_REGIONS,
  VALID_CURRENCIES,
  formatInvoiceNumber,
  parseInvoiceNumber,
  computeTaxBreakdown,
  validateInvoiceInput,
  validateStatusTransition,
  generateInvoicePdfPayload,
} from '../lib/invoice-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes
// ════════════════════════════════════════════════════════════════════════════

describe('INVOICE_ERROR_CODES', () => {
  it('expose >= 8 codes', () => {
    expect(Object.keys(INVOICE_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });
  it('codes critiques attendus', () => {
    expect(INVOICE_ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(INVOICE_ERROR_CODES.MISSING_CLIENT).toBe('MISSING_CLIENT');
    expect(INVOICE_ERROR_CODES.NEGATIVE_AMOUNT).toBe('NEGATIVE_AMOUNT');
    expect(INVOICE_ERROR_CODES.INVALID_LINE).toBe('INVALID_LINE');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatInvoiceNumber / parseInvoiceNumber
// ════════════════════════════════════════════════════════════════════════════

describe('formatInvoiceNumber', () => {
  it('(1, 2026) → "INV-2026-000001"', () => {
    expect(formatInvoiceNumber(1, 2026)).toBe('INV-2026-000001');
  });
  it('(123, 2026) → "INV-2026-000123"', () => {
    expect(formatInvoiceNumber(123, 2026)).toBe('INV-2026-000123');
  });
  it('(999999, 2026) → "INV-2026-999999"', () => {
    expect(formatInvoiceNumber(999999, 2026)).toBe('INV-2026-999999');
  });
  it('seq < 1 → fallback 1', () => {
    expect(formatInvoiceNumber(0, 2026)).toBe('INV-2026-000001');
    expect(formatInvoiceNumber(-5, 2026)).toBe('INV-2026-000001');
  });
  it('seq décimal → floor', () => {
    expect(formatInvoiceNumber(2.7, 2026)).toBe('INV-2026-000002');
  });
  it('digits custom (legacy 4)', () => {
    expect(formatInvoiceNumber(42, 2026, 4)).toBe('INV-2026-0042');
  });
  it('year absent → année courante', () => {
    const out = formatInvoiceNumber(1);
    expect(out).toMatch(/^INV-\d{4}-000001$/);
  });
  it('digits cap 10', () => {
    expect(formatInvoiceNumber(1, 2026, 99)).toMatch(/^INV-2026-0{9}1$/);
  });
});

describe('parseInvoiceNumber', () => {
  it('parse format standard', () => {
    expect(parseInvoiceNumber('INV-2026-000123')).toEqual({ year: 2026, seq: 123 });
  });
  it('parse format legacy 4-digit', () => {
    expect(parseInvoiceNumber('INV-2026-0042')).toEqual({ year: 2026, seq: 42 });
  });
  it('null si format invalide', () => {
    expect(parseInvoiceNumber('NOT-A-NUMBER')).toBeNull();
    expect(parseInvoiceNumber('INV-2026-')).toBeNull();
    expect(parseInvoiceNumber('inv-2026-000001')).toBeNull(); // case-sensitive
  });
  it('null si input non-string', () => {
    expect(parseInvoiceNumber(null as never)).toBeNull();
    expect(parseInvoiceNumber(42 as never)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeTaxBreakdown
// ════════════════════════════════════════════════════════════════════════════

describe('computeTaxBreakdown', () => {
  it('Quebec 100 → TPS 5 + TVQ 9.975 = 114.975', () => {
    const b = computeTaxBreakdown(100, 'QC');
    expect(b.tps).toBe(5);
    expect(b.tvq).toBeCloseTo(9.98, 2);
    expect(b.total).toBeCloseTo(114.98, 2);
    expect(b.hst).toBe(0);
    expect(b.salesTax).toBe(0);
    expect(b.vat).toBe(0);
  });
  it('Quebec 1000 → TPS 50 + TVQ 99.75 = 1149.75', () => {
    const b = computeTaxBreakdown(1000, 'QC');
    expect(b.tps).toBe(50);
    expect(b.tvq).toBe(99.75);
    expect(b.total).toBe(1149.75);
  });
  it('Canada ON HST 13% sur 100 → 13', () => {
    const b = computeTaxBreakdown(100, 'CA', { caHstRate: 0.13 });
    expect(b.hst).toBe(13);
    expect(b.tps).toBe(0);
    expect(b.tvq).toBe(0);
    expect(b.total).toBe(113);
  });
  it('US sales tax 6.25% sur 200 → 12.5', () => {
    const b = computeTaxBreakdown(200, 'US', { usSalesTaxRate: 0.0625 });
    expect(b.salesTax).toBe(12.5);
    expect(b.total).toBe(212.5);
  });
  it('EU VAT 20% sur 50 → 10', () => {
    const b = computeTaxBreakdown(50, 'EU', { euVatRate: 0.2 });
    expect(b.vat).toBe(10);
    expect(b.total).toBe(60);
  });
  it('OTHER region → pas de taxes', () => {
    const b = computeTaxBreakdown(100, 'OTHER');
    expect(b.totalTax).toBe(0);
    expect(b.total).toBe(100);
  });
  it('Région inconnue → fallback OTHER (pas de taxes)', () => {
    const b = computeTaxBreakdown(100, 'ZZ' as never);
    expect(b.region).toBe('OTHER');
    expect(b.total).toBe(100);
  });
  it('subtotal négatif normalisé à 0', () => {
    const b = computeTaxBreakdown(-50, 'QC');
    expect(b.subtotal).toBe(0);
    expect(b.total).toBe(0);
  });
  it('rules absent en US → salesTax 0', () => {
    const b = computeTaxBreakdown(100, 'US');
    expect(b.salesTax).toBe(0);
    expect(b.total).toBe(100);
  });
  it('rate invalide (>=1) ignoré', () => {
    const b = computeTaxBreakdown(100, 'US', { usSalesTaxRate: 1.5 });
    expect(b.salesTax).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateInvoiceInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateInvoiceInput', () => {
  it('chemin legacy : amount valide → OK', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', amount: 100 });
    expect(r.ok).toBe(true);
  });
  it('chemin enrichi : items valides → OK', () => {
    const r = validateInvoiceInput({
      client_id: 'cl_1',
      items: [{ label: 'Service', qty: 1, unit_price: 100 }],
    });
    expect(r.ok).toBe(true);
  });
  it('missing client_id → MISSING_CLIENT', () => {
    const r = validateInvoiceInput({ amount: 100 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_CLIENT');
    expect(r.field).toBe('client_id');
  });
  it('amount négatif → NEGATIVE_AMOUNT', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', amount: -10 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NEGATIVE_AMOUNT');
  });
  it('amount NaN → MISSING_AMOUNT', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', amount: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_AMOUNT');
  });
  it('items vide → EMPTY_LINES', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', items: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMPTY_LINES');
  });
  it('line sans label → INVALID_LINE', () => {
    const r = validateInvoiceInput({
      client_id: 'cl_1',
      items: [{ label: '', qty: 1, unit_price: 100 }],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_LINE');
  });
  it('line qty 0 ou négatif → INVALID_LINE', () => {
    const r1 = validateInvoiceInput({
      client_id: 'cl_1',
      items: [{ label: 'X', qty: 0, unit_price: 100 }],
    });
    expect(r1.ok).toBe(false);
    const r2 = validateInvoiceInput({
      client_id: 'cl_1',
      items: [{ label: 'X', qty: -1, unit_price: 100 }],
    });
    expect(r2.ok).toBe(false);
  });
  it('currency invalide → CURRENCY_INVALID', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', amount: 100, currency: 'XYZ' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CURRENCY_INVALID');
  });
  it('region invalide → INVALID_REGION', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1', amount: 100, region: 'ZZ' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_REGION');
  });
  it('ni items ni amount → MISSING_AMOUNT', () => {
    const r = validateInvoiceInput({ client_id: 'cl_1' });
    expect(r.ok).toBe(false);
  });
  it('input null/undefined → INVALID_INPUT', () => {
    expect(validateInvoiceInput(null as never).ok).toBe(false);
    expect(validateInvoiceInput(undefined as never).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateStatusTransition
// ════════════════════════════════════════════════════════════════════════════

describe('validateStatusTransition', () => {
  it('draft → sent : OK', () => {
    expect(validateStatusTransition('draft', 'sent').ok).toBe(true);
  });
  it('sent → paid : OK', () => {
    expect(validateStatusTransition('sent', 'paid').ok).toBe(true);
  });
  it('paid → anything : rejeté (terminal sauf idempotent)', () => {
    expect(validateStatusTransition('paid', 'sent').ok).toBe(false);
    expect(validateStatusTransition('paid', 'cancelled').ok).toBe(false);
  });
  it('paid → paid : idempotent OK', () => {
    expect(validateStatusTransition('paid', 'paid').ok).toBe(true);
  });
  it('cancelled → draft : rejeté', () => {
    expect(validateStatusTransition('cancelled', 'draft').ok).toBe(false);
  });
  it('status inconnu rejeté', () => {
    expect(validateStatusTransition('xxx', 'paid').ok).toBe(false);
    expect(validateStatusTransition('paid', 'xxx').ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// generateInvoicePdfPayload
// ════════════════════════════════════════════════════════════════════════════

describe('generateInvoicePdfPayload', () => {
  const breakdown = computeTaxBreakdown(100, 'QC');
  const baseInput = {
    invoiceNumber: 'INV-2026-000001',
    dueDate: '2026-06-30',
    issuedAt: '2026-05-26T12:00:00Z',
    currency: 'CAD',
    region: 'QC',
    issuer: { name: 'Intralys', tps_number: '123456789', tvq_number: '987654321' },
    customer: { name: 'Acme Inc.', email: 'acme@example.com' },
    lines: [{ label: 'Service web', qty: 1, unit_price: 100, line_total: 100 }],
    breakdown,
  };

  it('renvoie { html, metadata } structuré', () => {
    const out = generateInvoicePdfPayload(baseInput);
    expect(typeof out.html).toBe('string');
    expect(out.metadata.invoiceNumber).toBe('INV-2026-000001');
    expect(out.metadata.dueDate).toBe('2026-06-30');
    expect(out.metadata.currency).toBe('CAD');
  });
  it('HTML contient le numéro de facture', () => {
    const out = generateInvoicePdfPayload(baseInput);
    expect(out.html).toContain('INV-2026-000001');
  });
  it('HTML contient nom issuer + customer', () => {
    const out = generateInvoicePdfPayload(baseInput);
    expect(out.html).toContain('Intralys');
    expect(out.html).toContain('Acme Inc.');
  });
  it('HTML contient TPS + TVQ rows', () => {
    const out = generateInvoicePdfPayload(baseInput);
    expect(out.html).toContain('TPS');
    expect(out.html).toContain('TVQ');
  });
  it('XSS escape sur nom client', () => {
    const out = generateInvoicePdfPayload({
      ...baseInput,
      customer: { name: '<script>alert(1)</script>', email: null },
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
  it('issuedAt par défaut si absent', () => {
    const out = generateInvoicePdfPayload({ ...baseInput, issuedAt: null });
    expect(out.metadata.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALID_* constants sanity
// ════════════════════════════════════════════════════════════════════════════

describe('VALID_* constants', () => {
  it('VALID_INVOICE_STATUSES inclut draft/sent/paid/cancelled', () => {
    expect(VALID_INVOICE_STATUSES).toContain('draft');
    expect(VALID_INVOICE_STATUSES).toContain('sent');
    expect(VALID_INVOICE_STATUSES).toContain('paid');
    expect(VALID_INVOICE_STATUSES).toContain('cancelled');
  });
  it('VALID_TAX_REGIONS inclut QC/CA/US/EU/OTHER', () => {
    expect(VALID_TAX_REGIONS).toEqual(['QC', 'CA', 'US', 'EU', 'OTHER']);
  });
  it('VALID_CURRENCIES contient CAD/USD/EUR/GBP', () => {
    expect(VALID_CURRENCIES).toEqual(['CAD', 'USD', 'EUR', 'GBP']);
  });
});
