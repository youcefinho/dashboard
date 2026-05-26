// ── POS engine tests — Sprint 37 Phase A SOCLE (2026-05-24) ────────────────-
//
// Tests vitest des helpers PURS de `pos-engine.ts` (Agent C1). Couvre :
//   - computeChange (insufficient / exact / normal)
//   - computeSessionVariance (ok / low / high / negative)
//   - roundCashTender (table réglementaire 5¢ CAD)
//   - validatePaymentSplit (sum match / mismatch / méthode invalide)
//   - chargeCardTerminal (mock flag-inactif sans bindings env)

import { describe, it, expect } from 'vitest';
import {
  computeChange,
  computeSessionVariance,
  roundCashTender,
  validatePaymentSplit,
  chargeCardTerminal,
  validateBarcode,
  computeCartTotal,
  validateSessionOpen,
  computeSessionVarianceFromOpening,
  generateReceiptNumber,
  mockStripeTerminalCharge,
  isValidPaymentMethod,
  POS_ERROR_CODES,
} from '../lib/pos-engine';
import type { Env } from '../types';

describe('pos-engine helpers', () => {
  // ── computeChange ────────────────────────────────────────────────────────
  describe('computeChange', () => {
    it('returns insufficient error when tendered < total', () => {
      const result = computeChange(1000, 500);
      expect(result).toEqual({ changeCents: 0, error: 'insufficient' });
    });

    it('returns 0 change with no error when tendered == total', () => {
      const result = computeChange(1000, 1000);
      expect(result.changeCents).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('returns correct change when tendered > total', () => {
      const result = computeChange(1000, 1500);
      expect(result).toEqual({ changeCents: 500 });
    });
  });

  // ── computeSessionVariance ───────────────────────────────────────────────
  describe('computeSessionVariance', () => {
    it('returns warningLevel "ok" when |variance| <= 500 cents (±$5)', () => {
      const result = computeSessionVariance(10000, 10300);
      expect(result).toEqual({ varianceCents: 300, warningLevel: 'ok' });
    });

    it('returns warningLevel "low" when 500 < |variance| <= 2000 cents', () => {
      const result = computeSessionVariance(10000, 11500);
      expect(result).toEqual({ varianceCents: 1500, warningLevel: 'low' });
    });

    it('returns warningLevel "high" when |variance| > 2000 cents', () => {
      const result = computeSessionVariance(10000, 15000);
      expect(result).toEqual({ varianceCents: 5000, warningLevel: 'high' });
    });

    it('returns warningLevel "high" for large negative variance', () => {
      const result = computeSessionVariance(10000, 5000);
      expect(result).toEqual({ varianceCents: -5000, warningLevel: 'high' });
    });
  });

  // ── roundCashTender ──────────────────────────────────────────────────────
  describe('roundCashTender (5¢ CAD, Loi sur la monnaie)', () => {
    it('rounds 4¢ → 5¢', () => {
      expect(roundCashTender(1234, 'qc')).toBe(1235);
    });

    it('rounds 2¢ → 0¢', () => {
      expect(roundCashTender(1232, 'qc')).toBe(1230);
    });

    it('rounds 8¢ → 10¢', () => {
      expect(roundCashTender(1238, 'qc')).toBe(1240);
    });

    it('keeps already-rounded value unchanged', () => {
      expect(roundCashTender(1230, 'qc')).toBe(1230);
    });
  });

  // ── validatePaymentSplit ─────────────────────────────────────────────────
  describe('validatePaymentSplit', () => {
    it('returns valid when sum of splits == total', () => {
      const splits = [
        { method: 'cash', amountCents: 500 },
        { method: 'card_terminal', amountCents: 500 },
      ];
      const result = validatePaymentSplit(1000, splits);
      expect(result).toEqual({ valid: true });
    });

    it('returns sum_mismatch error when sum != total', () => {
      const splits = [
        { method: 'cash', amountCents: 400 },
        { method: 'card_terminal', amountCents: 500 },
      ];
      const result = validatePaymentSplit(1000, splits);
      expect(result).toEqual({ valid: false, error: 'sum_mismatch' });
    });

    it('returns invalid_method error when a split uses a non-whitelisted method', () => {
      const splits = [
        { method: 'cash', amountCents: 500 },
        { method: 'crypto', amountCents: 500 },
      ];
      const result = validatePaymentSplit(1000, splits);
      expect(result).toEqual({ valid: false, error: 'invalid_method' });
    });
  });

  // ── chargeCardTerminal ───────────────────────────────────────────────────
  describe('chargeCardTerminal (flag-inactif E4)', () => {
    it('returns mock=true with mock_terminal_ providerRef when env credentials absent', async () => {
      const env = {} as Env;
      const result = await chargeCardTerminal(env, 2500, 'session_test_123');
      expect(result.success).toBe(true);
      expect(result.mock).toBe(true);
      expect(result.providerRef).toMatch(/^mock_terminal_/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Phase B renforcement tests — Sprint 37 (2026-05-26) ────────────────────-
// ─────────────────────────────────────────────────────────────────────────────

describe('pos-engine Phase B renforcement', () => {
  // ── validateBarcode ──────────────────────────────────────────────────────
  describe('validateBarcode', () => {
    it('accepts a valid EAN-13 with correct GS1 Mod-10 checksum', () => {
      // 4006381333931 — exemple canonique EAN-13 (Faber-Castell)
      const result = validateBarcode('4006381333931', 'ean13');
      expect(result).toEqual({ ok: true, code: '4006381333931' });
    });

    it('rejects an EAN-13 with wrong checksum digit', () => {
      // dernier digit changé 1 → 2
      const result = validateBarcode('4006381333932', 'ean13');
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.BARCODE_INVALID_CHECKSUM);
    });

    it('rejects an EAN-13 with wrong length', () => {
      const result = validateBarcode('123456', 'ean13');
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.BARCODE_INVALID_LENGTH);
    });

    it('accepts a valid UPC-A (12 digits, GS1 checksum)', () => {
      // 036000291452 — exemple UPC-A canonique (Wikipedia)
      const result = validateBarcode('036000291452', 'upc');
      expect(result.ok).toBe(true);
      expect(result.code).toBe('036000291452');
    });

    it('rejects a UPC-A with wrong checksum', () => {
      const result = validateBarcode('036000291453', 'upc');
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.BARCODE_INVALID_CHECKSUM);
    });

    it('accepts a custom barcode with [A-Z0-9_-]', () => {
      const result = validateBarcode('sku-ABC_123', 'custom');
      // normalisé en uppercase
      expect(result).toEqual({ ok: true, code: 'SKU-ABC_123' });
    });

    it('rejects a custom barcode with invalid charset', () => {
      const result = validateBarcode('sku abc!', 'custom');
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.BARCODE_INVALID_CHARSET);
    });

    it('auto-detects EAN-13 when type omitted', () => {
      const result = validateBarcode('4006381333931');
      expect(result.ok).toBe(true);
    });
  });

  // ── computeCartTotal ─────────────────────────────────────────────────────
  describe('computeCartTotal', () => {
    it('computes subtotal + tax 14.975% + discount 10$ for 3 items', () => {
      // 3 lignes : 10$ x2 = 2000, 5$ x1 = 500, 7,50$ x4 = 3000. subtotal = 5500
      // discount = 1000 (10$). preTaxBase = 4500.
      // tax = round(4500 * 0.14975) = round(673.875) = 674.
      // total = 4500 + 674 = 5174.
      const items = [
        { priceCents: 1000, quantity: 2 },
        { priceCents: 500, quantity: 1 },
        { priceCents: 750, quantity: 4 },
      ];
      const result = computeCartTotal(items, 1000, 0.14975);
      expect(result.subtotalCents).toBe(5500);
      expect(result.discountCents).toBe(1000);
      expect(result.taxCents).toBe(674);
      expect(result.totalCents).toBe(5174);
      expect(result.error).toBeUndefined();
    });

    it('returns integers (cents-safe, no floating drift) on tricky rates', () => {
      // Cas connu floating drift JS : 0.1 + 0.2 = 0.30000000000000004
      // subtotal = 333 cents x 1 = 333. tax = round(333 * 0.1) = 33.
      const result = computeCartTotal(
        [{ priceCents: 333, quantity: 1 }],
        0,
        0.1,
      );
      expect(Number.isInteger(result.taxCents)).toBe(true);
      expect(Number.isInteger(result.totalCents)).toBe(true);
      expect(result.totalCents).toBe(366);
    });

    it('returns error cart_empty when items array empty', () => {
      const result = computeCartTotal([], 0, 0);
      expect(result.error).toBe(POS_ERROR_CODES.CART_EMPTY);
      expect(result.totalCents).toBe(0);
    });

    it('returns error cart_discount_too_large when discount > subtotal', () => {
      const result = computeCartTotal(
        [{ priceCents: 1000, quantity: 1 }],
        2000,
        0,
      );
      expect(result.error).toBe(POS_ERROR_CODES.CART_DISCOUNT_TOO_LARGE);
    });

    it('returns error cart_invalid_quantity when qty <= 0', () => {
      const result = computeCartTotal(
        [{ priceCents: 1000, quantity: 0 }],
        0,
        0,
      );
      expect(result.error).toBe(POS_ERROR_CODES.CART_INVALID_QUANTITY);
    });
  });

  // ── validateSessionOpen ──────────────────────────────────────────────────
  describe('validateSessionOpen', () => {
    it('accepts opening cash 0 with cashier id', () => {
      const result = validateSessionOpen({
        openingCashCents: 0,
        cashierUserId: 'user_abc',
      });
      expect(result).toEqual({ ok: true });
    });

    it('rejects negative opening cash', () => {
      const result = validateSessionOpen({
        openingCashCents: -100,
        cashierUserId: 'user_abc',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.SESSION_OPENING_CASH_NEGATIVE);
    });

    it('rejects opening cash too large (> 1M $)', () => {
      const result = validateSessionOpen({
        openingCashCents: 200_000_000,
        cashierUserId: 'user_abc',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.SESSION_OPENING_CASH_TOO_LARGE);
    });

    it('rejects missing/empty cashier id', () => {
      const result = validateSessionOpen({
        openingCashCents: 10000,
        cashierUserId: '   ',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(POS_ERROR_CODES.SESSION_CASHIER_MISSING);
    });
  });

  // ── computeSessionVarianceFromOpening ────────────────────────────────────
  describe('computeSessionVarianceFromOpening', () => {
    it('returns positive variance when actual > opening + sales (surplus)', () => {
      const v = computeSessionVarianceFromOpening({
        openingCashCents: 10000,
        expectedSalesCents: 50000,
        actualCashCents: 60500,
      });
      expect(v).toBe(500);
    });

    it('returns negative variance when actual < opening + sales (shortage)', () => {
      const v = computeSessionVarianceFromOpening({
        openingCashCents: 10000,
        expectedSalesCents: 50000,
        actualCashCents: 59000,
      });
      expect(v).toBe(-1000);
    });
  });

  // ── generateReceiptNumber ────────────────────────────────────────────────
  describe('generateReceiptNumber', () => {
    it('produces format R-{PREFIX}-{YYYYMMDD}-{SEQ+HEX}', () => {
      const num = generateReceiptNumber('ACME');
      expect(num).toMatch(/^R-ACME-\d{8}-\d{4}[0-9A-F]{4}$/);
    });

    it('normalizes prefix to uppercase', () => {
      const num = generateReceiptNumber('acme');
      expect(num.startsWith('R-ACME-')).toBe(true);
    });

    it('produces unique numbers across calls (sequence increments)', () => {
      const a = generateReceiptNumber('TEST');
      const b = generateReceiptNumber('TEST');
      const c = generateReceiptNumber('TEST');
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    });

    it('throws on invalid prefix charset', () => {
      expect(() => generateReceiptNumber('ACME!')).toThrow(
        POS_ERROR_CODES.RECEIPT_PREFIX_INVALID,
      );
    });
  });

  // ── mockStripeTerminalCharge ─────────────────────────────────────────────
  describe('mockStripeTerminalCharge', () => {
    it('returns realistic shape with pi_mock_ prefix on valid CAD charge', () => {
      const result = mockStripeTerminalCharge(2500, 'CAD');
      expect(result.success).toBe(true);
      expect(result.mockId).toMatch(/^pi_mock_\d+_[0-9a-f]{4}$/);
      expect(result.reason).toBe('flag_inactive');
      expect(result.amountCents).toBe(2500);
      expect(result.currency).toBe('CAD');
    });

    it('rejects unsupported currency', () => {
      const result = mockStripeTerminalCharge(2500, 'XYZ');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('unsupported_currency');
    });

    it('rejects non-positive amount', () => {
      const result = mockStripeTerminalCharge(0, 'CAD');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_amount');
    });
  });

  // ── isValidPaymentMethod ─────────────────────────────────────────────────
  describe('isValidPaymentMethod', () => {
    it('accepts cash / card_terminal / gift_card / other / split', () => {
      expect(isValidPaymentMethod('cash')).toBe(true);
      expect(isValidPaymentMethod('card_terminal')).toBe(true);
      expect(isValidPaymentMethod('gift_card')).toBe(true);
      expect(isValidPaymentMethod('other')).toBe(true);
      expect(isValidPaymentMethod('split')).toBe(true);
    });

    it('accepts case-insensitive', () => {
      expect(isValidPaymentMethod('Cash')).toBe(true);
      expect(isValidPaymentMethod('  CASH  ')).toBe(true);
    });

    it('rejects unknown method', () => {
      expect(isValidPaymentMethod('crypto')).toBe(false);
      expect(isValidPaymentMethod('')).toBe(false);
    });
  });

  // ── POS_ERROR_CODES ──────────────────────────────────────────────────────
  describe('POS_ERROR_CODES', () => {
    it('exposes at least 8 stable error codes', () => {
      const keys = Object.keys(POS_ERROR_CODES);
      expect(keys.length).toBeGreaterThanOrEqual(8);
      // valeurs uniques (sanity)
      const values = Object.values(POS_ERROR_CODES);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
