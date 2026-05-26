// ── quotes-engine.test.ts — Tests RENFORCEMENT quotes-engine.ts ────────────

import { describe, it, expect } from 'vitest';
import {
  QUOTES_ERROR_CODES,
  VALID_QUOTE_STATUSES,
  QUOTE_EXPIRY_DAYS_DEFAULT,
  QUOTE_TAX_TPS,
  QUOTE_TAX_TVQ,
  QUOTE_DESCRIPTION_MAX,
  round2,
  isValidQuoteStatus,
  normalizeQuoteStatus,
  validateQuoteTransition,
  computeQuoteTotals,
  isQuoteExpired,
  computeQuoteExpiry,
  validateQuoteInput,
} from '../lib/quotes-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes & constants
// ════════════════════════════════════════════════════════════════════════════

describe('QUOTES_ERROR_CODES', () => {
  it('expose >= 8 codes', () => {
    expect(Object.keys(QUOTES_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });
  it('codes critiques présents', () => {
    expect(QUOTES_ERROR_CODES.EMPTY_ITEMS).toBe('EMPTY_ITEMS');
    expect(QUOTES_ERROR_CODES.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
    expect(QUOTES_ERROR_CODES.QUOTE_EXPIRED).toBe('QUOTE_EXPIRED');
  });
});

describe('VALID_QUOTE_STATUSES (frozen)', () => {
  it('contient draft/sent/accepted/declined/rejected/expired', () => {
    expect(VALID_QUOTE_STATUSES).toContain('draft');
    expect(VALID_QUOTE_STATUSES).toContain('sent');
    expect(VALID_QUOTE_STATUSES).toContain('accepted');
    expect(VALID_QUOTE_STATUSES).toContain('declined');
    expect(VALID_QUOTE_STATUSES).toContain('rejected');
    expect(VALID_QUOTE_STATUSES).toContain('expired');
  });
  it('frozen', () => {
    expect(Object.isFrozen(VALID_QUOTE_STATUSES)).toBe(true);
  });
  it('QUOTE_EXPIRY_DAYS_DEFAULT = 30', () => {
    expect(QUOTE_EXPIRY_DAYS_DEFAULT).toBe(30);
  });
  it('Taux Quebec : TPS 5% / TVQ 9.975%', () => {
    expect(QUOTE_TAX_TPS).toBe(0.05);
    expect(QUOTE_TAX_TVQ).toBe(0.09975);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// round2 + isValid*
// ════════════════════════════════════════════════════════════════════════════

describe('round2', () => {
  it('round2(12.345) → 12.35', () => {
    expect(round2(12.345)).toBe(12.35);
  });
  it('round2(0.1 + 0.2) → 0.3 (float fix)', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it('round2(100) → 100', () => {
    expect(round2(100)).toBe(100);
  });
});

describe('isValidQuoteStatus / normalizeQuoteStatus', () => {
  it('accepte draft/sent/accepted/declined/rejected/expired', () => {
    for (const s of VALID_QUOTE_STATUSES) {
      expect(isValidQuoteStatus(s)).toBe(true);
    }
  });
  it('rejette unknown', () => {
    expect(isValidQuoteStatus('paid')).toBe(false);
  });
  it('normalize rejected → declined', () => {
    expect(normalizeQuoteStatus('rejected')).toBe('declined');
  });
  it('normalize accepted → accepted', () => {
    expect(normalizeQuoteStatus('accepted')).toBe('accepted');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateQuoteTransition (state machine)
// ════════════════════════════════════════════════════════════════════════════

describe('validateQuoteTransition', () => {
  it('draft → sent OK', () => {
    expect(validateQuoteTransition('draft', 'sent')).toBe(true);
  });
  it('sent → accepted OK', () => {
    expect(validateQuoteTransition('sent', 'accepted')).toBe(true);
  });
  it('accepted → draft INTERDIT (terminal)', () => {
    expect(validateQuoteTransition('accepted', 'draft')).toBe(false);
  });
  it('declined → sent INTERDIT (terminal)', () => {
    expect(validateQuoteTransition('declined', 'sent')).toBe(false);
  });
  it('expired → sent OK (re-quote)', () => {
    expect(validateQuoteTransition('expired', 'sent')).toBe(true);
  });
  it('draft → draft OK (no-op)', () => {
    expect(validateQuoteTransition('draft', 'draft')).toBe(true);
  });
  it('rejette unknown status', () => {
    expect(validateQuoteTransition('draft', 'foo')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(validateQuoteTransition(null, 'sent')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeQuoteTotals
// ════════════════════════════════════════════════════════════════════════════

describe('computeQuoteTotals', () => {
  it('rejette non-array', () => {
    const r = computeQuoteTotals(null);
    expect(r.ok).toBe(false);
  });
  it('rejette items vide', () => {
    const r = computeQuoteTotals([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.EMPTY_ITEMS);
  });
  it('1 ligne simple Quebec (100$)', () => {
    const r = computeQuoteTotals([
      { label: 'A', qty: 1, unit_price: 100 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totals.subtotal).toBe(100);
      expect(r.totals.tax_tps).toBe(5);
      expect(r.totals.tax_tvq).toBe(9.98);
      expect(r.totals.total).toBe(114.98);
    }
  });
  it('multi-lignes Quebec', () => {
    const r = computeQuoteTotals([
      { label: 'A', qty: 2, unit_price: 50 },
      { label: 'B', qty: 1, unit_price: 100 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totals.subtotal).toBe(200);
  });
  it('rejette qty <= 0', () => {
    const r = computeQuoteTotals([{ label: 'A', qty: 0, unit_price: 10 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.INVALID_QTY);
  });
  it('rejette qty négatif', () => {
    const r = computeQuoteTotals([{ label: 'A', qty: -1, unit_price: 10 }]);
    expect(r.ok).toBe(false);
  });
  it('rejette unit_price négatif', () => {
    const r = computeQuoteTotals([{ label: 'A', qty: 1, unit_price: -5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.NEGATIVE_PRICE);
  });
  it('rejette unit_price NaN', () => {
    const r = computeQuoteTotals([{ label: 'A', qty: 1, unit_price: 'abc' }]);
    expect(r.ok).toBe(false);
  });
  it('discount soustrait du taxable_base', () => {
    const r = computeQuoteTotals(
      [{ label: 'A', qty: 1, unit_price: 100 }],
      {},
      20,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totals.discount).toBe(20);
      expect(r.totals.taxable_base).toBe(80);
      // Tax sur 80 = 5% + 9.975% = 4 + 7.98 = 11.98 ; total = 91.98
      expect(r.totals.tax_tps).toBe(4);
      expect(r.totals.tax_tvq).toBe(7.98);
    }
  });
  it('discount > subtotal clamped à subtotal', () => {
    const r = computeQuoteTotals(
      [{ label: 'A', qty: 1, unit_price: 50 }],
      {},
      999,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totals.discount).toBe(50);
  });
  it('rejette discount négatif', () => {
    const r = computeQuoteTotals(
      [{ label: 'A', qty: 1, unit_price: 50 }],
      {},
      -10,
    );
    expect(r.ok).toBe(false);
  });
  it('taxConfig.rate=0.10 → tax unique', () => {
    const r = computeQuoteTotals(
      [{ label: 'A', qty: 1, unit_price: 100 }],
      { rate: 0.1 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totals.tax).toBe(10);
      expect(r.totals.total).toBe(110);
    }
  });
  it('rejette taxConfig.rate > 1', () => {
    const r = computeQuoteTotals(
      [{ label: 'A', qty: 1, unit_price: 100 }],
      { rate: 2 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.INVALID_TAX_RATE);
  });
  it('ignore lignes sans label', () => {
    const r = computeQuoteTotals([
      { label: '', qty: 1, unit_price: 50 },
      { label: 'A', qty: 1, unit_price: 100 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totals.lines.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isQuoteExpired / computeQuoteExpiry
// ════════════════════════════════════════════════════════════════════════════

describe('isQuoteExpired', () => {
  it('null → false', () => {
    expect(isQuoteExpired(null)).toBe(false);
  });
  it('accepted → false (terminal)', () => {
    expect(
      isQuoteExpired({
        status: 'accepted',
        valid_until: Date.now() - 1000,
      }),
    ).toBe(false);
  });
  it('declined → false', () => {
    expect(
      isQuoteExpired({ status: 'declined', valid_until: 0 }),
    ).toBe(false);
  });
  it('valid_until passé → true', () => {
    expect(
      isQuoteExpired(
        { status: 'sent', valid_until: Date.now() - 1000 },
        Date.now(),
      ),
    ).toBe(true);
  });
  it('valid_until futur → false', () => {
    expect(
      isQuoteExpired(
        { status: 'sent', valid_until: Date.now() + 60_000 },
        Date.now(),
      ),
    ).toBe(false);
  });
  it('fallback created_at +30j passé → true', () => {
    const now = Date.now();
    const created = now - 31 * 24 * 60 * 60 * 1000;
    expect(isQuoteExpired({ status: 'sent', created_at: created }, now)).toBe(
      true,
    );
  });
  it('fallback created_at récent → false', () => {
    const now = Date.now();
    const created = now - 5 * 24 * 60 * 60 * 1000;
    expect(isQuoteExpired({ status: 'sent', created_at: created }, now)).toBe(
      false,
    );
  });
  it('valid_until prend précédence sur created_at', () => {
    const now = Date.now();
    expect(
      isQuoteExpired(
        {
          status: 'sent',
          valid_until: now + 60_000,
          created_at: now - 60 * 24 * 60 * 60 * 1000,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('computeQuoteExpiry', () => {
  it('défaut +30j', () => {
    const now = Date.now();
    const exp = computeQuoteExpiry(now);
    expect(exp.getTime() - now).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it('custom +7j', () => {
    const now = Date.now();
    const exp = computeQuoteExpiry(now, 7);
    expect(exp.getTime() - now).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it('accepte ISO string', () => {
    const exp = computeQuoteExpiry('2026-01-01T00:00:00Z', 30);
    expect(exp instanceof Date).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateQuoteInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateQuoteInput', () => {
  it('accepte input avec items valides', () => {
    const r = validateQuoteInput({
      items: [{ label: 'A', qty: 1, unit_price: 100 }],
    });
    expect(r.ok).toBe(true);
  });
  it('rejette items vides en create', () => {
    const r = validateQuoteInput({ items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.EMPTY_ITEMS);
  });
  it('rejette description > MAX', () => {
    const r = validateQuoteInput({
      items: [{ label: 'A', qty: 1, unit_price: 50 }],
      description: 'd'.repeat(QUOTE_DESCRIPTION_MAX + 1),
    });
    expect(r.ok).toBe(false);
  });
  it('rejette status invalide', () => {
    const r = validateQuoteInput({
      items: [{ label: 'A', qty: 1, unit_price: 50 }],
      status: 'paid',
    });
    expect(r.ok).toBe(false);
  });
  it('accepte status declined', () => {
    expect(
      validateQuoteInput({
        items: [{ label: 'A', qty: 1, unit_price: 50 }],
        status: 'declined',
      }).ok,
    ).toBe(true);
  });
  it('rejette valid_until non parsable', () => {
    const r = validateQuoteInput({
      items: [{ label: 'A', qty: 1, unit_price: 50 }],
      valid_until: 'not-a-date',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(QUOTES_ERROR_CODES.INVALID_EXPIRY);
  });
  it('accepte valid_until ISO valide', () => {
    expect(
      validateQuoteInput({
        items: [{ label: 'A', qty: 1, unit_price: 50 }],
        valid_until: '2026-12-31',
      }).ok,
    ).toBe(true);
  });
  it('update accepte input vide', () => {
    expect(validateQuoteInput({}, 'update').ok).toBe(true);
  });
  it('update accepte items partiels', () => {
    expect(
      validateQuoteInput(
        { items: [{ label: 'A', qty: 1, unit_price: 50 }] },
        'update',
      ).ok,
    ).toBe(true);
  });
  it('update rejette items vides si fourni', () => {
    expect(validateQuoteInput({ items: [] }, 'update').ok).toBe(false);
  });
});
