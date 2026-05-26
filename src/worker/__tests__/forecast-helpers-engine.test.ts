// ── forecast-helpers-engine.test.ts — Renforcement P4 (2026-05-26) ────────
// Tests unitaires des helpers PURS forecast-helpers-engine. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  FORECAST_HELPERS_ERROR_CODES,
  VALID_SCENARIOS,
  VALID_GROUP_BY,
  SCENARIO_MULTIPLIERS,
  applyScenario,
  bucketDealByStage,
  computeMonthFromDate,
  validateForecastQuery,
} from '../lib/forecast-helpers-engine';

describe('FORECAST_HELPERS constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(FORECAST_HELPERS_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_SCENARIOS)).toBe(true);
    expect(Object.isFrozen(VALID_GROUP_BY)).toBe(true);
    expect(Object.isFrozen(SCENARIO_MULTIPLIERS)).toBe(true);
  });

  it('VALID_SCENARIOS = best|likely|worst', () => {
    expect(VALID_SCENARIOS).toContain('best');
    expect(VALID_SCENARIOS).toContain('likely');
    expect(VALID_SCENARIOS).toContain('worst');
    expect(VALID_SCENARIOS.length).toBe(3);
  });

  it('SCENARIO_MULTIPLIERS alignés forecast-engine (1.25/1.0/0.7)', () => {
    expect(SCENARIO_MULTIPLIERS.best).toBe(1.25);
    expect(SCENARIO_MULTIPLIERS.likely).toBe(1.0);
    expect(SCENARIO_MULTIPLIERS.worst).toBe(0.7);
  });
});

describe('applyScenario', () => {
  it('best = ×1.25', () => {
    expect(applyScenario(1000, 'best')).toBe(1250);
  });

  it('likely = ×1.0', () => {
    expect(applyScenario(1000, 'likely')).toBe(1000);
  });

  it('worst = ×0.7', () => {
    expect(applyScenario(1000, 'worst')).toBe(700);
  });

  it('multiplier custom borné [0..5]', () => {
    expect(applyScenario(1000, 'best', { best: 100 })).toBe(5000); // borné à 5
    expect(applyScenario(1000, 'worst', { worst: -10 })).toBe(0); // borné à 0
  });

  it('multiplier custom valide accepté', () => {
    expect(applyScenario(1000, 'likely', { likely: 1.1 })).toBeCloseTo(1100, 1);
  });

  it('total 0 → 0', () => {
    expect(applyScenario(0, 'best')).toBe(0);
  });

  it('total NaN → 0', () => {
    expect(applyScenario(NaN, 'best')).toBe(0);
  });

  it('scénario inconnu → 0', () => {
    expect(applyScenario(1000, 'crazy' as never)).toBe(0);
  });

  it('arrondi 2 décimales', () => {
    expect(applyScenario(33.333, 'best')).toBe(41.67);
  });
});

describe('bucketDealByStage', () => {
  it('proba haute → current', () => {
    expect(bucketDealByStage(80, 90)).toBe('current');
    expect(bucketDealByStage(75, 90)).toBe('current');
  });

  it('horizon court → current même si proba moyenne', () => {
    expect(bucketDealByStage(30, 20)).toBe('current');
  });

  it('proba moyenne + horizon moyen → next', () => {
    expect(bucketDealByStage(50, 45)).toBe('next');
    expect(bucketDealByStage(40, 50)).toBe('next');
  });

  it('proba basse + horizon long → later', () => {
    expect(bucketDealByStage(20, 120)).toBe('later');
  });

  it('label connu (qualified) → next', () => {
    // qualified = proba 60 → next (>=50 ou horizon<=60)
    expect(bucketDealByStage('qualified', 90)).toBe('next');
  });

  it('label "won" → current (proba 100)', () => {
    expect(bucketDealByStage('won', 999)).toBe('current');
  });

  it('label "lost" → later (proba 0)', () => {
    expect(bucketDealByStage('lost', 999)).toBe('later');
  });

  it('label inconnu → fallback proba 0', () => {
    expect(bucketDealByStage('mystery', 999)).toBe('later');
  });

  it('horizon négatif → current', () => {
    expect(bucketDealByStage(10, -5)).toBe('current');
  });
});

describe('computeMonthFromDate', () => {
  it('YYYY-MM-DD → YYYY-MM', () => {
    expect(computeMonthFromDate('2026-05-26')).toBe('2026-05');
  });

  it('ISO complet → YYYY-MM', () => {
    expect(computeMonthFromDate('2026-05-26T14:30:00Z')).toBe('2026-05');
  });

  it('SQLite format (espace) → YYYY-MM', () => {
    expect(computeMonthFromDate('2026-05-26 14:30:00')).toBe('2026-05');
  });

  it('YYYY-MM déjà valide → tel quel', () => {
    expect(computeMonthFromDate('2026-05')).toBe('2026-05');
  });

  it('null/undefined → ""', () => {
    expect(computeMonthFromDate(null)).toBe('');
    expect(computeMonthFromDate(undefined)).toBe('');
  });

  it('chaîne vide → ""', () => {
    expect(computeMonthFromDate('')).toBe('');
  });

  it('format invalide → ""', () => {
    expect(computeMonthFromDate('not-a-date')).toBe('');
  });

  it('non-string → ""', () => {
    expect(computeMonthFromDate(123 as never)).toBe('');
  });
});

describe('validateForecastQuery', () => {
  it('vide = OK', () => {
    expect(validateForecastQuery({}).ok).toBe(true);
  });

  it('period valide = OK', () => {
    expect(validateForecastQuery({ period: '2026-05' }).ok).toBe(true);
  });

  it('period format invalide', () => {
    const r = validateForecastQuery({ period: '2026/05' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FORECAST_HELPERS_ERROR_CODES.PERIOD_INVALID);
  });

  it('period mois > 12', () => {
    const r = validateForecastQuery({ period: '2026-13' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FORECAST_HELPERS_ERROR_CODES.PERIOD_INVALID);
  });

  it('period mois = 00', () => {
    const r = validateForecastQuery({ period: '2026-00' });
    expect(r.ok).toBe(false);
  });

  it('group_by valide = OK', () => {
    expect(validateForecastQuery({ group_by: 'rep' }).ok).toBe(true);
    expect(validateForecastQuery({ group_by: 'source' }).ok).toBe(true);
    expect(validateForecastQuery({ group_by: 'stage' }).ok).toBe(true);
  });

  it('group_by invalide', () => {
    const r = validateForecastQuery({ group_by: 'team' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FORECAST_HELPERS_ERROR_CODES.GROUP_BY_INVALID);
  });

  it('scenario valide = OK', () => {
    expect(validateForecastQuery({ scenario: 'best' }).ok).toBe(true);
  });

  it('scenario invalide', () => {
    const r = validateForecastQuery({ scenario: 'crazy' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FORECAST_HELPERS_ERROR_CODES.SCENARIO_INVALID);
  });

  it('pipeline_id valide', () => {
    expect(validateForecastQuery({ pipeline_id: 'pipe-123_main' }).ok).toBe(true);
  });

  it('pipeline_id invalide (caractères spéciaux)', () => {
    const r = validateForecastQuery({ pipeline_id: 'pipe; DROP TABLE' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FORECAST_HELPERS_ERROR_CODES.PIPELINE_ID_INVALID);
  });

  it('null/empty optionnels OK', () => {
    expect(
      validateForecastQuery({
        period: null,
        group_by: '',
        scenario: null,
        pipeline_id: '',
      }).ok,
    ).toBe(true);
  });
});
