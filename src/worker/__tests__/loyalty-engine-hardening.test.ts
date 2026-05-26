// ── Loyalty engine hardening tests — Sprint 38 (2026-05-26) ──────────────────
//
// Tests PURS sur les helpers additifs introduits par le hardening Sprint 38 :
//   - TIER_THRESHOLDS_CENTS / POINTS_EXPIRY_DAYS / TIER_EARN_RATE
//   - computeTier()
//   - computePointsEarned()
//   - computeRedemptionDiscount()
//   - isPointsExpired()
//   - validateRedemption()
//   - LOYALTY_ERROR_CODES
//
// Aucun réseau, aucun mock D1 (helpers PURS).

import { describe, it, expect } from 'vitest';
import {
  TIER_THRESHOLDS_CENTS,
  POINTS_EXPIRY_DAYS,
  TIER_EARN_RATE,
  LOYALTY_ERROR_CODES,
  computeTier,
  computePointsEarned,
  computeRedemptionDiscount,
  isPointsExpired,
  validateRedemption,
} from '../lib/loyalty-engine';

describe('loyalty-engine hardening — constants', () => {
  // ── 1. TIER_THRESHOLDS_CENTS ──────────────────────────────────────────────
  it('TIER_THRESHOLDS_CENTS expose 4 tiers ordonnés croissant', () => {
    expect(TIER_THRESHOLDS_CENTS.bronze).toBe(0);
    expect(TIER_THRESHOLDS_CENTS.silver).toBe(50_000);
    expect(TIER_THRESHOLDS_CENTS.gold).toBe(200_000);
    expect(TIER_THRESHOLDS_CENTS.platinum).toBe(1_000_000);
  });

  // ── 2. POINTS_EXPIRY_DAYS ─────────────────────────────────────────────────
  it('POINTS_EXPIRY_DAYS = 365', () => {
    expect(POINTS_EXPIRY_DAYS).toBe(365);
  });

  // ── 3. TIER_EARN_RATE ─────────────────────────────────────────────────────
  it('TIER_EARN_RATE croissant bronze→platinum', () => {
    expect(TIER_EARN_RATE.bronze).toBe(1);
    expect(TIER_EARN_RATE.silver).toBe(1.5);
    expect(TIER_EARN_RATE.gold).toBe(2);
    expect(TIER_EARN_RATE.platinum).toBe(3);
  });

  // ── 4. LOYALTY_ERROR_CODES ───────────────────────────────────────────────
  it('LOYALTY_ERROR_CODES expose les 7 codes stables', () => {
    expect(LOYALTY_ERROR_CODES.INVALID_INPUT).toBe('invalid_input');
    expect(LOYALTY_ERROR_CODES.INSUFFICIENT_POINTS).toBe('insufficient_points');
    expect(LOYALTY_ERROR_CODES.CUSTOMER_MISMATCH).toBe('customer_mismatch');
    expect(LOYALTY_ERROR_CODES.REDEMPTION_BELOW_MIN).toBe('redemption_below_min');
    expect(LOYALTY_ERROR_CODES.REDEMPTION_OVER_MAX).toBe('redemption_over_max');
    expect(LOYALTY_ERROR_CODES.POINTS_EXPIRED).toBe('points_expired');
    expect(LOYALTY_ERROR_CODES.PROGRAM_INACTIVE).toBe('program_inactive');
  });
});

describe('loyalty-engine hardening — computeTier', () => {
  // ── 5. computeTier bronze (0$) ────────────────────────────────────────────
  it('computeTier(0) → bronze', () => {
    expect(computeTier(0)).toBe('bronze');
    expect(computeTier(49_999)).toBe('bronze');
  });

  // ── 6. computeTier silver (500$) ──────────────────────────────────────────
  it('computeTier(50_000) → silver (boundary)', () => {
    expect(computeTier(50_000)).toBe('silver');
    expect(computeTier(199_999)).toBe('silver');
  });

  // ── 7. computeTier gold (2000$) ───────────────────────────────────────────
  it('computeTier(200_000) → gold (boundary)', () => {
    expect(computeTier(200_000)).toBe('gold');
    expect(computeTier(999_999)).toBe('gold');
  });

  // ── 8. computeTier platinum (10_000$) ────────────────────────────────────
  it('computeTier(1_000_000) → platinum', () => {
    expect(computeTier(1_000_000)).toBe('platinum');
    expect(computeTier(99_999_999)).toBe('platinum');
  });

  // ── 9. computeTier invalid → bronze fallback ─────────────────────────────
  it('computeTier(-100 / NaN) → bronze', () => {
    expect(computeTier(-100)).toBe('bronze');
    expect(computeTier(Number.NaN)).toBe('bronze');
  });
});

