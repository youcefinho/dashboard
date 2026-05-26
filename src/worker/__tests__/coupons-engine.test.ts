// ── Tests — Coupons Engine (Sprint P0-6, 2026-05-26) ─────────────────────────
//
// Tests PURS sur les helpers exportés par lib/coupons-engine.ts.
// Aucun réseau, aucun mock D1 — fonctions sans I/O.

import { describe, it, expect } from 'vitest';
import {
  validateCouponCode,
  validateCouponInput,
  isCouponActive,
  computeDiscount,
  canUseCoupon,
  COUPON_ERROR_CODES,
  MIN_CODE_LENGTH,
  MAX_CODE_LENGTH,
} from '../lib/coupons-engine';

describe('coupons-engine — validateCouponCode', () => {
  it('accepte un code alphanumeric upper simple ("BLACK20")', () => {
    expect(validateCouponCode('BLACK20')).toBe(true);
  });

  it('accepte des dashes non-consécutifs ("WELCOME-2026")', () => {
    expect(validateCouponCode('WELCOME-2026')).toBe(true);
  });

  it('rejette les minuscules ("abc")', () => {
    expect(validateCouponCode('abc')).toBe(false);
  });

  it('rejette les espaces ("BLACK 20")', () => {
    expect(validateCouponCode('BLACK 20')).toBe(false);
  });

  it('rejette un code trop court (< 4)', () => {
    expect(validateCouponCode('X')).toBe(false);
    expect(validateCouponCode('AB')).toBe(false);
  });

  it('rejette un code trop long (> 20)', () => {
    expect(validateCouponCode('A'.repeat(21))).toBe(false);
  });

  it('rejette les dashes en bord ("-BLACK-")', () => {
    expect(validateCouponCode('-BLACK')).toBe(false);
    expect(validateCouponCode('BLACK-')).toBe(false);
  });

  it('rejette les dashes consécutifs ("BLACK--20")', () => {
    expect(validateCouponCode('BLACK--20')).toBe(false);
  });

  it('rejette les non-strings', () => {
    expect(validateCouponCode(null)).toBe(false);
    expect(validateCouponCode(undefined)).toBe(false);
    expect(validateCouponCode(42)).toBe(false);
  });

  it('limites figées : MIN=4, MAX=20', () => {
    expect(MIN_CODE_LENGTH).toBe(4);
    expect(MAX_CODE_LENGTH).toBe(20);
  });
});

