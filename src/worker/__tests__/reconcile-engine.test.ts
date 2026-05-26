// ── reconcile-engine.test.ts — Tests RENFORCEMENT reconcile-engine.ts ────────
//
// Couvre les helpers PURS de dédoublonnage : normalisation email/phone/name,
// distance Levenshtein, score fuzzy normalisé, détection duplicates en
// cascade (email exact → phone exact → fuzzy name), stratégie de merge.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  RECONCILE_ERROR_CODES,
  DEFAULT_FUZZY_THRESHOLD,
  STRONG_MATCH_SCORE,
  normalizeEmail,
  normalizePhone,
  normalizeName,
  levenshteinDistance,
  computeFuzzyScore,
  findDuplicates,
  mergeStrategy,
  type LeadLike,
  type MergeCandidate,
} from '../lib/reconcile-engine';

describe('reconcile-engine — constants', () => {
  it('default threshold is 0.85', () => {
    expect(DEFAULT_FUZZY_THRESHOLD).toBe(0.85);
  });

  it('strong match score is 1.0', () => {
    expect(STRONG_MATCH_SCORE).toBe(1.0);
  });

  it('exposes error codes', () => {
    expect(RECONCILE_ERROR_CODES.INVALID_INPUT).toBe('reconcile_invalid_input');
  });
});

describe('reconcile-engine — normalize helpers', () => {
  it('normalizeEmail: trim + lowercase', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('normalizeEmail: non-string returns empty', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(42)).toBe('');
  });

  it('normalizePhone: digits-only last 10', () => {
    expect(normalizePhone('+1 (514) 555-1234')).toBe('5145551234');
    expect(normalizePhone('514-555-1234')).toBe('5145551234');
  });

  it('normalizePhone: < 7 digits returns empty', () => {
    expect(normalizePhone('12')).toBe('');
    expect(normalizePhone('')).toBe('');
  });

  it('normalizePhone: 7-9 digits returns all digits', () => {
    expect(normalizePhone('1234567')).toBe('1234567');
  });

  it('normalizeName: lowercase + collapse spaces', () => {
    expect(normalizeName('  John   DOE  ')).toBe('john doe');
  });

  it('normalizeName: non-string empty', () => {
    expect(normalizeName(null)).toBe('');
  });
});

describe('reconcile-engine — levenshteinDistance', () => {
  it('returns 0 on equal strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length on empty input', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('single edit', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1); // substitution
    expect(levenshteinDistance('kitten', 'kittens')).toBe(1); // insertion
    expect(levenshteinDistance('kittens', 'kitten')).toBe(1); // suppression
  });

  it('classic kitten/sitting = 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('symmetric', () => {
    expect(levenshteinDistance('john', 'jane')).toBe(
      levenshteinDistance('jane', 'john'),
    );
  });
});

