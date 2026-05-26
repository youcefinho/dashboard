// ════════════════════════════════════════════════════════════
// Sprint 33 — gcal-client.ts tests (mock fetch + retry + erreurs)
// ════════════════════════════════════════════════════════════
//
// Couvre la lib bas-niveau `src/worker/lib/gcal-client.ts` (A1) :
//   - getGcalAccessToken (refresh OAuth google_calendar)
//   - gcalListEvents (GET calendar/v3/calendars/{calId}/events + Bearer)
//   - gcalCreateEvent (POST events body)
//   - gcalPatchEvent (PATCH events avec If-Match etag)
//   - Retry sur 429/5xx (max 3 essais), CalendarApiError pour 4xx non-retry
//   - 401 → propagé tel quel (refresh + retry géré côté handler haut-niveau)
//   - Timeout via AbortController → AbortError
//
// Calque EXACT du pattern Sprint 32 gbp-client.test.ts (Agent A1).
//
// NB tests : on ne passe PAS TOKEN_KEY pour que decryptToken renvoie le
// ciphertext tel quel (mode dev fallback) — les valeurs "at_fresh"/"at_old"
// stockées dans le mock DB ne sont pas du vrai chiffré AES-GCM.
//
// Signature des helpers gcal* : (token, calendarId, ...) — PAS (env, token, ...).
// Le refresh/rate-limit est géré côté handler haut-niveau (getGcalAccessToken
// pour le token, gcalCheckRateLimit pour la borne). Les helpers REST sont
// token-only par design (cf. en-tête lib).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lazy-import pour pouvoir mock fetch AVANT chaque test.
let gcal: typeof import('../lib/gcal-client');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  gcal = await import('../lib/gcal-client');
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
    GCAL_SYNC_OAUTH_CLIENT_ID: 'cid',
    GCAL_SYNC_OAUTH_CLIENT_SECRET: 'csecret',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
  } as any;
}

// ── getGcalAccessToken ──────────────────────────────────────

describe('getGcalAccessToken', () => {
  it('retourne le cached access_token si non expiré (pas de fetch)', async () => {
    const env = makeEnv({
      refresh_token: 'rt',
      access_token: 'at_fresh',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    const token = await gcal.getGcalAccessToken(env, { clientId: 'c1' } as any);
    expect(token).toBe('at_fresh');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refresh via POST oauth2.googleapis.com/token si expiré', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { access_token: 'at_new', expires_in: 3600 }),
    );
    const env = makeEnv();
    const token = await gcal.getGcalAccessToken(env, { clientId: 'c1' } as any);
    expect(token).toBe('at_new');
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toContain('oauth2.googleapis.com');
    expect(String(init?.body ?? '')).toContain('refresh_token');
  });

  it('retourne null si pas de connexion en DB', async () => {
    const env = makeEnv(null);
    const token = await gcal.getGcalAccessToken(env, { clientId: 'c-none' } as any);
    expect(token).toBeNull();
  });
});

// ── gcalListEvents ──────────────────────────────────────────

describe('gcalListEvents', () => {
  it('appelle endpoint calendar/v3/calendars/{id}/events + Bearer header', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { items: [{ id: 'ev1', summary: 'RDV' }] }),
    );
    // signature lib : (token, calendarId, params?)
    const res = await gcal.gcalListEvents('at_x', 'primary');
    expect(res.items?.length).toBe(1);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/calendars\/primary\/events/);
    expect((init?.headers as any)?.Authorization).toBe('Bearer at_x');
  });

  it('retry sur 429 puis success (2 calls)', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(await mockResponse(429, { error: 'rate' }))
      .mockResolvedValueOnce(await mockResponse(200, { items: [] }));
    const res = await gcal.gcalListEvents('at_x', 'primary');
    expect(res.items).toEqual([]);
    expect((global.fetch as any).mock.calls.length).toBe(2);
  }, 15000);

  it('retry sur 503 puis throw CalendarApiError au dernier essai', async () => {
    (global.fetch as any).mockResolvedValue(await mockResponse(503, { error: 'down' }));
    await expect(gcal.gcalListEvents('at_x', 'primary')).rejects.toMatchObject({
      name: 'CalendarApiError',
      statusCode: 503,
    });
  }, 15000);

  it('401 → propagé tel quel (handler haut-niveau refresh + retry 1×)', async () => {
    // La lib gcalFetch propage 401 sans retry interne (cf. en-tête fichier).
    // Le refresh + retry est géré côté handler haut-niveau, hors-scope ici.
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(401, { error: 'unauthorized' }),
    );
    await expect(gcal.gcalListEvents('at_x', 'primary')).rejects.toMatchObject({
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
    await expect(gcal.gcalListEvents('at_x', 'primary')).rejects.toThrow();
  }, 15000);
});

// ── gcalCreateEvent ─────────────────────────────────────────

describe('gcalCreateEvent', () => {
  it('POST /events avec body summary + start + end', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { id: 'ev_created', summary: 'RDV' }),
    );
    // signature lib : (token, calendarId, payload)
    const res = await gcal.gcalCreateEvent('at_x', 'primary', {
      summary: 'RDV',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T11:00:00Z' },
    });
    expect(res.id).toBe('ev_created');
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/calendars\/primary\/events/);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('RDV');
  });
});

// ── gcalPatchEvent ──────────────────────────────────────────

describe('gcalPatchEvent', () => {
  it('PATCH /events/{id} avec If-Match etag header', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      await mockResponse(200, { id: 'ev1', summary: 'RDV modifié' }),
    );
    // signature lib : (token, calendarId, eventId, payload, etag)
    await gcal.gcalPatchEvent('at_x', 'primary', 'ev1', { summary: 'RDV modifié' }, 'etag-123');
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(String(url)).toMatch(/calendars\/primary\/events\/ev1/);
    expect(init?.method).toBe('PATCH');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['If-Match'] ?? headers['if-match']).toBe('etag-123');
  });
});
