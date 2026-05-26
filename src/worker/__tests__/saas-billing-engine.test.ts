// ── saas-billing-engine.test.ts — Tests RENFORCEMENT P0-7 ─────────────────
//
// Couvre les helpers PURS SaaS billing :
//   - BILLING_ERROR_CODES sanity
//   - PLAN_LIMITS coverage (4 tiers × limits)
//   - computeProration (upgrade/downgrade/edge cases)
//   - getDunningSchedule (1d/3d/7d + finalAttempt)
//   - validatePlanTransition (upgrade immédiat / downgrade end-of-cycle)
//   - computeMrr / computeChurnRate
//   - generateMockEventId + isMockEventId
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  BILLING_ERROR_CODES,
  VALID_PLAN_TIERS,
  VALID_BILLING_PERIODS,
  PLAN_LIMITS,
  DUNNING_SCHEDULE_DAYS,
  DUNNING_MAX_ATTEMPTS,
  VALID_SUBSCRIPTION_STATUSES,
  isValidPlanTier,
  isValidBillingPeriod,
  getPlanLimits,
  getPlanPrice,
  isQuotaExceeded,
  computeProration,
  getDunningSchedule,
  validatePlanTransition,
  computeMrr,
  computeChurnRate,
  generateMockEventId,
  isMockEventId,
  isBillableStatus,
  isTerminalStatus,
} from '../lib/saas-billing-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes sanity
// ════════════════════════════════════════════════════════════════════════════