describe('reconcile-engine — computeFuzzyScore', () => {
  it('identical strings → 1.0', () => {
    expect(computeFuzzyScore('john doe', 'john doe')).toBe(1);
  });

  it('case insensitive', () => {
    expect(computeFuzzyScore('John Doe', 'JOHN DOE')).toBe(1);
  });

  it('completely different → low score', () => {
    expect(computeFuzzyScore('john', 'xyz')).toBeLessThan(0.5);
  });

  it('typo close → high score', () => {
    // single-char typo over 14 chars → ≈0.93
    expect(computeFuzzyScore('jonathan smith', 'jonathan smitt')).toBeGreaterThan(0.8);
  });

  it('empty input → 0', () => {
    expect(computeFuzzyScore('', 'abc')).toBe(0);
    expect(computeFuzzyScore('abc', '')).toBe(0);
  });

  it('non-string → 0', () => {
    expect(computeFuzzyScore(null, 'abc')).toBe(0);
    expect(computeFuzzyScore(42, 'abc')).toBe(0);
  });

  it('returns number in [0,1]', () => {
    const score = computeFuzzyScore('hello world', 'helo wrold');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('reconcile-engine — findDuplicates', () => {
  it('empty array returns []', () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it('single lead returns []', () => {
    expect(findDuplicates([{ id: '1', email: 'a@b.com' }])).toEqual([]);
  });

  it('detects email exact match', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'john@example.com' },
      { id: '2', email: 'JOHN@example.com' },
    ];
    const matches = findDuplicates(leads);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe('email');
    expect(matches[0]!.score).toBe(1);
  });

  it('detects phone exact match (last 10 digits)', () => {
    const leads: LeadLike[] = [
      { id: '1', phone: '+1 (514) 555-1234' },
      { id: '2', phone: '514-555-1234' },
    ];
    const matches = findDuplicates(leads);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe('phone');
  });

  it('detects fuzzy name match above threshold', () => {
    const leads: LeadLike[] = [
      { id: '1', name: 'Jonathan Smith' },
      { id: '2', name: 'Jonathan Smitt' }, // 1 char diff (14 chars → 1/14 ≈ 0.93)
    ];
    const matches = findDuplicates(leads, { threshold: 0.85 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe('name');
  });

  it('rejects fuzzy match below threshold', () => {
    const leads: LeadLike[] = [
      { id: '1', name: 'John' },
      { id: '2', name: 'Jane' },
    ];
    expect(findDuplicates(leads, { threshold: 0.9 })).toEqual([]);
  });

  it('email beats fuzzy name (cascade order)', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'a@b.com', name: 'John' },
      { id: '2', email: 'a@b.com', name: 'Jane' },
    ];
    const matches = findDuplicates(leads);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe('email');
  });

  it('no double-counting same pair', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'a@b.com', phone: '5145551234' },
      { id: '2', email: 'a@b.com', phone: '5145551234' },
    ];
    const matches = findDuplicates(leads);
    expect(matches).toHaveLength(1); // pas 2
  });

  it('requireName option = false allows fuzzy without name', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'a@b.com' },
      { id: '2', email: 'c@d.com' },
    ];
    // pas de match, mais ne crash pas avec requireName: false
    expect(findDuplicates(leads, { requireName: false })).toEqual([]);
  });

  it('out-of-range threshold returns []', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'a@b.com' },
      { id: '2', email: 'a@b.com' },
    ];
    expect(findDuplicates(leads, { threshold: 1.5 })).toEqual([]);
    expect(findDuplicates(leads, { threshold: -0.1 })).toEqual([]);
  });

  it('sorts matches by descending score', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'a@b.com' },                  // pair 1-2 score=1 email
      { id: '2', email: 'a@b.com' },
      { id: '3', name: 'Jonathan Smith' },            // pair 3-4 ≈0.93 name
      { id: '4', name: 'Jonathan Smitt' },
    ];
    const matches = findDuplicates(leads, { threshold: 0.85 });
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    }
  });

  it('handles 3+ leads (n² scan)', () => {
    const leads: LeadLike[] = [
      { id: '1', email: 'same@x.com' },
      { id: '2', email: 'same@x.com' },
      { id: '3', email: 'same@x.com' },
    ];
    const matches = findDuplicates(leads);
    // C(3,2) = 3 paires
    expect(matches).toHaveLength(3);
  });
});

describe('reconcile-engine — mergeStrategy', () => {
  const base: MergeCandidate = {
    id: 'a',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('verified beats unverified', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', is_verified: true },
        { ...base, id: 'b', is_verified: false },
      ),
    ).toBe('keep_a');
    expect(
      mergeStrategy(
        { ...base, id: 'a', is_verified: false },
        { ...base, id: 'b', is_verified: true },
      ),
    ).toBe('keep_b');
  });

  it("status 'won' beats other status", () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', status: 'won' },
        { ...base, id: 'b', status: 'qualified' },
      ),
    ).toBe('keep_a');
  });

  it('activity_count delta ≥ 3 wins', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', activity_count: 10 },
        { ...base, id: 'b', activity_count: 5 },
      ),
    ).toBe('keep_a');
  });

  it('activity_count delta < 3 → fall through to score/date', () => {
    const r = mergeStrategy(
      { ...base, id: 'a', activity_count: 6, updated_at: '2026-01-02T00:00:00Z' },
      { ...base, id: 'b', activity_count: 5, updated_at: '2026-01-01T00:00:00Z' },
    );
    expect(r).toBe('keep_a'); // updated_at fresher
  });

  it('lead score delta ≥ 10 wins', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', score: 80 },
        { ...base, id: 'b', score: 50 },
      ),
    ).toBe('keep_a');
  });

  it('updated_at fresher wins (last fallback)', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', updated_at: '2026-01-10T00:00:00Z' },
        { ...base, id: 'b', updated_at: '2026-01-01T00:00:00Z' },
      ),
    ).toBe('keep_a');
  });

  it('created_at fresher wins when updated_at equal', () => {
    expect(
      mergeStrategy(
        { id: 'a', updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-10T00:00:00Z' },
        { id: 'b', updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
      ),
    ).toBe('keep_a');
  });

  it('exact tie → manual', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a' },
        { ...base, id: 'b' },
      ),
    ).toBe('manual');
  });

  it('invalid inputs → manual', () => {
    expect(mergeStrategy(null as unknown as MergeCandidate, base)).toBe(
      'manual',
    );
    expect(mergeStrategy(base, undefined as unknown as MergeCandidate)).toBe(
      'manual',
    );
    expect(
      mergeStrategy({ id: '', ...base }, { ...base, id: 'b' }),
    ).toBe('manual');
    expect(
      mergeStrategy(
        { ...base, id: 'same' },
        { ...base, id: 'same' },
      ),
    ).toBe('manual');
  });

  it('verified > won (rule priority)', () => {
    expect(
      mergeStrategy(
        { ...base, id: 'a', is_verified: true, status: 'lost' },
        { ...base, id: 'b', is_verified: false, status: 'won' },
      ),
    ).toBe('keep_a');
  });
});
