// ── conversion-helpers-engine.test.ts — Renforcement P3 (2026-05-26) ──────
// Tests unitaires des helpers PURS conversion-helpers-engine. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  CONVERSION_HELPERS_ERROR_CODES,
  VALID_DIMENSIONS,
  FACTOR_LABEL_WHITELIST,
  CONFIDENCE_THRESHOLDS,
  clampScore,
  computeWeightedScore,
  confidenceFromSampleSize,
  estimateSampleFromFactors,
  validateBaselineInput,
  validateFactors,
} from '../lib/conversion-helpers-engine';

describe('CONVERSION_HELPERS constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(CONVERSION_HELPERS_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_DIMENSIONS)).toBe(true);
    expect(Object.isFrozen(FACTOR_LABEL_WHITELIST)).toBe(true);
    expect(Object.isFrozen(CONFIDENCE_THRESHOLDS)).toBe(true);
  });

  it('VALID_DIMENSIONS contient les 4 dimensions canoniques', () => {
    expect(VALID_DIMENSIONS).toContain('source');
    expect(VALID_DIMENSIONS).toContain('status');
    expect(VALID_DIMENSIONS).toContain('score_bucket');
    expect(VALID_DIMENSIONS).toContain('overall');
  });
});

describe('clampScore', () => {
  it('clampé 0..100', () => {
    expect(clampScore(50)).toBe(50);
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(120)).toBe(100);
  });

  it('arrondi entier', () => {
    expect(clampScore(50.7)).toBe(51);
    expect(clampScore(50.4)).toBe(50);
  });

  it('NaN → 0', () => {
    expect(clampScore(NaN)).toBe(0);
  });

  it('Infinity → 0 (safe)', () => {
    expect(clampScore(Infinity)).toBe(0);
    expect(clampScore(-Infinity)).toBe(0);
  });

  it('0 → 0', () => {
    expect(clampScore(0)).toBe(0);
  });

  it('100 → 100', () => {
    expect(clampScore(100)).toBe(100);
  });
});

describe('computeWeightedScore', () => {
  it('somme directe sans weight', () => {
    const r = computeWeightedScore([
      { label: 'a', impact: 30 },
      { label: 'b', impact: 20 },
    ]);
    expect(r).toBe(50);
  });

  it('weight appliqué', () => {
    const r = computeWeightedScore([
      { label: 'a', impact: 50, weight: 0.5 },
      { label: 'b', impact: 50, weight: 0.5 },
    ]);
    expect(r).toBe(50);
  });

  it('clampé 0..100', () => {
    const r = computeWeightedScore([
      { label: 'a', impact: 200 },
    ]);
    expect(r).toBe(100);
  });

  it('négatif clampé à 0', () => {
    const r = computeWeightedScore([
      { label: 'a', impact: -50 },
    ]);
    expect(r).toBe(0);
  });

  it('tableau vide → 0', () => {
    expect(computeWeightedScore([])).toBe(0);
  });

  it('factor invalide ignoré', () => {
    const r = computeWeightedScore([
      { label: 'ok', impact: 30 },
      { label: 'bad', impact: NaN },
      null as never,
    ]);
    expect(r).toBe(30);
  });
});

describe('confidenceFromSampleSize', () => {
  it('<50 = low', () => {
    expect(confidenceFromSampleSize(0)).toBe('low');
    expect(confidenceFromSampleSize(10)).toBe('low');
    expect(confidenceFromSampleSize(49)).toBe('low');
  });

  it('50-500 = medium', () => {
    expect(confidenceFromSampleSize(50)).toBe('medium');
    expect(confidenceFromSampleSize(200)).toBe('medium');
    expect(confidenceFromSampleSize(499)).toBe('medium');
  });

  it('>500 = high', () => {
    expect(confidenceFromSampleSize(500)).toBe('high');
    expect(confidenceFromSampleSize(10000)).toBe('high');
  });

  it('négatif → low', () => {
    expect(confidenceFromSampleSize(-5)).toBe('low');
  });

  it('NaN → low', () => {
    expect(confidenceFromSampleSize(NaN)).toBe('low');
  });
});

describe('estimateSampleFromFactors', () => {
  it('extrait n=120', () => {
    const n = estimateSampleFromFactors([
      { label: 'Taux historique de tes leads referral : 32% (n=120)', impact: 5 },
    ]);
    expect(n).toBe(120);
  });

  it('aucun match → 0', () => {
    const n = estimateSampleFromFactors([
      { label: 'Activité récente', impact: 10 },
      { label: 'Engagement', impact: 5 },
    ]);
    expect(n).toBe(0);
  });

  it('factors vide → 0', () => {
    expect(estimateSampleFromFactors([])).toBe(0);
  });

  it('null/undefined → 0', () => {
    expect(estimateSampleFromFactors(null)).toBe(0);
    expect(estimateSampleFromFactors(undefined)).toBe(0);
  });

  it('premier match remporte', () => {
    const n = estimateSampleFromFactors([
      { label: 'X (n=50)', impact: 0 },
      { label: 'Y (n=200)', impact: 0 },
    ]);
    expect(n).toBe(50);
  });
});

describe('validateBaselineInput', () => {
  it('accepte input valide', () => {
    const r = validateBaselineInput({
      dimension: 'source',
      dimension_value: 'referral',
      conversion_rate: 0.32,
      sample_size: 120,
    });
    expect(r.ok).toBe(true);
  });

  it('rejette dimension inconnue', () => {
    const r = validateBaselineInput({
      dimension: 'unknown',
      conversion_rate: 0.5,
      sample_size: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CONVERSION_HELPERS_ERROR_CODES.DIMENSION_INVALID);
  });

  it('rejette conversion_rate > 1', () => {
    const r = validateBaselineInput({
      dimension: 'source',
      conversion_rate: 1.5,
      sample_size: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CONVERSION_HELPERS_ERROR_CODES.CONVERSION_RATE_INVALID);
  });

  it('rejette conversion_rate négatif', () => {
    const r = validateBaselineInput({
      dimension: 'source',
      conversion_rate: -0.1,
      sample_size: 10,
    });
    expect(r.ok).toBe(false);
  });

  it('rejette sample_size négatif', () => {
    const r = validateBaselineInput({
      dimension: 'source',
      conversion_rate: 0.5,
      sample_size: -1,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CONVERSION_HELPERS_ERROR_CODES.SAMPLE_SIZE_INVALID);
  });

  it('accepte sample_size = 0 (baseline vide)', () => {
    const r = validateBaselineInput({
      dimension: 'overall',
      conversion_rate: 0,
      sample_size: 0,
    });
    expect(r.ok).toBe(true);
  });

  it('rejette null', () => {
    expect(validateBaselineInput(null as never).ok).toBe(false);
  });
});

describe('validateFactors', () => {
  it('accepte factors valides', () => {
    expect(
      validateFactors([
        { label: 'a', impact: 10 },
        { label: 'b', impact: -5 },
      ]).ok,
    ).toBe(true);
  });

  it('rejette non-tableau', () => {
    expect(validateFactors('not-array').ok).toBe(false);
    expect(validateFactors({}).ok).toBe(false);
  });

  it('rejette label vide', () => {
    const r = validateFactors([{ label: '', impact: 10 }]);
    expect(r.ok).toBe(false);
  });

  it('rejette impact NaN', () => {
    const r = validateFactors([{ label: 'x', impact: NaN }]);
    expect(r.ok).toBe(false);
  });

  it('tableau vide = OK', () => {
    expect(validateFactors([]).ok).toBe(true);
  });
});
