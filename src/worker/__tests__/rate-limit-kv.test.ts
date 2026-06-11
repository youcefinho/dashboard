// ── rate-limit-kv.test.ts — Sprint 91 (seq186) ─────────────────────────────
// Tests vitest pour le module rate-limit-kv. Couvre ~12 cas :
//
//  checkRateLimitKV (8) :
//   1. KV null → fail-open (allowed: true, remaining: max)
//   2. KV undefined → fail-open (allowed: true)
//   3. Première requête → allowed: true, remaining: max-1
//   4. Requêtes sous le quota → allowed: true, remaining décrémenté
//   5. Quota atteint → allowed: false, remaining: 0, retryAfterSec > 0
//   6. KV.get throw → fail-open
//   7. KV.put throw → fail-open (le get réussit mais le put échoue)
//   8. Différents tiers ont des limites différentes
//
//  buildRateLimitHeaders (2) :
//   9. Résultat autorisé → headers sans Retry-After
//  10. Résultat bloqué → headers avec Retry-After
//
//  rateLimitedResponse (2) :
//  11. Structure JSON correcte (error, code, retry_after_seconds)
//  12. Status 429 + headers X-RateLimit-*
//
// Mock KV minimal. ZÉRO réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkRateLimitKV,
  buildRateLimitHeaders,
  rateLimitedResponse,
  RATE_LIMIT_TIERS,
  type RateLimitTier,
  type RateLimitKVResult,
} from '../lib/rate-limit-kv';

// ── Mock KV minimal ────────────────────────────────────────────────────────

interface MockKVStore {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getWithMetadata: ReturnType<typeof vi.fn>;
}

