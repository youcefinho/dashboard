// ── ecommerce-analytics-engine.test.ts — Renforcement P2-3 (2026-05-26) ────
// Tests unitaires des helpers PURS ecommerce-analytics-engine.ts. 15+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_ERROR_CODES,
  VALID_PERIODS,
  VALID_DIMENSIONS,
  MAX_WINDOW_DAYS,
  computeAov,
  computeConversionRate,
  computeLtv,
  computeGrowthRate,
  validateAnalyticsQuery,
} from '../lib/ecommerce-analytics-engine';

describe('ANALYTICS constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(ANALYTICS_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_PERIODS)).toBe(true);
    expect(Object.isFrozen(VALID_DIMENSIONS)).toBe(true);
  });

  it('VALID_PERIODS contient day/week/month/quarter/year/custom', () => {
    expect(VALID_PERIODS).toContain('day');
    expect(VALID_PERIODS).toContain('week');
    expect(VALID_PERIODS).toContain('month');
    expect(VALID_PERIODS).toContain('quarter');
    expect(VALID_PERIODS).toContain('year');
    expect(VALID_PERIODS).toContain('custom');
  });

  it('VALID_DIMENSIONS inclut channel/currency/product/customer/segment', () => {
    expect(VALID_DIMENSIONS).toContain('channel');
    expect(VALID_DIMENSIONS).toContain('currency');
    expect(VALID_DIMENSIONS).toContain('product');
    expect(VALID_DIMENSIONS).toContain('customer');
    expect(VALID_DIMENSIONS).toContain('segment');
  });
});

describe('computeAov', () => {
  it('calcule AOV correct', () => {
    expect(computeAov(10000, 5)).toBe(2000); // 100$ / 5 = 20$
  });

  it('orderCount=0 ⇒ 0 (pas de division par zéro)', () => {
    expect(computeAov(10000, 0)).toBe(0);
  });

  it('orderCount négatif ⇒ 0', () => {
    expect(computeAov(10000, -1)).toBe(0);
  });

  it('revenue négatif clampé à 0', () => {
    expect(computeAov(-100, 5)).toBe(0);
  });

  it('valeurs NaN/Infinity ⇒ 0', () => {
    expect(computeAov(NaN, 5)).toBe(0);
    expect(computeAov(100, Infinity)).toBe(0);
  });

  it('arrondit à l\'entier (cents)', () => {
    expect(computeAov(1001, 3)).toBe(334); // 333.66 → 334
  });
});

describe('computeConversionRate', () => {
  it('calcule taux correct en %', () => {
    expect(computeConversionRate(5, 100)).toBe(5); // 5%
  });

  it('visitors=0 ⇒ 0', () => {
    expect(computeConversionRate(5, 0)).toBe(0);
  });

  it('arrondi 2 décimales', () => {
    expect(computeConversionRate(1, 3)).toBe(33.33);
  });

  it('cap à 100% (sur-conversion = invalide)', () => {
    expect(computeConversionRate(150, 100)).toBe(100);
  });

  it('orders négatif clampé à 0', () => {
    expect(computeConversionRate(-5, 100)).toBe(0);
  });

  it('valeurs non finies ⇒ 0', () => {
    expect(computeConversionRate(NaN, 100)).toBe(0);
    expect(computeConversionRate(5, NaN)).toBe(0);
  });
});

describe('computeLtv', () => {
  it('somme simple avec marge 100%', () => {
    expect(computeLtv([100, 200, 300], 100)).toBe(600);
  });

  it('marge 50% divise par 2', () => {
    expect(computeLtv([100, 200, 300], 50)).toBe(300);
  });

  it('marge par défaut = 100', () => {
    expect(computeLtv([100, 200])).toBe(300);
  });

  it('tableau vide ⇒ 0', () => {
    expect(computeLtv([], 100)).toBe(0);
  });

  it('non-array ⇒ 0', () => {
    expect(computeLtv(null as never, 100)).toBe(0);
  });

  it('valeurs négatives/non-finies filtrées', () => {
    expect(computeLtv([100, -50, NaN, 200] as number[], 100)).toBe(300);
  });

  it('marge > 100 clampée à 100', () => {
    expect(computeLtv([100], 200)).toBe(100);
  });

  it('marge négative clampée à 0', () => {
    expect(computeLtv([100], -10)).toBe(0);
  });
});

describe('computeGrowthRate', () => {
  it('croissance positive', () => {
    expect(computeGrowthRate(150, 100)).toBe(50);
  });

  it('décroissance', () => {
    expect(computeGrowthRate(80, 100)).toBe(-20);
  });

  it('previous=0 et current>0 ⇒ 100', () => {
    expect(computeGrowthRate(50, 0)).toBe(100);
  });

  it('previous=0 et current=0 ⇒ 0', () => {
    expect(computeGrowthRate(0, 0)).toBe(0);
  });

  it('valeurs NaN ⇒ 0', () => {
    expect(computeGrowthRate(NaN, 100)).toBe(0);
  });

  it('arrondi 2 décimales', () => {
    expect(computeGrowthRate(133, 100)).toBe(33);
    expect(computeGrowthRate(133.33, 100)).toBe(33.33);
  });
});

describe('validateAnalyticsQuery', () => {
  it('accepte query valide minimale', () => {
    expect(validateAnalyticsQuery({ period: 'month' }).ok).toBe(true);
  });

  it('rejette period invalide', () => {
    const r = validateAnalyticsQuery({ period: 'hourly' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.PERIOD_INVALID);
  });

  it('rejette dimension hors whitelist', () => {
    const r = validateAnalyticsQuery({ period: 'day', dimension: 'invalid' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.DIMENSION_INVALID);
  });

  it('accepte dimension valide', () => {
    const r = validateAnalyticsQuery({ period: 'day', dimension: 'channel' });
    expect(r.ok).toBe(true);
  });

  it('period=custom requiert from+to', () => {
    const r = validateAnalyticsQuery({ period: 'custom' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.DATE_RANGE_INVALID);
  });

  it('rejette from > to (inversion)', () => {
    const r = validateAnalyticsQuery({
      period: 'custom',
      from: '2026-05-01',
      to: '2026-01-01',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.DATE_RANGE_INVERTED);
  });

  it('rejette fenêtre > MAX_WINDOW_DAYS', () => {
    const r = validateAnalyticsQuery({
      period: 'custom',
      from: '2020-01-01',
      to: '2026-01-01',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.WINDOW_TOO_LARGE);
  });

  it('expose windowDays calculé', () => {
    const r = validateAnalyticsQuery({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(r.ok).toBe(true);
    expect(r.windowDays).toBe(30);
  });

  it('rejette query non-objet', () => {
    expect(validateAnalyticsQuery(null as never).ok).toBe(false);
    expect(validateAnalyticsQuery('month' as never).ok).toBe(false);
  });

  it('rejette dates malformées', () => {
    const r = validateAnalyticsQuery({
      period: 'day',
      from: 'pas-une-date',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ANALYTICS_ERROR_CODES.DATE_RANGE_INVALID);
  });

  it('MAX_WINDOW_DAYS = 730 (aligné handler analytics)', () => {
    expect(MAX_WINDOW_DAYS).toBe(730);
  });
});
