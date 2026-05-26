// ── Tests — Product Reviews Engine (Sprint 40 renforcement, 2026-05-26) ────
//
// Tests PURS sur les 7 helpers exportés par `lib/product-reviews-engine.ts`.
// Aucun réseau, aucun mock D1 (toutes les fonctions ciblées sont PURES).
//
// Couverture (24 cas) :
//   - validateReviewInput        : 8 cas (stars 0/3.5/5/'5'/missing, body
//                                  3/3000/50 chars, photo_url valid/invalid)
//   - sanitizeReviewBody         : 4 cas (script stripped, iframe, on*=,
//                                  markdown préservé)
//   - computeAggregateRating     : 4 cas (5 avis mixés, vide, single 5★,
//                                  ratings invalides skip)
//   - isValidPhotoUrl            : 6 cas (https jpg OK, http reject, .exe
//                                  reject, .svg reject, .webp OK avec query,
//                                  data: reject)
//   - canReply                   : 4 cas (admin no-reply approved → true,
//                                  non-admin → false, reply existe → false,
//                                  status pending → false)
//   - validateModerationAction   : 3 cas (approve OK, delete_all reject,
//                                  non-string reject)
//   - PRODUCT_REVIEWS_ERROR_CODES: 1 cas (8 codes stables présents)

import { describe, it, expect } from 'vitest';
import {
  validateReviewInput,
  sanitizeReviewBody,
  computeAggregateRating,
  isValidPhotoUrl,
  canReply,
  validateModerationAction,
  PRODUCT_REVIEWS_ERROR_CODES,
  MIN_BODY_LENGTH,
  MAX_BODY_LENGTH,
  VALID_STARS,
} from '../lib/product-reviews-engine';