function makeKV(initialData: Record<string, string> = {}): MockKVStore {
  const store = new Map<string, string>(Object.entries(initialData));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// checkRateLimitKV — 8 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S91 — checkRateLimitKV', () => {
  it('1. KV null → fail-open (allowed: true, remaining: max)', async () => {
    const result = await checkRateLimitKV(null, '1.2.3.4', 'public');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_TIERS.public.max);
    expect(result.retryAfterSec).toBe(0);
    expect(result.tier).toBe('public');
  });

  it('2. KV undefined → fail-open (allowed: true)', async () => {
    const result = await checkRateLimitKV(undefined, '1.2.3.4', 'authenticated');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_TIERS.authenticated.max);
    expect(result.tier).toBe('authenticated');
  });

  it('3. Première requête → allowed: true, remaining: max-1', async () => {
    const kv = makeKV();
    const result = await checkRateLimitKV(kv as unknown as KVNamespace, '1.2.3.4', 'public');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_TIERS.public.max - 1);
    expect(result.retryAfterSec).toBe(0);
    // Vérifie que KV.put a été appelé avec le compteur "1"
    expect(kv.put).toHaveBeenCalledTimes(1);
    const putArgs = kv.put.mock.calls[0] as [string, string, { expirationTtl: number }];
    expect(putArgs[1]).toBe('1');
    expect(putArgs[2].expirationTtl).toBe(RATE_LIMIT_TIERS.public.windowSec + 1);
  });

  it('4. Requêtes sous le quota → allowed: true, remaining décrémenté', async () => {
    // Simuler un compteur existant à 30 (public max = 60)
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % 60);
    const key = `rl:public:1.2.3.4:${windowStart}`;
    const kv = makeKV({ [key]: '30' });

    const result = await checkRateLimitKV(kv as unknown as KVNamespace, '1.2.3.4', 'public');

    expect(result.allowed).toBe(true);
    // remaining = max - count - 1 = 60 - 30 - 1 = 29
    expect(result.remaining).toBe(29);
    // Vérifie que le put a incrémenté à 31
    const putArgs = kv.put.mock.calls[0] as [string, string, unknown];
    expect(putArgs[1]).toBe('31');
  });

  it('5. Quota atteint → allowed: false, remaining: 0, retryAfterSec > 0', async () => {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % 60);
    const key = `rl:public:1.2.3.4:${windowStart}`;
    const kv = makeKV({ [key]: '60' }); // Exactement le max

    const result = await checkRateLimitKV(kv as unknown as KVNamespace, '1.2.3.4', 'public');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSec).toBeLessThanOrEqual(60);
    // Vérifie que KV.put n'a PAS été appelé (pas d'incrément)
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('6. KV.get throw → fail-open', async () => {
    const kv = makeKV();
    kv.get = vi.fn(async () => { throw new Error('KV timeout'); });

    const result = await checkRateLimitKV(kv as unknown as KVNamespace, '1.2.3.4', 'public');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_TIERS.public.max);
  });

  it('7. KV.put throw après get OK → fail-open (ne bloque pas)', async () => {
    const kv = makeKV();
    kv.put = vi.fn(async () => { throw new Error('KV write error'); });

    // Le get retourne null (premier appel), le put échoue → catch → fail-open
    const result = await checkRateLimitKV(kv as unknown as KVNamespace, '1.2.3.4', 'public');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMIT_TIERS.public.max);
  });

  it('8. Différents tiers ont des limites différentes', async () => {
    const kv = makeKV();

    const publicResult = await checkRateLimitKV(kv as unknown as KVNamespace, 'ip', 'public');
    expect(publicResult.remaining).toBe(RATE_LIMIT_TIERS.public.max - 1);
    expect(publicResult.tier).toBe('public');

    const kv2 = makeKV();
    const authResult = await checkRateLimitKV(kv2 as unknown as KVNamespace, 'user-1', 'authenticated');
    expect(authResult.remaining).toBe(RATE_LIMIT_TIERS.authenticated.max - 1);
    expect(authResult.tier).toBe('authenticated');

    const kv3 = makeKV();
    const apiResult = await checkRateLimitKV(kv3 as unknown as KVNamespace, 'key-1', 'api');
    expect(apiResult.remaining).toBe(RATE_LIMIT_TIERS.api.max - 1);
    expect(apiResult.tier).toBe('api');

    // Vérifie que les max sont bien différents
    expect(RATE_LIMIT_TIERS.public.max).toBeLessThan(RATE_LIMIT_TIERS.authenticated.max);
    expect(RATE_LIMIT_TIERS.authenticated.max).toBeLessThan(RATE_LIMIT_TIERS.api.max);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildRateLimitHeaders — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S91 — buildRateLimitHeaders', () => {
  it('9. Résultat autorisé → headers sans Retry-After', () => {
    const result: RateLimitKVResult = {
      allowed: true,
      remaining: 55,
      retryAfterSec: 0,
      resetAt: 1700000060,
      tier: 'public',
    };
    const headers = buildRateLimitHeaders(result);

    expect(headers['X-RateLimit-Limit']).toBe(String(RATE_LIMIT_TIERS.public.max));
    expect(headers['X-RateLimit-Remaining']).toBe('55');
    expect(headers['X-RateLimit-Reset']).toBe('1700000060');
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('10. Résultat bloqué → headers avec Retry-After', () => {
    const result: RateLimitKVResult = {
      allowed: false,
      remaining: 0,
      retryAfterSec: 42,
      resetAt: 1700000060,
      tier: 'authenticated',
    };
    const headers = buildRateLimitHeaders(result);

    expect(headers['X-RateLimit-Limit']).toBe(String(RATE_LIMIT_TIERS.authenticated.max));
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBe('42');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// rateLimitedResponse — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S91 — rateLimitedResponse', () => {
  it('11. Structure JSON correcte (error, code, retry_after_seconds)', async () => {
    const result: RateLimitKVResult = {
      allowed: false,
      remaining: 0,
      retryAfterSec: 30,
      resetAt: 1700000060,
      tier: 'public',
    };
    const response = rateLimitedResponse(result);
    const body = (await response.json()) as {
      error?: string;
      code?: string;
      retry_after_seconds?: number;
    };

    expect(body.error).toBe('Trop de requêtes. Réessayez plus tard.');
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retry_after_seconds).toBe(30);
  });

  it('12. Status 429 + headers X-RateLimit-*', async () => {
    const result: RateLimitKVResult = {
      allowed: false,
      remaining: 0,
      retryAfterSec: 15,
      resetAt: 1700000060,
      tier: 'api',
    };
    const response = rateLimitedResponse(result);

    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-RateLimit-Limit')).toBe(String(RATE_LIMIT_TIERS.api.max));
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('Retry-After')).toBe('15');
    expect(response.headers.get('X-RateLimit-Reset')).toBe('1700000060');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// RATE_LIMIT_TIERS — vérification structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S91 — RATE_LIMIT_TIERS config', () => {
  it('13. Tous les tiers ont max > 0 et windowSec > 0', () => {
    for (const tier of ['public', 'authenticated', 'api'] as RateLimitTier[]) {
      const config = RATE_LIMIT_TIERS[tier];
      expect(config.max).toBeGreaterThan(0);
      expect(config.windowSec).toBeGreaterThan(0);
    }
  });

  it('14. Tier public < authenticated < api (progression de quotas)', () => {
    expect(RATE_LIMIT_TIERS.public.max).toBe(60);
    expect(RATE_LIMIT_TIERS.authenticated.max).toBe(120);
    expect(RATE_LIMIT_TIERS.api.max).toBe(300);
  });
});
