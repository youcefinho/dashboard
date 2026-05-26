// ════════════════════════════════════════════════════════════
// Sprint 33 — outlook-client.ts tests (Microsoft Graph + retry)
// ════════════════════════════════════════════════════════════
//
// Couvre la lib bas-niveau `src/worker/lib/outlook-client.ts` (A1) :
//   - getOutlookAccessToken (refresh OAuth provider='outlook')
//   - outlookListEvents (GET graph.microsoft.com/v1.0/me/calendars/{id}/events)
//   - outlookCreateEvent (POST events body)
//   - outlookPatchEvent (PATCH events avec If-Match etag)
//   - Retry sur 429/5xx (max 3 essais), CalendarApiError pour 4xx non-retry
//   - 401 → propagé tel quel (refresh + retry géré côté handler haut-niveau)
//   - Timeout via AbortController → AbortError
//
// Calque EXACT du pattern gcal-client.test.ts (Sprint 33 A1, Google side).
//
// NB tests : on ne passe PAS TOKEN_KEY pour que decryptToken renvoie le
// ciphertext tel quel (mode dev fallback) — les valeurs "at_fresh"/"at_old"
// stockées dans le mock DB ne sont pas du vrai chiffré AES-GCM.
//
// Signature des helpers outlook* : (token, calendarId, ...) — PAS (env, token, ...).
// Le refresh/rate-limit est géré côté handler haut-niveau.
//
// Env var names pour le refresh : MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET
// (+ MS_OAUTH_TENANT facultatif, défaut 'common').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lazy-import pour pouvoir mock fetch AVANT chaque test.
let outlook: typeof import('../lib/outlook-client');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  outlook = await import('../lib/outlook-client');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockResponse(status: number, body: any, opts: { delay?: number } = {}) {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return opts.delay
    ? new Promise<Response>((r) => setTimeout(() => r(res), opts.delay))
    : Promise.resolve(res);
}

function makeEnv(connRow?: {
  refresh_token?: string;
  access_token?: string;
  expires_at?: string | null;
} | null) {
  const first = vi.fn().mockResolvedValue(
    connRow === undefined
      ? {
          id: 'conn-1',
          refresh_token: 'rt_test',
          access_token: 'at_old',
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        }
      : connRow == null
        ? null
        : { id: 'conn-1', ...connRow },
  );
  return {
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first,
      run: vi.fn().mockResolvedValue({ success: true }),
    },
    // outlook-client.ts lit MS_OAUTH_* (cf. outlookOauthCredentials).
    MS_OAUTH_CLIENT_ID: 'cid',
    MS_OAUTH_CLIENT_SECRET: 'csecret',
    MS_OAUTH_TENANT: 'common',
  } as any;
}

// ── getOutlookAccessToken ───────────────────────────────────

describe('getOutlookAccessToken', () => {
  it('retourne le cached access_token si non expiré (pas de fetch)', async () => {
    const env = makeEnv({
      refresh_token: 'rt',
      access_token: 'at_fresh',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    const token = await outlook.getOutlookAccessToken(env, { clientId: 'c1' } as any);
    expect(token).toBe('at_fresh');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refresh via POST login.microsoftonline.com/.../token si expiré', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { access_token: 'at_new', expires_in: 3600 }),
    );
    const env = makeEnv();
    const token = await outlook.getOutlookAccessToken(env, { clientId: 'c1' } as any);
    expect(token).toBe('at_new');
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/login\.microsoftonline\.com|microsoftonline/);
    expect(String(init?.body ?? '')).toContain('refresh_token');
  });

  it('retourne null si pas de connexion en DB', async () => {
    const env = makeEnv(null);
    const token = await outlook.getOutlookAccessToken(env, { clientId: 'c-none' } as any);
    expect(token).toBeNull();
  });
});

// ── outlookListEvents ───────────────────────────────────────

describe('outlookListEvents', () => {
  it('appelle endpoint graph.microsoft.com/v1.0/me/calendars/{id}/events + Bearer header', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { value: [{ id: 'ev1', subject: 'RDV' }] }),
    );
    // signature lib : (token, calendarId, params?)
    const res = await outlook.outlookListEvents('at_x', 'primary');
    expect(res.value?.length).toBe(1);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/graph\.microsoft\.com\/v1\.0\/.*events/);
    expect((init?.headers as any)?.Authorization).toBe('Bearer at_x');
  });

  it('retry sur 429 puis success (2 calls)', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(await mockResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(await mockResponse(200, { value: [] }));
    const res = await outlook.outlookListEvents('at_x', 'primary');
    expect(res.value).toEqual([]);
    expect((global.fetch as any).mock.calls.length).toBe(2);
  }, 15000);

  it('retry sur 503 puis throw CalendarApiError au dernier essai', async () => {
    (global.fetch as any).mockResolvedValue(await mockResponse(503, { error: 'down' }));
    await expect(outlook.outlookListEvents('at_x', 'primary')).rejects.toMatchObject({
      name: 'CalendarApiError',
      statusCode: 503,
    });
  }, 15000);

  it('401 → propagé tel quel (handler haut-niveau refresh + retry 1×)', async () => {
    // La lib outlookFetch propage 401 sans retry interne (cf. en-tête fichier).
    // Le refresh + retry est géré côté handler haut-niveau, hors-scope ici.
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(401, { error: 'unauthorized' }),
    );
    await expect(outlook.outlookListEvents('at_x', 'primary')).rejects.toMatchObject({
      name: 'CalendarApiError',
      statusCode: 401,
    });
  });

  it('timeout (AbortError) → throw', async () => {
    (global.fetch as any).mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            5,
          ),
        ),
    );
    await expect(outlook.outlookListEvents('at_x', 'primary')).rejects.toThrow();
  }, 15000);
});

// ── outlookCreateEvent ──────────────────────────────────────

describe('outlookCreateEvent', () => {
  it('POST /events avec body subject + start + end', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { id: 'ev_created', subject: 'RDV' }),
    );
    // signature lib : (token, calendarId, payload)
    const res = await outlook.outlookCreateEvent('at_x', 'primary', {
      subject: 'RDV',
      start: { dateTime: '2026-06-01T10:00:00', timeZone: 'UTC' },
      end: { dateTime: '2026-06-01T11:00:00', timeZone: 'UTC' },
    });
    expect(res.id).toBe('ev_created');
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/calendars\/primary\/events/);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('RDV');
  });
});

// ── outlookPatchEvent ───────────────────────────────────────

describe('outlookPatchEvent', () => {
  it('PATCH /events/{id} avec If-Match etag header', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { id: 'ev1', subject: 'RDV modifié' }),
    );
    // signature lib : (token, calendarId, eventId, payload, etag)
    await outlook.outlookPatchEvent(
      'at_x',
      'primary',
      'ev1',
      { subject: 'RDV modifié' },
      'etag-abc',
    );
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/calendars\/primary\/events\/ev1/);
    expect(init?.method).toBe('PATCH');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['If-Match'] ?? headers['if-match']).toBe('etag-abc');
  });
});
