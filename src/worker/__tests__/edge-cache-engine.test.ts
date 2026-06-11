// ── edge-cache-engine.test.ts — Sprint 94 (seq189) ──────────────────────────
// Tests pour le cache Edge & optimisation CDN.
// 14 cas : clé canonique, profils, headers, ETag, staleness, purge.

import { describe, it, expect } from 'vitest';
import {
  buildCacheKey,
  buildCacheHeaders,
  buildETag,
  isStale,
  shouldCache,
  buildPurgeKeys,
  CACHE_PROFILES,
} from '../lib/edge-cache-engine';

// ──────────────────────────────────────────────────────────────────────────
// buildCacheKey — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — buildCacheKey', () => {
  it('1. Paramètres triés alphabétiquement → clé déterministe', () => {
    const key1 = buildCacheKey('https://example.com/api?z=1&a=2&m=3');
    const key2 = buildCacheKey('https://example.com/api?m=3&z=1&a=2');
    expect(key1).toBe(key2);
    expect(key1).toBe('/api?a=2&m=3&z=1');
  });

  it('2. Extra params fusionnés dans la clé', () => {
    const key = buildCacheKey('https://example.com/page', { lang: 'fr' });
    expect(key).toBe('/page?lang=fr');
  });

  it('3. URL sans params → clé = pathname seul', () => {
    const key = buildCacheKey('https://example.com/api/public/forms/abc');
    expect(key).toBe('/api/public/forms/abc');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// shouldCache — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — shouldCache', () => {
  it('4. GET sur route publique → cacheable avec profil', () => {
    const r1 = shouldCache('GET', '/api/public/forms/client-123');
    expect(r1.cacheable).toBe(true);
    expect(r1.profile).toBe('public_form');

    const r2 = shouldCache('GET', '/api/public/chat-widget/abc');
    expect(r2.cacheable).toBe(true);
    expect(r2.profile).toBe('widget');
  });

  it('5. POST sur route publique → NON cacheable', () => {
    const r = shouldCache('POST', '/api/public/forms/client-123');
    expect(r.cacheable).toBe(false);
  });

  it('6. GET sur route API authentifiée → NON cacheable', () => {
    const r = shouldCache('GET', '/api/leads/list');
    expect(r.cacheable).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildCacheHeaders — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — buildCacheHeaders', () => {
  it('7. Profil public_form → Cache-Control public + max-age + stale', () => {
    const h = buildCacheHeaders({ profile: 'public_form' });
    expect(h['Cache-Control']).toBe('public, max-age=300, stale-while-revalidate=60');
    expect(h['Vary']).toContain('Accept-Encoding');
  });

  it('8. Profil api → no-store', () => {
    const h = buildCacheHeaders({ profile: 'api' });
    expect(h['Cache-Control']).toBe('no-store, no-cache, must-revalidate');
  });

  it('9. ETag et Vary custom injectés', () => {
    const h = buildCacheHeaders({
      profile: 'asset',
      etag: 'abc123',
      vary: ['Accept-Language'],
    });
    expect(h['ETag']).toBe('"abc123"');
    expect(h['Vary']).toContain('Accept-Language');
    expect(h['Vary']).toContain('Accept-Encoding');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildETag — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — buildETag', () => {
  it('10. Même contenu → même ETag (déterministe, 16 chars hex)', async () => {
    const etag1 = await buildETag('Hello World');
    const etag2 = await buildETag('Hello World');
    expect(etag1).toBe(etag2);
    expect(etag1.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(etag1)).toBe(true);

    // Contenu différent → ETag différent
    const etag3 = await buildETag('Different content');
    expect(etag3).not.toBe(etag1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// isStale — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — isStale', () => {
  it('11. Entrée dans le TTL → pas stale', () => {
    const now = 1000000;
    const cachedAt = now - 100 * 1000; // 100s ago
    expect(isStale(cachedAt, 300, now)).toBe(false); // TTL 300s > 100s
  });

  it('12. Au-delà du TTL → stale', () => {
    const now = 1000000;
    const cachedAt = now - 400 * 1000; // 400s ago
    expect(isStale(cachedAt, 300, now)).toBe(true); // TTL 300s < 400s
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildPurgeKeys — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — buildPurgeKeys', () => {
  it('13. Type spécifique → 1 clé de purge', () => {
    const keys = buildPurgeKeys('client-abc', 'form');
    expect(keys.length).toBe(1);
    expect(keys[0]).toBe('/api/public/forms/client-abc');
  });

  it('14. Type "all" → 4 clés de purge', () => {
    const keys = buildPurgeKeys('client-xyz', 'all');
    expect(keys.length).toBe(4);
    expect(keys).toContain('/api/public/forms/client-xyz');
    expect(keys).toContain('/api/public/chat-widget/client-xyz');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S94 — config exports', () => {
  it('15. CACHE_PROFILES a 6 profils', () => {
    const keys = Object.keys(CACHE_PROFILES);
    expect(keys.length).toBe(6);
    expect(keys).toContain('public_form');
    expect(keys).toContain('widget');
    expect(keys).toContain('api');
    expect(keys).toContain('asset');
    expect(keys).toContain('site_page');
    expect(keys).toContain('storefront');
  });
});