describe('coupons-engine — validateCouponInput', () => {
  it('accepte input minimal percent valide', () => {
    const r = validateCouponInput({ code: 'BLACK20', type: 'percent', value: 20 });
    expect(r.ok).toBe(true);
  });

  it('rejette code manquant', () => {
    const r = validateCouponInput({ type: 'percent', value: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COUPON_ERROR_CODES.CODE_REQUIRED);
    expect(r.field).toBe('code');
  });

  it('rejette type invalide', () => {
    const r = validateCouponInput({ code: 'BLACK20', type: 'bogus', value: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COUPON_ERROR_CODES.TYPE_INVALID);
  });

  it('rejette percent > 100', () => {
    const r = validateCouponInput({ code: 'BLACK20', type: 'percent', value: 150 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COUPON_ERROR_CODES.VALUE_OUT_OF_BOUNDS);
  });

  it('rejette percent = 0', () => {
    const r = validateCouponInput({ code: 'BLACK20', type: 'percent', value: 0 });
    expect(r.ok).toBe(false);
  });

  it('rejette fixed négatif', () => {
    const r = validateCouponInput({ code: 'BLACK20', type: 'fixed', value: -100 });
    expect(r.ok).toBe(false);
  });

  it('rejette starts_at >= expires_at', () => {
    const r = validateCouponInput({
      code: 'BLACK20',
      type: 'percent',
      value: 20,
      starts_at: '2026-12-01',
      expires_at: '2026-11-01',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COUPON_ERROR_CODES.DATE_RANGE_INVALID);
  });

  it('rejette usage_limit négatif', () => {
    const r = validateCouponInput({
      code: 'BLACK20',
      type: 'percent',
      value: 20,
      usage_limit: -5,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(COUPON_ERROR_CODES.USAGE_LIMIT_INVALID);
  });

  it('accepte bogo sans value', () => {
    const r = validateCouponInput({ code: 'BOGO50', type: 'bogo' });
    expect(r.ok).toBe(true);
  });
});

describe('coupons-engine — isCouponActive', () => {
  it('coupon actif avec dates ouvertes → true', () => {
    const r = isCouponActive({ code: 'X', is_active: 1 }, new Date('2026-05-26'));
    expect(r.active).toBe(true);
  });

  it('is_active=0 → inactive', () => {
    const r = isCouponActive({ code: 'X', is_active: 0 }, new Date('2026-05-26'));
    expect(r.active).toBe(false);
    expect(r.reason).toBe(COUPON_ERROR_CODES.COUPON_INACTIVE);
  });

  it('avant starts_at → not_started', () => {
    const r = isCouponActive(
      { code: 'X', starts_at: '2026-12-01' },
      new Date('2026-05-26'),
    );
    expect(r.active).toBe(false);
    expect(r.reason).toBe(COUPON_ERROR_CODES.COUPON_NOT_STARTED);
  });

  it('après expires_at → expired', () => {
    const r = isCouponActive(
      { code: 'X', expires_at: '2026-01-01' },
      new Date('2026-05-26'),
    );
    expect(r.active).toBe(false);
    expect(r.reason).toBe(COUPON_ERROR_CODES.COUPON_EXPIRED);
  });

  it('usage_limit atteint → reached', () => {
    const r = isCouponActive({ code: 'X', usage_limit: 5, times_used: 5 });
    expect(r.active).toBe(false);
    expect(r.reason).toBe(COUPON_ERROR_CODES.COUPON_USAGE_REACHED);
  });
});

describe('coupons-engine — computeDiscount', () => {
  it('20% sur 100$ → 20$', () => {
    const r = computeDiscount({ code: 'X', type: 'percent', value: 20 }, 10000);
    expect(r.discount).toBe(2000);
    expect(r.final).toBe(8000);
  });

  it('fixed 3000 sur 2500 → cap à 2500 (final = 0)', () => {
    const r = computeDiscount({ code: 'X', type: 'fixed', value: 3000 }, 2500);
    expect(r.discount).toBe(2500);
    expect(r.final).toBe(0);
  });

  it('percent > 100 cappé à 100', () => {
    const r = computeDiscount({ code: 'X', type: 'percent', value: 150 }, 10000);
    expect(r.discount).toBe(10000);
    expect(r.final).toBe(0);
  });

  it('total 0 → discount 0', () => {
    const r = computeDiscount({ code: 'X', type: 'percent', value: 20 }, 0);
    expect(r.discount).toBe(0);
    expect(r.final).toBe(0);
  });

  it('legacy : discount_percent (sans type)', () => {
    const r = computeDiscount({ code: 'X', discount_percent: 10 }, 1000);
    expect(r.discount).toBe(100);
    expect(r.final).toBe(900);
  });

  it('bogo → discount 0 ici (résolu en amont par item)', () => {
    const r = computeDiscount({ code: 'X', type: 'bogo' }, 5000);
    expect(r.discount).toBe(0);
    expect(r.final).toBe(5000);
  });
});

describe('coupons-engine — canUseCoupon', () => {
  it('pas de per_customer_limit → ok', () => {
    const r = canUseCoupon({ code: 'X' }, 99);
    expect(r.ok).toBe(true);
  });

  it('per_customer_limit non atteint → ok', () => {
    const r = canUseCoupon({ code: 'X', per_customer_limit: 3 }, 1);
    expect(r.ok).toBe(true);
  });

  it('per_customer_limit atteint exactement → refusé', () => {
    const r = canUseCoupon({ code: 'X', per_customer_limit: 3 }, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(COUPON_ERROR_CODES.COUPON_PER_CUSTOMER_REACHED);
  });

  it('per_customer_limit dépassé → refusé', () => {
    const r = canUseCoupon({ code: 'X', per_customer_limit: 2 }, 5);
    expect(r.ok).toBe(false);
  });

  it('per_customer_limit = 0 → désactivé (ok)', () => {
    const r = canUseCoupon({ code: 'X', per_customer_limit: 0 }, 10);
    expect(r.ok).toBe(true);
  });
});