describe('loyalty-engine hardening — computePointsEarned', () => {
  // ── 10. computePointsEarned bronze (1pt/$) ───────────────────────────────
  it('100$ × bronze (1pt/$) → 100 points', () => {
    expect(computePointsEarned(10_000, 'bronze')).toBe(100);
  });

  // ── 11. computePointsEarned silver (1.5pt/$) ─────────────────────────────
  it('100$ × silver (1.5pt/$) → 150 points', () => {
    expect(computePointsEarned(10_000, 'silver')).toBe(150);
  });

  // ── 12. computePointsEarned gold (2pt/$) ─────────────────────────────────
  it('100$ × gold (2pt/$) → 200 points', () => {
    expect(computePointsEarned(10_000, 'gold')).toBe(200);
  });

  // ── 13. computePointsEarned tier inconnu → bronze fallback ───────────────
  it('100$ × tier inconnu → fallback bronze (1pt/$)', () => {
    expect(computePointsEarned(10_000, 'unknown' as never)).toBe(100);
  });
});

describe('loyalty-engine hardening — computeRedemptionDiscount', () => {
  // ── 14. computeRedemptionDiscount default (20pts = 100c) ─────────────────
  it('100 points / 20 → 500 cents (= 5$)', () => {
    expect(computeRedemptionDiscount(100)).toBe(500);
  });

  // ── 15. computeRedemptionDiscount custom rate (10pts = 100c) ─────────────
  it('100 points / 10 → 1000 cents (= 10$)', () => {
    expect(computeRedemptionDiscount(100, 10)).toBe(1000);
  });

  // ── 16. computeRedemptionDiscount invalid → 0 ────────────────────────────
  it('points <= 0 ou rate <= 0 → 0', () => {
    expect(computeRedemptionDiscount(0)).toBe(0);
    expect(computeRedemptionDiscount(-10)).toBe(0);
    expect(computeRedemptionDiscount(100, 0)).toBe(0);
    expect(computeRedemptionDiscount(100, -5)).toBe(0);
  });
});

describe('loyalty-engine hardening — isPointsExpired', () => {
  // ── 17. isPointsExpired récent (< 365j) ──────────────────────────────────
  it('earnedAt il y a 100j → false', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    const earned = new Date(now.getTime() - 100 * 86_400_000).toISOString();
    expect(isPointsExpired(earned, now)).toBe(false);
  });

  // ── 18. isPointsExpired exactement 365j → true ───────────────────────────
  it('earnedAt il y a exactement 365j → true (>=)', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    const earned = new Date(now.getTime() - 365 * 86_400_000).toISOString();
    expect(isPointsExpired(earned, now)).toBe(true);
  });

  // ── 19. isPointsExpired très ancien (> 365j) → true ──────────────────────
  it('earnedAt il y a 500j → true', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    const earned = new Date(now.getTime() - 500 * 86_400_000).toISOString();
    expect(isPointsExpired(earned, now)).toBe(true);
  });
});

describe('loyalty-engine hardening — validateRedemption', () => {
  // ── 20. validateRedemption succès classique ──────────────────────────────
  it('500 pts demandés sur balance 1000 → ok', () => {
    const r = validateRedemption({
      customerId: 'cust_1',
      points: 500,
      balance: 1000,
    });
    expect(r.ok).toBe(true);
  });

  // ── 21. validateRedemption insufficient ──────────────────────────────────
  it('1500 pts demandés sur balance 1000 → insufficient_points', () => {
    const r = validateRedemption({
      customerId: 'cust_1',
      points: 1500,
      balance: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(LOYALTY_ERROR_CODES.INSUFFICIENT_POINTS);
    }
  });

  // ── 22. validateRedemption below min ─────────────────────────────────────
  it('50 pts < minRedeem 100 → redemption_below_min', () => {
    const r = validateRedemption({
      customerId: 'cust_1',
      points: 50,
      balance: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(LOYALTY_ERROR_CODES.REDEMPTION_BELOW_MIN);
    }
  });

  // ── 23. validateRedemption over max ──────────────────────────────────────
  it('2000 pts > maxPerOrder 1000 → redemption_over_max', () => {
    const r = validateRedemption({
      customerId: 'cust_1',
      points: 2000,
      balance: 5000,
      maxPerOrder: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(LOYALTY_ERROR_CODES.REDEMPTION_OVER_MAX);
    }
  });

  // ── 24. validateRedemption customer mismatch (anti-fraud) ────────────────
  it('customerId != ledgerCustomerId → customer_mismatch', () => {
    const r = validateRedemption({
      customerId: 'cust_1',
      ledgerCustomerId: 'cust_2',
      points: 500,
      balance: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(LOYALTY_ERROR_CODES.CUSTOMER_MISMATCH);
    }
  });
});
