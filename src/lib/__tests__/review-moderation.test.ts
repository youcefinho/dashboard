// ── review-moderation.test.ts — Sprint 40 (Agent C1) ─────────────────────
//
// Couvre src/worker/lib/review-moderation.ts : computeSpamScore,
// containsBadWords, autoApproveDecision. Fonctions pures — pas de mock D1.
//
// `checkVerifiedBuyer` est DB-touching (env.DB.prepare) → testé séparément
// si besoin avec un mock Env complet. Hors scope ici.
//
// ⚠ vitest.config.ts inclut le glob `src/lib/__tests__/**` (Phase B Sprint 25).

import { describe, it, expect } from 'vitest';
import {
  computeSpamScore,
  containsBadWords,
  autoApproveDecision,
} from '../../worker/lib/review-moderation';

describe('computeSpamScore', () => {
  it('body normal court → score < 30 (pas spam)', () => {
    const result = computeSpamScore('Très bon produit, merci!', 'fr-CA');
    expect(result.score).toBeLessThan(30);
  });

  it('body avec 5 URLs → score ≥ 30, reasons inclut "links"', () => {
    const result = computeSpamScore(
      'Check http://a.com http://b.com http://c.com http://d.com http://e.com',
      'en',
    );
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reasons).toContain('links');
  });

  it('all caps long → score ≥ 15, reasons inclut "all_caps" ou "caps_ratio"', () => {
    const result = computeSpamScore(
      'THIS IS A VERY LONG ALL CAPS MESSAGE THAT IS SHOUTING AT YOU',
      'en',
    );
    expect(result.score).toBeGreaterThanOrEqual(15);
    const triggered =
      result.reasons.includes('all_caps') ||
      result.reasons.includes('caps_ratio');
    expect(triggered).toBe(true);
  });
});

describe('containsBadWords', () => {
  it('texte neutre FR → false', () => {
    expect(containsBadWords('Très bon produit, merci!', 'fr-CA')).toBe(false);
  });

  it('texte avec bad word FR ("merde") → true', () => {
    expect(containsBadWords('Ce produit est de la merde', 'fr-CA')).toBe(true);
  });
});

describe('autoApproveDecision', () => {
  it('verified + rating 5 + spam 10 → "approved" (fast-track)', () => {
    expect(autoApproveDecision(5, true, 10)).toBe('approved');
  });

  it('rating 1 → "flagged" (low-rating systematic moderation)', () => {
    expect(autoApproveDecision(1, true, 10)).toBe('flagged');
  });

  it('rating 3 + unverified + spam 30 → "pending" (default)', () => {
    expect(autoApproveDecision(3, false, 30)).toBe('pending');
  });
});