describe('BILLING_ERROR_CODES', () => {
  it('expose >= 10 codes normalisés', () => {
    expect(Object.keys(BILLING_ERROR_CODES).length).toBeGreaterThanOrEqual(10);
  });
  it('codes critiques attendus', () => {
    expect(BILLING_ERROR_CODES.PLAN_UNKNOWN).toBe('PLAN_UNKNOWN');
    expect(BILLING_ERROR_CODES.STRIPE_NOT_CONFIGURED).toBe('STRIPE_NOT_CONFIGURED');
    expect(BILLING_ERROR_CODES.WEBHOOK_REPLAY).toBe('WEBHOOK_REPLAY');
    expect(BILLING_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID).toBe('WEBHOOK_SIGNATURE_INVALID');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALID_PLAN_TIERS + isValidPlanTier
// ════════════════════════════════════════════════════════════════════════════

describe('VALID_PLAN_TIERS', () => {
  it('contient exactement free/starter/pro/unlimited', () => {
    expect(VALID_PLAN_TIERS).toEqual(['free', 'starter', 'pro', 'unlimited']);
  });
  it('isValidPlanTier accepte les tiers connus', () => {
    expect(isValidPlanTier('free')).toBe(true);
    expect(isValidPlanTier('starter')).toBe(true);
    expect(isValidPlanTier('pro')).toBe(true);
    expect(isValidPlanTier('unlimited')).toBe(true);
  });
  it('isValidPlanTier rejette les tiers inconnus', () => {
    expect(isValidPlanTier('enterprise')).toBe(false);
    expect(isValidPlanTier('')).toBe(false);
    expect(isValidPlanTier(null)).toBe(false);
    expect(isValidPlanTier(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PLAN_LIMITS — 4 tiers × limits
// ════════════════════════════════════════════════════════════════════════════

describe('PLAN_LIMITS', () => {
  it('expose les 4 tiers', () => {
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual(['free', 'pro', 'starter', 'unlimited']);
  });
  it('free : limits restrictifs', () => {
    expect(PLAN_LIMITS.free.clients).toBe(1);
    expect(PLAN_LIMITS.free.leads).toBe(100);
    expect(PLAN_LIMITS.free.monthlyCents).toBe(0);
  });
  it('starter : limits intermédiaires', () => {
    expect(PLAN_LIMITS.starter.clients).toBe(5);
    expect(PLAN_LIMITS.starter.monthlyCents).toBe(2900);
    expect(PLAN_LIMITS.starter.yearlyCents).toBe(29000);
  });
  it('pro : limits élargis', () => {
    expect(PLAN_LIMITS.pro.clients).toBe(25);
    expect(PLAN_LIMITS.pro.monthlyCents).toBe(9900);
  });
  it('unlimited : null partout (illimité) + cents 299$', () => {
    expect(PLAN_LIMITS.unlimited.clients).toBeNull();
    expect(PLAN_LIMITS.unlimited.leads).toBeNull();
    expect(PLAN_LIMITS.unlimited.users).toBeNull();
    expect(PLAN_LIMITS.unlimited.monthlyCents).toBe(29900);
  });
  it('yearly price ~10x monthly (économie 17%)', () => {
    expect(PLAN_LIMITS.starter.yearlyCents).toBeLessThanOrEqual(
      PLAN_LIMITS.starter.monthlyCents * 12,
    );
  });
  it('PLAN_LIMITS frozen (immuable)', () => {
    expect(Object.isFrozen(PLAN_LIMITS)).toBe(true);
    expect(Object.isFrozen(PLAN_LIMITS.free)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getPlanLimits / getPlanPrice
// ════════════════════════════════════════════════════════════════════════════

describe('getPlanLimits / getPlanPrice', () => {
  it('getPlanLimits renvoie les limits du tier', () => {
    expect(getPlanLimits('pro').clients).toBe(25);
  });
  it('getPlanLimits fallback free si tier inconnu', () => {
    expect(getPlanLimits('xxx').clients).toBe(1);
  });
  it('getPlanPrice yearly vs monthly', () => {
    expect(getPlanPrice('pro', 'monthly')).toBe(9900);
    expect(getPlanPrice('pro', 'yearly')).toBe(99000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isQuotaExceeded
// ════════════════════════════════════════════════════════════════════════════

describe('isQuotaExceeded', () => {
  it('null limit = illimité, jamais dépassé', () => {
    expect(isQuotaExceeded(99999, null)).toBe(false);
  });
  it('current <= limit ⇒ false', () => {
    expect(isQuotaExceeded(99, 100)).toBe(false);
    expect(isQuotaExceeded(100, 100)).toBe(false);
  });
  it('current > limit ⇒ true', () => {
    expect(isQuotaExceeded(101, 100)).toBe(true);
  });
  it('current négatif/NaN ⇒ false (safe)', () => {
    expect(isQuotaExceeded(-1, 100)).toBe(false);
    expect(isQuotaExceeded(NaN, 100)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeProration
// ════════════════════════════════════════════════════════════════════════════

describe('computeProration', () => {
  it('30 days remaining on 30-day cycle, $10→$20 → +1000c debit', () => {
    // credit_unused = 1000 * 1.0 = 1000
    // charge_new    = 2000 * 1.0 = 2000
    // proration     = 2000 - 1000 = 1000
    expect(computeProration(1000, 2000, 30, 30)).toBe(1000);
  });
  it('15 days remaining on 30-day cycle, upgrade $10→$20 → +500c', () => {
    expect(computeProration(1000, 2000, 15, 30)).toBe(500);
  });
  it('downgrade $20→$10 sur 30/30 → -1000c (credit)', () => {
    expect(computeProration(2000, 1000, 30, 30)).toBe(-1000);
  });
  it('same plan → 0', () => {
    expect(computeProration(1000, 1000, 30, 30)).toBe(0);
  });
  it('daysRemaining 0 → 0', () => {
    expect(computeProration(1000, 2000, 0, 30)).toBe(0);
  });
  it('totalDays 0 → 0 (no divide by zero)', () => {
    expect(computeProration(1000, 2000, 15, 0)).toBe(0);
  });
  it('daysRemaining > totalDays → cap à totalDays', () => {
    expect(computeProration(1000, 2000, 100, 30)).toBe(1000);
  });
  it('valeurs négatives normalisées à 0', () => {
    expect(computeProration(-500, 2000, 30, 30)).toBe(2000);
    expect(computeProration(1000, -500, 30, 30)).toBe(-1000);
  });
  it('NaN/Infinity → 0', () => {
    expect(computeProration(NaN, 2000, 30, 30)).toBe(2000);
    expect(computeProration(1000, 2000, Infinity, 30)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getDunningSchedule — exponential backoff 1d/3d/7d
// ════════════════════════════════════════════════════════════════════════════

describe('getDunningSchedule', () => {
  const NOW = new Date('2026-05-26T12:00:00Z');
  it('attempt 1 → +1d', () => {
    const r = getDunningSchedule(1, NOW);
    expect(r.daysUntilNext).toBe(1);
    expect(r.finalAttempt).toBe(false);
    expect(r.nextRetryAt).toBe('2026-05-27T12:00:00.000Z');
  });
  it('attempt 2 → +3d', () => {
    const r = getDunningSchedule(2, NOW);
    expect(r.daysUntilNext).toBe(3);
    expect(r.finalAttempt).toBe(false);
  });
  it('attempt 3 → +7d, finalAttempt=true', () => {
    const r = getDunningSchedule(3, NOW);
    expect(r.daysUntilNext).toBe(7);
    expect(r.finalAttempt).toBe(true);
  });
  it('attempt 4 → finalAttempt true, nextRetryAt null', () => {
    const r = getDunningSchedule(4, NOW);
    expect(r.finalAttempt).toBe(true);
    expect(r.nextRetryAt).toBeNull();
  });
  it('attempt invalid → finalAttempt true', () => {
    expect(getDunningSchedule(0).finalAttempt).toBe(true);
    expect(getDunningSchedule(-1).finalAttempt).toBe(true);
    expect(getDunningSchedule(NaN).finalAttempt).toBe(true);
  });
  it('DUNNING_MAX_ATTEMPTS = 3', () => {
    expect(DUNNING_MAX_ATTEMPTS).toBe(3);
    expect(DUNNING_SCHEDULE_DAYS).toEqual([1, 3, 7]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validatePlanTransition
// ════════════════════════════════════════════════════════════════════════════

describe('validatePlanTransition', () => {
  it('upgrade free → starter : OK immédiat', () => {
    const r = validatePlanTransition('free', 'starter');
    expect(r.ok).toBe(true);
    expect(r.immediate).toBe(true);
  });
  it('upgrade starter → pro : OK immédiat', () => {
    const r = validatePlanTransition('starter', 'pro');
    expect(r.ok).toBe(true);
    expect(r.immediate).toBe(true);
  });
  it('upgrade pro → unlimited : OK immédiat', () => {
    expect(validatePlanTransition('pro', 'unlimited').immediate).toBe(true);
  });
  it('downgrade pro → starter : OK end-of-cycle (immediate=false)', () => {
    const r = validatePlanTransition('pro', 'starter');
    expect(r.ok).toBe(true);
    expect(r.immediate).toBe(false);
  });
  it('downgrade unlimited → free : OK end-of-cycle', () => {
    const r = validatePlanTransition('unlimited', 'free');
    expect(r.ok).toBe(true);
    expect(r.immediate).toBe(false);
  });
  it('same plan → rejeté (no-op)', () => {
    expect(validatePlanTransition('pro', 'pro').ok).toBe(false);
  });
  it('plan source inconnu → rejeté', () => {
    expect(validatePlanTransition('xxx', 'pro').ok).toBe(false);
  });
  it('plan target inconnu → rejeté', () => {
    expect(validatePlanTransition('pro', 'enterprise').ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeMrr
// ════════════════════════════════════════════════════════════════════════════

describe('computeMrr', () => {
  it('aucune sub → 0', () => {
    expect(computeMrr([])).toBe(0);
  });
  it('monthly subs → somme monthlyCents', () => {
    const subs = [
      { planTier: 'starter', billingPeriod: 'monthly', status: 'active' },
      { planTier: 'pro', billingPeriod: 'monthly', status: 'active' },
    ];
    expect(computeMrr(subs)).toBe(2900 + 9900);
  });
  it('yearly sub → yearlyCents/12', () => {
    const subs = [{ planTier: 'pro', billingPeriod: 'yearly', status: 'active' }];
    // 99000 / 12 = 8250
    expect(computeMrr(subs)).toBe(8250);
  });
  it('canceled status ignoré', () => {
    const subs = [
      { planTier: 'pro', billingPeriod: 'monthly', status: 'canceled' },
      { planTier: 'pro', billingPeriod: 'monthly', status: 'active' },
    ];
    expect(computeMrr(subs)).toBe(9900);
  });
  it('trialing inclus dans MRR (calque Stripe)', () => {
    const subs = [{ planTier: 'starter', billingPeriod: 'monthly', status: 'trialing' }];
    expect(computeMrr(subs)).toBe(2900);
  });
  it('free tier ignoré (0 cents)', () => {
    const subs = [{ planTier: 'free', billingPeriod: 'monthly', status: 'active' }];
    expect(computeMrr(subs)).toBe(0);
  });
  it('plan inconnu ignoré', () => {
    const subs = [{ planTier: 'xxx', billingPeriod: 'monthly', status: 'active' }];
    expect(computeMrr(subs)).toBe(0);
  });
  it('input non-array → 0 (défensif)', () => {
    expect(computeMrr(null as never)).toBe(0);
    expect(computeMrr(undefined as never)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeChurnRate
// ════════════════════════════════════════════════════════════════════════════

describe('computeChurnRate', () => {
  it('5 cancelled / 95 active → 5%', () => {
    expect(computeChurnRate(5, 95)).toBe(5);
  });
  it('0/0 → 0 (pas de division par zéro)', () => {
    expect(computeChurnRate(0, 0)).toBe(0);
  });
  it('100% si tous cancelled', () => {
    expect(computeChurnRate(10, 0)).toBe(100);
  });
  it('arrondi 2 décimales', () => {
    expect(computeChurnRate(1, 99)).toBe(1);
    expect(computeChurnRate(1, 2)).toBeCloseTo(33.33, 2);
  });
  it('valeurs négatives normalisées', () => {
    expect(computeChurnRate(-5, 95)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Mock event ID
// ════════════════════════════════════════════════════════════════════════════

describe('mockEventId helpers', () => {
  it('generateMockEventId match pattern mock_evt_<32hex>', () => {
    const id = generateMockEventId();
    expect(id).toMatch(/^mock_evt_[a-f0-9]{32}$/);
  });
  it('isMockEventId true pour ID généré', () => {
    expect(isMockEventId(generateMockEventId())).toBe(true);
  });
  it('isMockEventId false pour evt_ Stripe réel', () => {
    expect(isMockEventId('evt_1234567890abcdef')).toBe(false);
  });
  it('isMockEventId false pour input non-string', () => {
    expect(isMockEventId(null)).toBe(false);
    expect(isMockEventId(42)).toBe(false);
  });
  it('IDs uniques (collision check basique)', () => {
    const a = generateMockEventId();
    const b = generateMockEventId();
    expect(a).not.toBe(b);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isBillableStatus / isTerminalStatus / VALID_SUBSCRIPTION_STATUSES
// ════════════════════════════════════════════════════════════════════════════

describe('subscription status helpers', () => {
  it('isBillableStatus accepte active+trialing', () => {
    expect(isBillableStatus('active')).toBe(true);
    expect(isBillableStatus('trialing')).toBe(true);
    expect(isBillableStatus('canceled')).toBe(false);
    expect(isBillableStatus('past_due')).toBe(false);
  });
  it('isTerminalStatus accepte canceled+incomplete_expired', () => {
    expect(isTerminalStatus('canceled')).toBe(true);
    expect(isTerminalStatus('incomplete_expired')).toBe(true);
    expect(isTerminalStatus('active')).toBe(false);
  });
  it('VALID_SUBSCRIPTION_STATUSES contient les 7 valeurs Stripe', () => {
    expect(VALID_SUBSCRIPTION_STATUSES).toHaveLength(7);
    expect(VALID_SUBSCRIPTION_STATUSES).toContain('past_due');
    expect(VALID_SUBSCRIPTION_STATUSES).toContain('paused');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALID_BILLING_PERIODS
// ════════════════════════════════════════════════════════════════════════════

describe('VALID_BILLING_PERIODS', () => {
  it('contient monthly + yearly', () => {
    expect(VALID_BILLING_PERIODS).toEqual(['monthly', 'yearly']);
  });
  it('isValidBillingPeriod accepte/rejette correctement', () => {
    expect(isValidBillingPeriod('monthly')).toBe(true);
    expect(isValidBillingPeriod('yearly')).toBe(true);
    expect(isValidBillingPeriod('weekly')).toBe(false);
    expect(isValidBillingPeriod(null)).toBe(false);
  });
});
