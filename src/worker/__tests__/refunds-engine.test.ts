// ── refunds-engine tests — Sprint E6 M1 hardening (2026-05-26) ─────────────-
//
// Tests PURS sur les helpers refund : validateRefundAmount, idempotencyKey,
// idempotencyKeyWithAmount, validateRefundReason, validateCurrencyMatch.

import { describe, it, expect } from 'vitest';
import {
  REFUND_ERROR_CODES,
  REFUND_REASON_WHITELIST,
  validateRefundAmount,
  validateCurrencyMatch,
  validateRefundReason,
  idempotencyKey,
  idempotencyKeyWithAmount,
} from '../lib/refunds-engine';

describe('refunds-engine — constants', () => {
  it('expose les 6 codes erreur stables', () => {
    expect(REFUND_ERROR_CODES.AMOUNT_INVALID).toBe('amount_invalid');
    expect(REFUND_ERROR_CODES.AMOUNT_OVER_PAID).toBe('amount_over_paid');
    expect(REFUND_ERROR_CODES.CURRENCY_MISMATCH).toBe('currency_mismatch');
    expect(REFUND_ERROR_CODES.INVALID_REASON).toBe('invalid_reason');
    expect(REFUND_ERROR_CODES.ALREADY_FULL_REFUND).toBe('already_full_refund');
    expect(REFUND_ERROR_CODES.NEGATIVE_REMAINING).toBe('negative_remaining');
  });

  it('REFUND_REASON_WHITELIST contient 9 raisons', () => {
    expect(REFUND_REASON_WHITELIST.length).toBe(9);
    expect(REFUND_REASON_WHITELIST).toContain('requested_by_customer');
    expect(REFUND_REASON_WHITELIST).toContain('fraudulent');
    expect(REFUND_REASON_WHITELIST).toContain('dispute_lost');
  });
});

describe('refunds-engine — validateRefundReason', () => {
  it('accepte whitelist (case-insensitive)', () => {
    expect(validateRefundReason('fraudulent')).toBe(true);
    expect(validateRefundReason('  DUPLICATE  ')).toBe(true);
  });
  it('rejette hors whitelist', () => {
    expect(validateRefundReason('customer_lied')).toBe(false);
    expect(validateRefundReason(null)).toBe(false);
    expect(validateRefundReason(42)).toBe(false);
  });
});

describe('refunds-engine — validateRefundAmount', () => {
  it('rejette montant invalide (≤0/NaN)', () => {
    const r1 = validateRefundAmount(10000, 0, 0);
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe(REFUND_ERROR_CODES.AMOUNT_INVALID);

    const r2 = validateRefundAmount(10000, 0, -500);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe(REFUND_ERROR_CODES.AMOUNT_INVALID);

    const r3 = validateRefundAmount(10000, 0, Number.NaN);
    expect(r3.ok).toBe(false);
    expect(r3.code).toBe(REFUND_ERROR_CODES.AMOUNT_INVALID);
  });

  it('rejette commande non payée', () => {
    const r = validateRefundAmount(0, 0, 100);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REFUND_ERROR_CODES.AMOUNT_OVER_PAID);
  });

  it('rejette déjà totalement remboursé', () => {
    const r = validateRefundAmount(10000, 10000, 100);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REFUND_ERROR_CODES.ALREADY_FULL_REFUND);
  });

  it('rejette over-refund (engaged + requested > paid)', () => {
    const r = validateRefundAmount(10000, 6000, 5000);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(REFUND_ERROR_CODES.AMOUNT_OVER_PAID);
  });

  it('accepte refund exact (full payment)', () => {
    const r = validateRefundAmount(10000, 0, 10000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('accepte refund partiel', () => {
    const r = validateRefundAmount(10000, 2000, 3000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(5000);
  });

  it('accepte refund qui clôture (engaged + requested == paid)', () => {
    const r = validateRefundAmount(10000, 7500, 2500);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('arrondit les fractions de cent', () => {
    const r = validateRefundAmount(10000.7, 2000.3, 3000.6);
    expect(r.ok).toBe(true);
  });
});

describe('refunds-engine — validateCurrencyMatch', () => {
  it('accepte match exact', () => {
    expect(validateCurrencyMatch('CAD', 'CAD')).toBe(true);
  });
  it('accepte case-insensitive + trim', () => {
    expect(validateCurrencyMatch('cad', 'CAD')).toBe(true);
    expect(validateCurrencyMatch('  USD ', 'usd')).toBe(true);
  });
  it('rejette mismatch', () => {
    expect(validateCurrencyMatch('CAD', 'USD')).toBe(false);
    expect(validateCurrencyMatch('EUR', 'CAD')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(validateCurrencyMatch(null, 'CAD')).toBe(false);
    expect(validateCurrencyMatch('CAD', 123)).toBe(false);
  });
});

describe('refunds-engine — idempotencyKey', () => {
  it('génère clé déterministe', () => {
    expect(idempotencyKey('ord_123', 0)).toBe('refund:ord_123:0');
    expect(idempotencyKey('ord_123', 5)).toBe('refund:ord_123:5');
  });
  it('round/clamp attemptN', () => {
    expect(idempotencyKey('ord_1', 2.7)).toBe('refund:ord_1:3');
    expect(idempotencyKey('ord_1', -5)).toBe('refund:ord_1:0');
    expect(idempotencyKey('ord_1', 'bogus')).toBe('refund:ord_1:0');
  });
  it('fallback _invalid sur orderId vide', () => {
    expect(idempotencyKey('', 1)).toBe('refund:_invalid:1');
    expect(idempotencyKey(null, 1)).toBe('refund:_invalid:1');
  });
});

describe('refunds-engine — idempotencyKeyWithAmount', () => {
  it('format `refund:<order>:<amount>:<seq>`', () => {
    expect(idempotencyKeyWithAmount('ord_1', 1500, 0)).toBe(
      'refund:ord_1:1500:0',
    );
    expect(idempotencyKeyWithAmount('ord_42', 9999, 3)).toBe(
      'refund:ord_42:9999:3',
    );
  });
  it('round + clamp', () => {
    expect(idempotencyKeyWithAmount('ord_1', 1500.7, 2)).toBe(
      'refund:ord_1:1501:2',
    );
    expect(idempotencyKeyWithAmount('ord_1', -100, 0)).toBe(
      'refund:ord_1:0:0',
    );
  });
});
