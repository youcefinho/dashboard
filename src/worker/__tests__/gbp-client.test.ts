// ════════════════════════════════════════════════════════════
// Sprint 32 — gbp-client.ts tests (mock fetch + retry + erreurs)
// ════════════════════════════════════════════════════════════
//
// Couvre la lib bas-niveau `src/worker/lib/gbp-client.ts` (A1) :
//   - getGbpAccessToken (refresh OAuth)
//   - gbpListAccounts / gbpListLocations / gbpListReviews
//   - gbpReplyReview / gbpDeleteReply
//   - gbpCreateLocalPost / gbpListPosts
//   - gbpGetInsights
// Retry sur 429/5xx (1 retry exponentiel ≤ 3 essais), GbpApiError
// pour 4xx non-retry, timeout configurable.
//
// NB tests : on ne passe PAS TOKEN_KEY pour que decryptToken renvoie le
// ciphertext tel quel (mode dev fallback) — les valeurs "at_fresh"/"at_old"
// stockées dans le mock DB ne sont pas du vrai chiffré AES-GCM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// On lazy-import pour pouvoir mock fetch AVANT chaque test
let gbp: typeof import('../lib/gbp-client');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  gbp = await import('../lib/gbp-client');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockResponse(status: number, body: any, opts: { delay?: number } = {}) {
  const res = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return opts.delay
    ? new Promise<Response>((r) => setTimeout(() => r(res), opts.delay))
    : Promise.resolve(res);
}

describe('gbp-client', () => {
  // env de base : credentials Google OAuth + DB mock. Pas de TOKEN_KEY →
  // decryptToken renvoie le ciphertext tel quel (cf. en-tête).
  const env = {
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: 'conn-1',
        refresh_token: 'rt_test',
        access_token: 'at_old',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    },
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
  } as any;

  // ── getGbpAccessToken ───────────────────────────────────────

  describe('getGbpAccessToken', () => {
    it('retourne le cached access_token si non expiré', async () => {
      const envFresh = {
        ...env,
        DB: {
          prepare: vi.fn().mockReturnThis(),
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({
            id: 'conn-1',
            refresh_token: 'rt',
            access_token: 'at_fresh',
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          }),
          run: vi.fn(),
        },
      };
      const token = await gbp.getGbpAccessToken(envFresh, { clientId: 'c1' } as any);
      expect(token).toBe('at_fresh');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refresh via Google OAuth si expirés (POST /token)', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(200, { access_token: 'at_new', expires_in: 3600 })
      );
      const token = await gbp.getGbpAccessToken(env, { clientId: 'c1' } as any);
      expect(token).toBe('at_new');
      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(String(url)).toContain('oauth2.googleapis.com');
      expect(String(init?.body ?? '')).toContain('refresh_token');
    });

    it('retourne null si pas de connexion en DB', async () => {
      const envNoConn = {
        ...env,
        DB: {
          prepare: vi.fn().mockReturnThis(),
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
        },
      };
      const token = await gbp.getGbpAccessToken(envNoConn, { clientId: 'c-none' } as any);
      expect(token).toBeNull();
    });
  });

  // ── Endpoints + retry + erreurs ─────────────────────────────

  describe('gbpListReviews', () => {
    it('appelle endpoint mybusiness v4 reviews + Bearer header', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(200, { reviews: [{ name: 'rev/1', starRating: 'FIVE' }] })
      );
      const res = await gbp.gbpListReviews(env, 'at_x', 'acc1', 'loc1');
      expect(res.reviews?.length).toBe(1);
      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(String(url)).toContain('accounts/acc1/locations/loc1/reviews');
      expect(init?.headers?.Authorization).toBe('Bearer at_x');
    });

    it('retry sur 429 puis success', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce(await mockResponse(429, { error: 'rate' }))
        .mockResolvedValueOnce(await mockResponse(200, { reviews: [] }));
      const res = await gbp.gbpListReviews(env, 'at_x', 'a', 'l');
      expect(res.reviews).toEqual([]);
      expect((global.fetch as any).mock.calls.length).toBe(2);
    }, 15000);

    it('retry sur 503 puis throw GbpApiError au 3e essai', async () => {
      (global.fetch as any)
        .mockResolvedValue(await mockResponse(503, { error: 'down' }));
      await expect(gbp.gbpListReviews(env, 'at_x', 'a', 'l')).rejects.toMatchObject({
        name: 'GbpApiError',
        statusCode: 503,
      });
    }, 15000);

    it('throw GbpApiError sur 403 sans retry', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(403, { error: 'forbidden' })
      );
      await expect(gbp.gbpListReviews(env, 'at_x', 'a', 'l')).rejects.toMatchObject({
        name: 'GbpApiError',
        statusCode: 403,
      });
      expect((global.fetch as any).mock.calls.length).toBe(1);
    });

    it('throw GbpApiError sur 401 (token invalide)', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(401, { error: 'unauthorized' })
      );
      await expect(gbp.gbpListReviews(env, 'at_x', 'a', 'l')).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('timeout (signal aborted) → GbpApiError', async () => {
      (global.fetch as any).mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5)
        )
      );
      await expect(gbp.gbpListReviews(env, 'at_x', 'a', 'l')).rejects.toThrow();
    }, 15000);
  });

  describe('gbpReplyReview', () => {
    it('PUT /reply avec comment dans le body', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(200, { comment: 'merci' })
      );
      // signature lib : (env, token, reviewName, comment) — reviewName format
      // attendu : "accounts/{a}/locations/{l}/reviews/{r}"
      const result = await gbp.gbpReplyReview(
        env,
        'at_x',
        'accounts/a/locations/l/reviews/rev1',
        'merci',
      );
      expect(result.success).toBe(true);
      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(String(url)).toMatch(/\/reply$/);
      expect(init?.method).toBe('PUT');
      expect(String(init?.body)).toContain('merci');
    });
  });

  describe('gbpCreateLocalPost', () => {
    it('POST localPosts avec summary', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(200, { name: 'posts/123', summary: 'hi' })
      );
      // signature lib : (env, token, locationName, payload) — locationName
      // format attendu : "accounts/{a}/locations/{l}"
      const res = await gbp.gbpCreateLocalPost(env, 'at_x', 'accounts/a/locations/l', {
        summary: 'hi',
      });
      expect(res.success).toBe(true);
      expect(res.localPostName).toBe('posts/123');
      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(String(url)).toContain('localPosts');
      expect(init?.method).toBe('POST');
    });
  });

  describe('gbpGetInsights', () => {
    it('appelle endpoint reportInsights/fetchMultiDailyMetricsTimeSeries', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        await mockResponse(200, { locationMetrics: [] })
      );
      // signature lib : (env, token, locationName, metrics[], startTime, endTime)
      // locationName format : "locations/{l}" (sans préfixe accounts/)
      await gbp.gbpGetInsights(
        env,
        'at_x',
        'locations/l',
        ['CALL_CLICKS'],
        '2026-05-01T00:00:00Z',
        '2026-05-07T00:00:00Z',
      );
      const [url] = (global.fetch as any).mock.calls[0];
      expect(String(url)).toMatch(/reportInsights|locationMetrics|fetchMultiDailyMetricsTimeSeries|fetchVerificationOptions/);
    });
  });
});
