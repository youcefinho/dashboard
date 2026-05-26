// ── admin-analytics-engine.test.ts — Renforcement P4 (2026-05-26) ──────────
// Tests unitaires des helpers purs admin-analytics-engine.ts. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  ADMIN_ANALYTICS_ERROR_CODES,
  VALID_METRICS,
  VALID_PERIODS,
  VALID_PERIOD_KEYS,
  validateMetricRequest,
  aggregateByPeriod,
  formatChurnRate,
  formatGrowthRate,
} from '../lib/admin-analytics-engine';

describe('ADMIN_ANALYTICS constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(ADMIN_ANALYTICS_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_METRICS)).toBe(true);
    expect(Object.isFrozen(VALID_PERIODS)).toBe(true);
    expect(Object.isFrozen(VALID_PERIOD_KEYS)).toBe(true);
  });

  it('VALID_METRICS contient mrr/arr/churn/active_clients/signups/trial_conversions', () => {
    expect(VALID_METRICS).toContain('mrr');
    expect(VALID_METRICS).toContain('arr');
    expect(VALID_METRICS).toContain('churn');
    expect(VALID_METRICS).toContain('active_clients');
    expect(VALID_METRICS).toContain('signups');
    expect(VALID_METRICS).toContain('trial_conversions');
  });

  it('VALID_PERIODS contient day/week/month/quarter/year', () => {
    expect(VALID_PERIODS).toContain('day');
    expect(VALID_PERIODS).toContain('week');
    expect(VALID_PERIODS).toContain('month');
    expect(VALID_PERIODS).toContain('quarter');
    expect(VALID_PERIODS).toContain('year');
  });
});

describe('validateMetricRequest', () => {
  it('accepte requête minimale valide', () => {
    expect(validateMetricRequest({ metric: 'mrr', period: 'month' }).ok).toBe(true);
  });

  it('rejette métrique non whitelistée', () => {
    const r = validateMetricRequest({ metric: 'ltv', period: 'month' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ADMIN_ANALYTICS_ERROR_CODES.METRIC_INVALID);
  });

  it('rejette period invalide', () => {
    const r = validateMetricRequest({ metric: 'mrr', period: 'hourly' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ADMIN_ANALYTICS_ERROR_CODES.PERIOD_INVALID);
  });

  it('accepte from/to valides', () => {
    const r = validateMetricRequest({
      metric: 'signups',
      period: 'day',
      from: '2026-01-01',
      to: '2026-05-01',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette from > to (inversion)', () => {
    const r = validateMetricRequest({
      metric: 'signups',
      period: 'day',
      from: '2026-05-01',
      to: '2026-01-01',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ADMIN_ANALYTICS_ERROR_CODES.DATE_RANGE_INVERTED);
  });

  it('rejette dates invalides', () => {
    const r = validateMetricRequest({
      metric: 'signups',
      period: 'day',
      from: 'pas-une-date',
    });
    expect(r.ok).toBe(false);
  });

  it('rejette requête non-objet', () => {
    expect(validateMetricRequest(null as never).ok).toBe(false);
    expect(validateMetricRequest('mrr' as never).ok).toBe(false);
  });

  it('rejette metric absent', () => {
    expect(validateMetricRequest({ period: 'month' } as never).ok).toBe(false);
  });
});

describe('aggregateByPeriod', () => {
  const rows = [
    { created_at: '2026-05-01T10:00:00Z', user_id: 'a' },
    { created_at: '2026-05-01T15:00:00Z', user_id: 'b' },
    { created_at: '2026-05-02T08:00:00Z', user_id: 'c' },
    { created_at: '2026-06-03T08:00:00Z', user_id: 'd' },
  ];

  it('agrège par jour', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'day');
    expect(r.ok).toBe(true);
    expect(r.periods).toHaveLength(3);
    expect(r.periods![0]!.label).toBe('2026-05-01');
    expect(r.periods![0]!.count).toBe(2);
  });

  it('agrège par mois', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'month');
    expect(r.ok).toBe(true);
    expect(r.periods).toHaveLength(2);
    expect(r.periods![0]!.label).toBe('2026-05');
    expect(r.periods![0]!.count).toBe(3);
    expect(r.periods![1]!.label).toBe('2026-06');
  });

  it('agrège par année', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'year');
    expect(r.ok).toBe(true);
    expect(r.periods).toHaveLength(1);
    expect(r.periods![0]!.label).toBe('2026');
    expect(r.periods![0]!.count).toBe(4);
  });

  it('agrège par trimestre', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'quarter');
    expect(r.ok).toBe(true);
    expect(r.periods![0]!.label).toMatch(/2026-Q[12]/);
  });

  it('agrège par semaine (ISO)', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'week');
    expect(r.ok).toBe(true);
    expect(r.periods!.length).toBeGreaterThan(0);
    expect(r.periods![0]!.label).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('ignore rows sans timestamp', () => {
    const mixed = [...rows, { created_at: null }, { created_at: 'invalid' }];
    const r = aggregateByPeriod(mixed, 'created_at', 'day');
    expect(r.ok).toBe(true);
    expect(r.periods).toHaveLength(3);
  });

  it('rejette periodKey non whitelistée', () => {
    const r = aggregateByPeriod(rows, 'evil_col' as never, 'day');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ADMIN_ANALYTICS_ERROR_CODES.PERIOD_KEY_INVALID);
  });

  it('rejette period invalide', () => {
    const r = aggregateByPeriod(rows, 'created_at', 'hourly' as never);
    expect(r.ok).toBe(false);
  });

  it('rejette rows non-array', () => {
    const r = aggregateByPeriod(null as never, 'created_at', 'day');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ADMIN_ANALYTICS_ERROR_CODES.ROWS_NOT_ARRAY);
  });

  it('rows vides ⇒ periods vides', () => {
    const r = aggregateByPeriod([], 'created_at', 'day');
    expect(r.ok).toBe(true);
    expect(r.periods).toEqual([]);
  });
});

describe('formatChurnRate', () => {
  it('calcule % avec 2 décimales', () => {
    expect(formatChurnRate(5, 100)).toBe(5);
    expect(formatChurnRate(1, 3)).toBe(33.33);
    expect(formatChurnRate(7, 11)).toBeCloseTo(63.64, 1);
  });

  it('total = 0 ⇒ 0 (honnête)', () => {
    expect(formatChurnRate(5, 0)).toBe(0);
  });

  it('total négatif ⇒ 0', () => {
    expect(formatChurnRate(5, -10)).toBe(0);
  });

  it('churned négatif ⇒ 0', () => {
    expect(formatChurnRate(-5, 100)).toBe(0);
  });

  it('valeurs non-numériques ⇒ 0', () => {
    expect(formatChurnRate('a', 100)).toBe(0);
    expect(formatChurnRate(5, NaN)).toBe(0);
  });

  it('cap à 100% (data corrompue)', () => {
    expect(formatChurnRate(200, 100)).toBe(100);
  });
});

describe('formatGrowthRate', () => {
  it('croissance positive', () => {
    expect(formatGrowthRate(120, 100)).toBe(20);
  });

  it('décroissance', () => {
    expect(formatGrowthRate(80, 100)).toBe(-20);
  });

  it('previous = 0 + current > 0 ⇒ 100%', () => {
    expect(formatGrowthRate(50, 0)).toBe(100);
  });

  it('both 0 ⇒ 0%', () => {
    expect(formatGrowthRate(0, 0)).toBe(0);
  });

  it('valeurs non-numériques ⇒ 0', () => {
    expect(formatGrowthRate('a', 100)).toBe(0);
  });
});
