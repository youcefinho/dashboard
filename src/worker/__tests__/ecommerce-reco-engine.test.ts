// ── ecommerce-reco-engine.test.ts — Renforcement P2-3 (2026-05-26) ─────────
// Tests unitaires des helpers PURS ecommerce-reco-engine.ts. 15+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  RECO_ERROR_CODES,
  VALID_ALGORITHMS,
  RECO_LIMIT_MAX,
  computePopularityScore,
  findCrossSellCandidates,
  rankRecommendations,
  validateRecoQuery,
} from '../lib/ecommerce-reco-engine';

describe('RECO constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(RECO_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_ALGORITHMS)).toBe(true);
  });

  it('VALID_ALGORITHMS contient popularity/collaborative/cross_sell/recently_viewed/bestsellers', () => {
    expect(VALID_ALGORITHMS).toContain('popularity');
    expect(VALID_ALGORITHMS).toContain('collaborative');
    expect(VALID_ALGORITHMS).toContain('cross_sell');
    expect(VALID_ALGORITHMS).toContain('recently_viewed');
    expect(VALID_ALGORITHMS).toContain('bestsellers');
  });
});

describe('computePopularityScore', () => {
  it('purchases pèsent plus que addToCart > views', () => {
    const s1 = computePopularityScore(100, 0, 0); // views seuls
    const s2 = computePopularityScore(0, 100, 0); // addToCart seuls
    const s3 = computePopularityScore(0, 0, 100); // purchases seuls
    expect(s3).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s1);
  });

  it('score combiné = somme pondérée', () => {
    expect(computePopularityScore(100, 100, 100)).toBe(100); // 100×(0.1+0.3+0.6)
  });

  it('valeurs négatives ⇒ 0', () => {
    expect(computePopularityScore(-10, -20, -30)).toBe(0);
  });

  it('valeurs non finies filtrées', () => {
    expect(computePopularityScore(NaN, 100, 100)).toBe(100 * 0.3 + 100 * 0.6);
  });

  it('arrondi 2 décimales', () => {
    expect(computePopularityScore(7, 3, 1)).toBe(0.7 + 0.9 + 0.6);
  });
});

describe('findCrossSellCandidates', () => {
  const orders = new Map<string, string[]>([
    ['o1', ['A', 'B', 'C']],
    ['o2', ['A', 'B']],
    ['o3', ['A', 'D']],
    ['o4', ['B', 'C']],
  ]);

  it('trouve co-occurrence A → B,C,D', () => {
    const r = findCrossSellCandidates(orders, 'A', 1);
    expect(r).toContain('B'); // 2 fois avec A
    expect(r).toContain('C'); // 1 fois avec A
    expect(r).toContain('D'); // 1 fois avec A
    expect(r[0]).toBe('B'); // top
  });

  it('threshold=2 filtre seuls les co-occurrences ≥ 2', () => {
    const r = findCrossSellCandidates(orders, 'A', 2);
    expect(r).toEqual(['B']);
  });

  it('produit absent ⇒ []', () => {
    expect(findCrossSellCandidates(orders, 'Z', 1)).toEqual([]);
  });

  it('targetProductId vide ⇒ []', () => {
    expect(findCrossSellCandidates(orders, '', 1)).toEqual([]);
  });

  it('accepte format Array<[orderId, items]>', () => {
    const r = findCrossSellCandidates(
      [
        ['o1', ['A', 'B']],
        ['o2', ['A', 'C']],
      ],
      'A',
      1,
    );
    expect(r).toContain('B');
    expect(r).toContain('C');
  });

  it('Map vide ⇒ []', () => {
    expect(findCrossSellCandidates(new Map(), 'A', 1)).toEqual([]);
  });

  it('exclut le targetProductId lui-même', () => {
    const r = findCrossSellCandidates(orders, 'A', 1);
    expect(r).not.toContain('A');
  });

  it('input invalide ⇒ []', () => {
    expect(findCrossSellCandidates(null as never, 'A', 1)).toEqual([]);
  });
});

describe('rankRecommendations', () => {
  const products = [
    { id: 'p1', score: 10 },
    { id: 'p2', score: 50 },
    { id: 'p3', score: 30 },
    { id: 'p4', score: 5 },
  ];

  it('tri DESC par score', () => {
    const r = rankRecommendations(products, (p) => p.score, 10);
    expect(r.map((p) => p.id)).toEqual(['p2', 'p3', 'p1', 'p4']);
  });

  it('respecte limit', () => {
    const r = rankRecommendations(products, (p) => p.score, 2);
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('p2');
  });

  it('limit > RECO_LIMIT_MAX cappé', () => {
    const bigList = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, score: i }));
    const r = rankRecommendations(bigList, (p) => p.score, 999);
    expect(r.length).toBe(RECO_LIMIT_MAX);
  });

  it('liste vide ⇒ []', () => {
    expect(rankRecommendations([], (p: { score: number }) => p.score, 5)).toEqual([]);
  });

  it('tri stable si scores égaux', () => {
    const items = [
      { id: 'a', s: 5 },
      { id: 'b', s: 5 },
      { id: 'c', s: 5 },
    ];
    const r = rankRecommendations(items, (p) => p.s, 10);
    expect(r.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('scoreFn qui throw ⇒ score=0 défensif', () => {
    const r = rankRecommendations(
      [{ id: 'a' }, { id: 'b' }],
      () => {
        throw new Error('boom');
      },
      10,
    );
    expect(r.length).toBe(2);
  });

  it('input non-array ⇒ []', () => {
    expect(rankRecommendations(null as never, (p: { score: number }) => p.score, 5)).toEqual([]);
  });
});

describe('validateRecoQuery', () => {
  it('accepte popularity sans productId', () => {
    expect(validateRecoQuery({ algorithm: 'popularity' }).ok).toBe(true);
  });

  it('cross_sell requiert productId', () => {
    const r = validateRecoQuery({ algorithm: 'cross_sell' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RECO_ERROR_CODES.PRODUCT_ID_INVALID);
  });

  it('cross_sell + productId OK', () => {
    expect(validateRecoQuery({ algorithm: 'cross_sell', productId: 'p1' }).ok).toBe(true);
  });

  it('rejette algorithm invalide', () => {
    const r = validateRecoQuery({ algorithm: 'random' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RECO_ERROR_CODES.ALGORITHM_INVALID);
  });

  it('rejette limit > RECO_LIMIT_MAX', () => {
    const r = validateRecoQuery({ algorithm: 'popularity', limit: 999 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RECO_ERROR_CODES.LIMIT_INVALID);
  });

  it('rejette limit < 1', () => {
    const r = validateRecoQuery({ algorithm: 'popularity', limit: 0 });
    expect(r.ok).toBe(false);
  });

  it('rejette threshold < 1', () => {
    const r = validateRecoQuery({ algorithm: 'cross_sell', productId: 'p1', threshold: 0 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(RECO_ERROR_CODES.THRESHOLD_INVALID);
  });

  it('rejette query non-objet', () => {
    expect(validateRecoQuery(null as never).ok).toBe(false);
  });
});
