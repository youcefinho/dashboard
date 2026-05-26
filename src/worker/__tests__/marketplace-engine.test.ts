// ── marketplace-engine.test.ts — Tests RENFORCEMENT marketplace-engine.ts ──

import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_ERROR_CODES,
  VALID_LISTING_TYPES,
  VALID_LISTING_STATUSES,
  VALID_SORT_OPTIONS,
  MARKETPLACE_TITLE_MAX,
  MARKETPLACE_DESC_MAX,
  MARKETPLACE_CATEGORY_MAX,
  MARKETPLACE_QUERY_MAX,
  isValidListingType,
  isValidListingStatus,
  isValidSort,
  isValidRating,
  validateListingInput,
  validateSearchFilters,
  computeListingScore,
  validateReviewInput,
} from '../lib/marketplace-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes & frozen constants
// ════════════════════════════════════════════════════════════════════════════

describe('MARKETPLACE_ERROR_CODES', () => {
  it('expose >= 8 codes', () => {
    expect(Object.keys(MARKETPLACE_ERROR_CODES).length).toBeGreaterThanOrEqual(8);
  });
  it('codes critiques présents', () => {
    expect(MARKETPLACE_ERROR_CODES.INVALID_LISTING_TYPE).toBe('INVALID_LISTING_TYPE');
    expect(MARKETPLACE_ERROR_CODES.INVALID_RATING).toBe('INVALID_RATING');
    expect(MARKETPLACE_ERROR_CODES.INVALID_PRICE_RANGE).toBe('INVALID_PRICE_RANGE');
  });
});

describe('VALID_LISTING_TYPES (frozen)', () => {
  it('contient funnel/workflow/sequence', () => {
    expect(VALID_LISTING_TYPES).toContain('funnel');
    expect(VALID_LISTING_TYPES).toContain('workflow');
    expect(VALID_LISTING_TYPES).toContain('sequence');
    expect(VALID_LISTING_TYPES.length).toBe(3);
  });
  it('est frozen', () => {
    expect(Object.isFrozen(VALID_LISTING_TYPES)).toBe(true);
  });
});