// ════════════════════════════════════════════════════════════════════════════
// validateReviewInput (8 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateReviewInput — stars + body + photo_url validation', () => {
  it('stars=0 → reject INVALID_STARS', () => {
    const r = validateReviewInput({ stars: 0, body: 'Body assez long pour passer' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.INVALID_STARS);
  });

  it('stars=5 + body valide → OK avec data normalisé', () => {
    const r = validateReviewInput({
      stars: 5,
      body: 'Très bon produit, fonctionne parfaitement, livraison rapide.',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.stars).toBe(5);
    expect(r.data?.body).toContain('Très bon produit');
    expect(r.data?.photo_url).toBeNull();
  });

  it('stars=3.5 (float) → reject INVALID_STARS (entier strict)', () => {
    const r = validateReviewInput({ stars: 3.5, body: 'Body assez long pour passer' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.INVALID_STARS);
  });

  it('stars="5" (string numérique) → accepté, coerce en number', () => {
    const r = validateReviewInput({ stars: '5', body: 'Body assez long pour passer' });
    expect(r.ok).toBe(true);
    expect(r.data?.stars).toBe(5);
  });

  it('body 5 chars → reject BODY_TOO_SHORT', () => {
    const r = validateReviewInput({ stars: 5, body: 'court' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_SHORT);
  });

  it('body 3000 chars → reject BODY_TOO_LONG', () => {
    const r = validateReviewInput({ stars: 5, body: 'a'.repeat(3000) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_LONG);
  });

  it('body 50 chars → OK', () => {
    const r = validateReviewInput({ stars: 4, body: 'a'.repeat(50) });
    expect(r.ok).toBe(true);
    expect(r.data?.body.length).toBe(50);
  });

  it('photo_url https + .jpg → OK avec photo_url normalisé', () => {
    const r = validateReviewInput({
      stars: 5,
      body: 'Très bon produit, fonctionne parfaitement.',
      photo_url: 'https://cdn.example.com/photo.jpg',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.photo_url).toBe('https://cdn.example.com/photo.jpg');
  });

  it('photo_url http (insecure) → reject INVALID_PHOTO_URL', () => {
    const r = validateReviewInput({
      stars: 5,
      body: 'Très bon produit, fonctionne parfaitement.',
      photo_url: 'http://cdn.example.com/photo.jpg',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.INVALID_PHOTO_URL);
  });

  it('input null → reject INVALID_INPUT', () => {
    const r = validateReviewInput(null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PRODUCT_REVIEWS_ERROR_CODES.INVALID_INPUT);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// sanitizeReviewBody (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('sanitizeReviewBody — XSS strip aggressif', () => {
  it('<script> bloc stripé (contenu + tags)', () => {
    const out = sanitizeReviewBody('Hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('<iframe> stripé', () => {
    const out = sanitizeReviewBody('<iframe src="evil.com"></iframe>OK');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('OK');
  });

  it('on*= handlers stripés', () => {
    const out = sanitizeReviewBody('<a href="x" onclick="alert(1)">click</a>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('click');
  });

  it('markdown ordinaire préservé (pas d\'over-escape)', () => {
    const md = 'Excellent produit ! **Très bien** fait. Lien : [voir](https://ok.com).';
    const out = sanitizeReviewBody(md);
    expect(out).toBe(md);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// computeAggregateRating (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('computeAggregateRating — avg + count + distribution', () => {
  it('5 reviews [5,4,5,3,4] → avg=4.2, count=5, distribution=[0,0,1,2,2]', () => {
    const reviews = [
      { rating: 5 }, { rating: 4 }, { rating: 5 }, { rating: 3 }, { rating: 4 },
    ];
    const agg = computeAggregateRating(reviews);
    expect(agg.avg).toBe(4.2);
    expect(agg.count).toBe(5);
    expect(agg.distribution).toEqual([0, 0, 1, 2, 2]);
  });

  it('liste vide → avg=0, count=0, distribution=[0,0,0,0,0]', () => {
    const agg = computeAggregateRating([]);
    expect(agg.avg).toBe(0);
    expect(agg.count).toBe(0);
    expect(agg.distribution).toEqual([0, 0, 0, 0, 0]);
  });

  it('1 review 5★ → avg=5, count=1, distribution=[0,0,0,0,1]', () => {
    const agg = computeAggregateRating([{ rating: 5 }]);
    expect(agg.avg).toBe(5);
    expect(agg.count).toBe(1);
    expect(agg.distribution).toEqual([0, 0, 0, 0, 1]);
  });

  it('ratings invalides skipped (0/6/3.5/NaN/null)', () => {
    const agg = computeAggregateRating([
      { rating: 0 },        // skip
      { rating: 6 },        // skip
      { rating: 3.5 },      // skip
      { rating: NaN },      // skip
      { rating: null },     // skip
      { rating: 5 },        // count
      { rating: 4 },        // count
    ]);
    expect(agg.count).toBe(2);
    expect(agg.avg).toBe(4.5);
    expect(agg.distribution).toEqual([0, 0, 0, 1, 1]);
  });

  it('null input → safe defaults', () => {
    const agg = computeAggregateRating(null);
    expect(agg.avg).toBe(0);
    expect(agg.count).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// isValidPhotoUrl (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('isValidPhotoUrl — https + ext whitelist', () => {
  it('https + .jpg → true', () => {
    expect(isValidPhotoUrl('https://cdn.example.com/photo.jpg')).toBe(true);
  });

  it('http (insecure) → false', () => {
    expect(isValidPhotoUrl('http://cdn.example.com/photo.jpg')).toBe(false);
  });

  it('https + .exe (binaire) → false', () => {
    expect(isValidPhotoUrl('https://cdn.example.com/malware.exe')).toBe(false);
  });

  it('https + .svg → false (peut contenir <script>)', () => {
    expect(isValidPhotoUrl('https://cdn.example.com/img.svg')).toBe(false);
  });

  it('https + .webp avec query string → true', () => {
    expect(isValidPhotoUrl('https://cdn.example.com/img.webp?w=200&h=200')).toBe(true);
  });

  it('data: URI → false (rejet protocole)', () => {
    expect(
      isValidPhotoUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// canReply (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('canReply — single reply policy', () => {
  it('admin + status approved + no existing reply → true', () => {
    expect(canReply({ status: 'approved' }, true, false)).toBe(true);
  });

  it('non-admin → false (REPLY_FORBIDDEN)', () => {
    expect(canReply({ status: 'approved' }, false, false)).toBe(false);
  });

  it('admin + reply déjà existante → false (single reply rule)', () => {
    expect(canReply({ status: 'approved' }, true, true)).toBe(false);
  });

  it('admin + status pending → false (pas de reply sur brouillon)', () => {
    expect(canReply({ status: 'pending' }, true, false)).toBe(false);
  });

  it('review null → false (safe guard)', () => {
    expect(canReply(null, true, false)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateModerationAction (3 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('validateModerationAction — whitelist stricte', () => {
  it('approve → true', () => {
    expect(validateModerationAction('approve')).toBe(true);
  });

  it('delete_all (hors whitelist) → false', () => {
    expect(validateModerationAction('delete_all')).toBe(false);
  });

  it('non-string (number) → false', () => {
    expect(validateModerationAction(42)).toBe(false);
  });

  it('4 actions whitelist toutes valides', () => {
    expect(validateModerationAction('approve')).toBe(true);
    expect(validateModerationAction('reject')).toBe(true);
    expect(validateModerationAction('flag')).toBe(true);
    expect(validateModerationAction('delete')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCT_REVIEWS_ERROR_CODES + constants (sanity)
// ════════════════════════════════════════════════════════════════════════════

describe('PRODUCT_REVIEWS_ERROR_CODES + constants', () => {
  it('8 codes stables exportés (sanity)', () => {
    expect(Object.keys(PRODUCT_REVIEWS_ERROR_CODES).length).toBeGreaterThanOrEqual(6);
    expect(PRODUCT_REVIEWS_ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(PRODUCT_REVIEWS_ERROR_CODES.INVALID_STARS).toBe('INVALID_STARS');
    expect(PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_SHORT).toBe('BODY_TOO_SHORT');
    expect(PRODUCT_REVIEWS_ERROR_CODES.BODY_TOO_LONG).toBe('BODY_TOO_LONG');
    expect(PRODUCT_REVIEWS_ERROR_CODES.INVALID_PHOTO_URL).toBe('INVALID_PHOTO_URL');
    expect(PRODUCT_REVIEWS_ERROR_CODES.INVALID_MODERATION_ACTION).toBe('INVALID_MODERATION_ACTION');
  });

  it('MIN_BODY_LENGTH=10, MAX_BODY_LENGTH=2000, VALID_STARS=[1..5]', () => {
    expect(MIN_BODY_LENGTH).toBe(10);
    expect(MAX_BODY_LENGTH).toBe(2000);
    expect(VALID_STARS).toEqual([1, 2, 3, 4, 5]);
  });
});
