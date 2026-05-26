// ════════════════════════════════════════════════════════════
// Sprint 32 — gbp-engine.ts (helpers PURS)
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/gbp-engine.ts` :
//   - GBP_ERROR_CODES + GBP_METRICS_WHITELIST (consts présentes + frozen)
//   - mapStarRating (FIVE→5, ONE→1, STAR_RATING_UNSPECIFIED→null, null/'' → null)
//   - validateReplyComment (empty / 5000 chars / normal / sanitize <script>)
//   - validateLocalPostPayload (summary empty / 1500 OK / 2000 reject / topicType / CTA / mediaUrl)
//   - validateMetricsList (filter whitelist + dedupe + uppercase)
//   - parseGbpDateRange (end < start reject / >540 days reject / 30 days OK / NaN reject)
//   - mapConnectionRow (mapping camelCase défensif + nulls)
//
// Pas de mock D1 / fetch nécessaire : helpers 100 % purs.

import { describe, it, expect } from 'vitest';
import {
  GBP_ERROR_CODES,
  GBP_METRICS_WHITELIST,
  GBP_LOCAL_POST_TOPIC_TYPES,
  GBP_MAX_REPLY_LENGTH,
  GBP_MAX_POST_SUMMARY_LENGTH,
  GBP_MAX_DATE_RANGE_DAYS,
  mapStarRating,
  validateReplyComment,
  validateLocalPostPayload,
  validateMetricsList,
  parseGbpDateRange,
  mapConnectionRow,
} from '../lib/gbp-engine';

// ════════════════════════════════════════════════════════════
//  Constantes
// ════════════════════════════════════════════════════════════

describe('GBP_ERROR_CODES', () => {
  it('expose les codes stables attendus', () => {
    expect(GBP_ERROR_CODES.GBP_NOT_CONNECTED).toBe('GBP_NOT_CONNECTED');
    expect(GBP_ERROR_CODES.GBP_API_ERROR).toBe('GBP_API_ERROR');
    expect(GBP_ERROR_CODES.GBP_REVIEW_NOT_FOUND).toBe('GBP_REVIEW_NOT_FOUND');
    expect(GBP_ERROR_CODES.GBP_LOCATION_NOT_FOUND).toBe('GBP_LOCATION_NOT_FOUND');
    expect(GBP_ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
  });
});

describe('GBP_METRICS_WHITELIST', () => {
  it('contient les 4 métriques par défaut du handler insights', () => {
    expect(GBP_METRICS_WHITELIST).toContain('BUSINESS_IMPRESSIONS_DESKTOP_MAPS');
    expect(GBP_METRICS_WHITELIST).toContain('CALL_CLICKS');
    expect(GBP_METRICS_WHITELIST).toContain('BUSINESS_DIRECTION_REQUESTS');
    expect(GBP_METRICS_WHITELIST).toContain('WEBSITE_CLICKS');
  });

  it('est frozen (immutable cross-handlers)', () => {
    expect(Object.isFrozen(GBP_METRICS_WHITELIST)).toBe(true);
  });
});

describe('GBP_LOCAL_POST_TOPIC_TYPES', () => {
  it('contient STANDARD/EVENT/OFFER/ALERT', () => {
    expect(GBP_LOCAL_POST_TOPIC_TYPES).toEqual(['STANDARD', 'EVENT', 'OFFER', 'ALERT']);
  });
});

// ════════════════════════════════════════════════════════════
//  mapStarRating
// ════════════════════════════════════════════════════════════

describe('mapStarRating', () => {
  it("'FIVE' → 5", () => {
    expect(mapStarRating('FIVE')).toBe(5);
  });

  it("'ONE' → 1, 'TWO' → 2, 'THREE' → 3, 'FOUR' → 4", () => {
    expect(mapStarRating('ONE')).toBe(1);
    expect(mapStarRating('TWO')).toBe(2);
    expect(mapStarRating('THREE')).toBe(3);
    expect(mapStarRating('FOUR')).toBe(4);
  });

  it("'STAR_RATING_UNSPECIFIED' → null", () => {
    expect(mapStarRating('STAR_RATING_UNSPECIFIED')).toBeNull();
  });

  it('null / undefined / empty → null', () => {
    expect(mapStarRating(null)).toBeNull();
    expect(mapStarRating(undefined)).toBeNull();
    expect(mapStarRating('')).toBeNull();
  });

  it("valeur inconnue 'SIX' → null (défensif)", () => {
    expect(mapStarRating('SIX')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
//  validateReplyComment
// ════════════════════════════════════════════════════════════

describe('validateReplyComment', () => {
  it('rejette empty / null / whitespace-only', () => {
    expect(validateReplyComment('').ok).toBe(false);
    expect(validateReplyComment(null).ok).toBe(false);
    expect(validateReplyComment(undefined).ok).toBe(false);
    expect(validateReplyComment('   ').ok).toBe(false);
  });

  it('rejette 5000 chars (> 4096)', () => {
    const long = 'a'.repeat(5000);
    const res = validateReplyComment(long);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('INVALID_INPUT');
    expect(res.error).toMatch(/trop long/i);
  });

  it('accepte 4096 chars exactement (borne haute)', () => {
    const exact = 'a'.repeat(GBP_MAX_REPLY_LENGTH);
    expect(validateReplyComment(exact).ok).toBe(true);
  });

  it('accepte un comment normal et retourne sanitized', () => {
    const res = validateReplyComment('Merci pour votre avis !');
    expect(res.ok).toBe(true);
    expect(res.sanitized).toBe('Merci pour votre avis !');
  });

  it('strip <script>…</script> dans sanitized (XSS basic)', () => {
    const res = validateReplyComment('Merci <script>alert(1)</script> beaucoup');
    expect(res.ok).toBe(true);
    expect(res.sanitized).not.toContain('<script>');
    expect(res.sanitized).not.toContain('alert(1)');
  });

  it('strip <iframe>…</iframe> dans sanitized', () => {
    const res = validateReplyComment('Bonjour <iframe src="x"></iframe>');
    expect(res.ok).toBe(true);
    expect(res.sanitized).not.toContain('<iframe');
  });
});

// ════════════════════════════════════════════════════════════
//  validateLocalPostPayload
// ════════════════════════════════════════════════════════════

describe('validateLocalPostPayload', () => {
  it('rejette summary empty/null/whitespace', () => {
    expect(validateLocalPostPayload({ summary: '' }).ok).toBe(false);
    expect(validateLocalPostPayload({ summary: null }).ok).toBe(false);
    expect(validateLocalPostPayload({ summary: '   ' }).ok).toBe(false);
  });

  it('accepte 1500 chars exactement (borne haute)', () => {
    const exact = 'a'.repeat(GBP_MAX_POST_SUMMARY_LENGTH);
    expect(validateLocalPostPayload({ summary: exact }).ok).toBe(true);
  });

  it('rejette 2000 chars (> 1500)', () => {
    const long = 'a'.repeat(2000);
    const res = validateLocalPostPayload({ summary: long });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/trop long/i);
  });

  it('rejette topicType invalide', () => {
    const res = validateLocalPostPayload({ summary: 'ok', topicType: 'INVALID' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/topicType/i);
  });

  it('accepte topicType STANDARD/EVENT/OFFER/ALERT (case-insensitive)', () => {
    expect(validateLocalPostPayload({ summary: 'x', topicType: 'STANDARD' }).ok).toBe(true);
    expect(validateLocalPostPayload({ summary: 'x', topicType: 'event' }).ok).toBe(true);
    expect(validateLocalPostPayload({ summary: 'x', topicType: 'OFFER' }).ok).toBe(true);
    expect(validateLocalPostPayload({ summary: 'x', topicType: 'ALERT' }).ok).toBe(true);
  });

  it('accepte topicType absent (défaut STANDARD côté handler)', () => {
    expect(validateLocalPostPayload({ summary: 'x' }).ok).toBe(true);
  });

  it('rejette callToAction sans actionType', () => {
    const res = validateLocalPostPayload({
      summary: 'x',
      callToAction: { url: 'https://example.com' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/actionType/i);
  });

  it('rejette callToAction.url invalide', () => {
    const res = validateLocalPostPayload({
      summary: 'x',
      callToAction: { actionType: 'BOOK', url: 'not-a-url' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/url/i);
  });

  it('accepte callToAction valide complet', () => {
    expect(
      validateLocalPostPayload({
        summary: 'x',
        callToAction: { actionType: 'BOOK', url: 'https://example.com/book' },
      }).ok,
    ).toBe(true);
  });

  it('rejette mediaUrl invalide', () => {
    const res = validateLocalPostPayload({ summary: 'x', mediaUrl: 'javascript:alert(1)' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mediaUrl/i);
  });

  it('accepte mediaUrl https valide', () => {
    expect(
      validateLocalPostPayload({ summary: 'x', mediaUrl: 'https://cdn.example.com/photo.jpg' }).ok,
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
//  validateMetricsList
// ════════════════════════════════════════════════════════════

describe('validateMetricsList', () => {
  it('filtre les métriques hors whitelist', () => {
    const out = validateMetricsList(['CALL_CLICKS', 'BOGUS_METRIC', 'WEBSITE_CLICKS']);
    expect(out).toEqual(['CALL_CLICKS', 'WEBSITE_CLICKS']);
  });

  it('uppercase + trim avant match', () => {
    const out = validateMetricsList(['  call_clicks  ', 'website_clicks']);
    expect(out).toEqual(['CALL_CLICKS', 'WEBSITE_CLICKS']);
  });

  it('dedupe les doublons', () => {
    const out = validateMetricsList(['CALL_CLICKS', 'CALL_CLICKS', 'call_clicks']);
    expect(out).toEqual(['CALL_CLICKS']);
  });

  it('renvoie [] si input null/undefined/empty/all-invalid', () => {
    expect(validateMetricsList(null)).toEqual([]);
    expect(validateMetricsList(undefined)).toEqual([]);
    expect(validateMetricsList([])).toEqual([]);
    expect(validateMetricsList(['NOPE', 'NADA'])).toEqual([]);
  });

  it('skip null/undefined/empty items dans la liste', () => {
    const out = validateMetricsList([null, undefined, '', 'CALL_CLICKS']);
    expect(out).toEqual(['CALL_CLICKS']);
  });
});

// ════════════════════════════════════════════════════════════
//  parseGbpDateRange
// ════════════════════════════════════════════════════════════

describe('parseGbpDateRange', () => {
  it('rejette si start/end manquant', () => {
    expect(parseGbpDateRange(null, '2026-05-01').valid).toBe(false);
    expect(parseGbpDateRange('2026-04-01', null).valid).toBe(false);
    expect(parseGbpDateRange(undefined, undefined).valid).toBe(false);
  });

  it('rejette si ISO invalide', () => {
    const res = parseGbpDateRange('not-a-date', '2026-05-01');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/invalides/i);
  });

  it('rejette si end < start', () => {
    const res = parseGbpDateRange('2026-05-01', '2026-04-01');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/postérieur/i);
  });

  it('rejette si end == start (strict >)', () => {
    const res = parseGbpDateRange('2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
    expect(res.valid).toBe(false);
  });

  it('rejette si > 540 jours', () => {
    const res = parseGbpDateRange('2024-01-01', '2026-05-01'); // ≈850 jours
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/large|jours/i);
  });

  it('accepte 30 jours valides', () => {
    const res = parseGbpDateRange('2026-04-01', '2026-05-01');
    expect(res.valid).toBe(true);
    expect(res.days).toBe(30);
  });

  it('accepte exactement 540 jours (borne haute)', () => {
    const start = new Date('2024-11-01T00:00:00Z');
    const end = new Date(start.getTime() + GBP_MAX_DATE_RANGE_DAYS * 86_400_000);
    const res = parseGbpDateRange(start.toISOString(), end.toISOString());
    expect(res.valid).toBe(true);
    expect(res.days).toBe(GBP_MAX_DATE_RANGE_DAYS);
  });
});

// ════════════════════════════════════════════════════════════
//  mapConnectionRow
// ════════════════════════════════════════════════════════════

describe('mapConnectionRow', () => {
  it('mappe une row complète en camelCase', () => {
    const row = {
      id: 'gc1',
      client_id: 'c1',
      agency_id: 'a1',
      oauth_connection_id: 'oc1',
      gbp_account_id: 'accounts/123',
      gbp_account_name: 'My Biz',
      status: 'active',
      last_sync_at: '2026-05-01T00:00:00Z',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    };
    const dto = mapConnectionRow(row);
    expect(dto.id).toBe('gc1');
    expect(dto.clientId).toBe('c1');
    expect(dto.agencyId).toBe('a1');
    expect(dto.oauthConnectionId).toBe('oc1');
    expect(dto.gbpAccountId).toBe('accounts/123');
    expect(dto.gbpAccountName).toBe('My Biz');
    expect(dto.status).toBe('active');
    expect(dto.lastSyncAt).toBe('2026-05-01T00:00:00Z');
  });

  it('défensif : nulls partout sauf id (string vide) et status (active par défaut)', () => {
    const dto = mapConnectionRow({});
    expect(dto.id).toBe('');
    expect(dto.clientId).toBeNull();
    expect(dto.agencyId).toBeNull();
    expect(dto.status).toBe('active');
    expect(dto.lastSyncAt).toBeNull();
  });
});