describe('VALID_LISTING_STATUSES / VALID_SORT_OPTIONS', () => {
  it('statuses inclut draft/published/archived', () => {
    expect(VALID_LISTING_STATUSES).toContain('draft');
    expect(VALID_LISTING_STATUSES).toContain('published');
  });
  it('sort inclut popular/recent/rating', () => {
    expect(VALID_SORT_OPTIONS).toContain('popular');
    expect(VALID_SORT_OPTIONS).toContain('recent');
    expect(VALID_SORT_OPTIONS).toContain('rating');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isValid* helpers
// ════════════════════════════════════════════════════════════════════════════

describe('isValidListingType / isValidListingStatus / isValidSort', () => {
  it('isValidListingType: funnel ok, plugin ko', () => {
    expect(isValidListingType('funnel')).toBe(true);
    expect(isValidListingType('plugin')).toBe(false);
    expect(isValidListingType(null)).toBe(false);
  });
  it('isValidListingStatus: draft ok, foo ko', () => {
    expect(isValidListingStatus('draft')).toBe(true);
    expect(isValidListingStatus('foo')).toBe(false);
  });
  it('isValidSort: popular ok, custom ko', () => {
    expect(isValidSort('popular')).toBe(true);
    expect(isValidSort('custom')).toBe(false);
  });
});

describe('isValidRating', () => {
  it('1..5 ok', () => {
    for (let r = 1; r <= 5; r++) expect(isValidRating(r)).toBe(true);
  });
  it('0 / 6 / -1 / NaN ko', () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
    expect(isValidRating('abc')).toBe(false);
  });
  it('round arrondit 3.6 → 4 (ok)', () => {
    expect(isValidRating(3.6)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateListingInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateListingInput', () => {
  it('accepte input minimal valide', () => {
    expect(
      validateListingInput({ kind: 'funnel', source_id: 'fun_123' }).ok,
    ).toBe(true);
  });
  it('rejette null input', () => {
    expect(validateListingInput(null).ok).toBe(false);
  });
  it('rejette kind invalide', () => {
    const r = validateListingInput({ kind: 'plugin', source_id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(MARKETPLACE_ERROR_CODES.INVALID_LISTING_TYPE);
  });
  it('rejette source_id manquant', () => {
    const r = validateListingInput({ kind: 'funnel', source_id: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('source_id');
  });
  it('rejette title trop long', () => {
    const r = validateListingInput({
      kind: 'funnel',
      source_id: 'x',
      title: 'a'.repeat(MARKETPLACE_TITLE_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(MARKETPLACE_ERROR_CODES.TITLE_TOO_LONG);
  });
  it('rejette description trop longue', () => {
    const r = validateListingInput({
      kind: 'workflow',
      source_id: 'x',
      description: 'd'.repeat(MARKETPLACE_DESC_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(MARKETPLACE_ERROR_CODES.DESCRIPTION_TOO_LONG);
  });
  it('rejette category trop longue', () => {
    const r = validateListingInput({
      kind: 'funnel',
      source_id: 'x',
      category: 'c'.repeat(MARKETPLACE_CATEGORY_MAX + 1),
    });
    expect(r.ok).toBe(false);
  });
  it('rejette status invalide', () => {
    const r = validateListingInput({
      kind: 'funnel',
      source_id: 'x',
      status: 'limbo',
    });
    expect(r.ok).toBe(false);
  });
  it('accepte status draft', () => {
    expect(
      validateListingInput({ kind: 'funnel', source_id: 'x', status: 'draft' })
        .ok,
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateSearchFilters
// ════════════════════════════════════════════════════════════════════════════

describe('validateSearchFilters', () => {
  it('accepte filters vides → defaults', () => {
    const r = validateSearchFilters({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.sort).toBe('popular');
      expect(r.normalized.q).toBe(null);
    }
  });
  it('accepte q court', () => {
    const r = validateSearchFilters({ q: 'lead' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.q).toBe('lead');
  });
  it('tronque q > MARKETPLACE_QUERY_MAX', () => {
    const r = validateSearchFilters({ q: 'a'.repeat(MARKETPLACE_QUERY_MAX + 50) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.q!.length).toBe(MARKETPLACE_QUERY_MAX);
  });
  it('accepte type=funnel', () => {
    const r = validateSearchFilters({ type: 'funnel' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.type).toBe('funnel');
  });
  it('alias kind = type', () => {
    const r = validateSearchFilters({ kind: 'workflow' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.type).toBe('workflow');
  });
  it('rejette type invalide', () => {
    expect(validateSearchFilters({ type: 'plugin' }).ok).toBe(false);
  });
  it('rejette sort invalide', () => {
    expect(validateSearchFilters({ sort: 'custom' }).ok).toBe(false);
  });
  it('accepte price range valide', () => {
    const r = validateSearchFilters({ min_price: 10, max_price: 100 });
    expect(r.ok).toBe(true);
  });
  it('rejette min > max', () => {
    const r = validateSearchFilters({ min_price: 100, max_price: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(MARKETPLACE_ERROR_CODES.INVALID_PRICE_RANGE);
  });
  it('rejette min_price négatif', () => {
    expect(validateSearchFilters({ min_price: -5 }).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeListingScore
// ════════════════════════════════════════════════════════════════════════════

describe('computeListingScore', () => {
  it('listing null → 0', () => {
    expect(computeListingScore(null)).toBe(0);
  });
  it('install_count seul', () => {
    expect(computeListingScore({ install_count: 10 }, Date.now())).toBeGreaterThanOrEqual(10);
  });
  it('rating boost (avg * count * 5)', () => {
    const s = computeListingScore(
      { install_count: 0, rating_avg: 4.5, rating_count: 10, created_at: null },
      Date.now(),
    );
    // 4.5 * 10 * 5 = 225
    expect(s).toBe(225);
  });
  it('recency boost pour items < 30 jours', () => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    const s = computeListingScore(
      { install_count: 0, rating_avg: 0, rating_count: 0, created_at: yesterday },
      now,
    );
    expect(s).toBeGreaterThan(0);
  });
  it('no recency pour items > 30 jours', () => {
    const now = Date.now();
    const old = now - 60 * 24 * 60 * 60 * 1000;
    const s = computeListingScore(
      { install_count: 0, rating_avg: 0, rating_count: 0, created_at: old },
      now,
    );
    expect(s).toBe(0);
  });
  it('items récents (recent) > items anciens (same metrics)', () => {
    const now = Date.now();
    const recent = computeListingScore(
      { install_count: 10, rating_avg: 4, rating_count: 5, created_at: now - 1000 },
      now,
    );
    const old = computeListingScore(
      {
        install_count: 10,
        rating_avg: 4,
        rating_count: 5,
        created_at: now - 90 * 24 * 60 * 60 * 1000,
      },
      now,
    );
    expect(recent).toBeGreaterThan(old);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateReviewInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateReviewInput', () => {
  it('accepte rating 1..5', () => {
    for (let r = 1; r <= 5; r++) {
      const v = validateReviewInput({ rating: r });
      expect(v.ok).toBe(true);
    }
  });
  it('rejette rating 0 / 6 / NaN', () => {
    expect(validateReviewInput({ rating: 0 }).ok).toBe(false);
    expect(validateReviewInput({ rating: 6 }).ok).toBe(false);
    expect(validateReviewInput({ rating: 'abc' }).ok).toBe(false);
  });
  it('tronque comment > 2000', () => {
    const v = validateReviewInput({
      rating: 4,
      comment: 'c'.repeat(3000),
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.comment.length).toBe(2000);
  });
  it('rejette comment non-string', () => {
    expect(validateReviewInput({ rating: 4, comment: 42 }).ok).toBe(false);
  });
  it('accepte comment absent', () => {
    expect(validateReviewInput({ rating: 4 }).ok).toBe(true);
  });
  it('accepte input null → rating manquant ko', () => {
    expect(validateReviewInput(null).ok).toBe(false);
  });
});
