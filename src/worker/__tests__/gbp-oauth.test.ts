// ════════════════════════════════════════════════════════════
// Sprint 32 — gbp-oauth.ts tests (authorize + callback + CSRF)
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/gbp-oauth.ts` (A3) :
//   - handleGbpAuthorize : redirect Google + state CSRF stocké KV
//   - handleGbpCallback OK : code → token → INSERT oauth_connections +
//     INSERT gbp_connections → redirect frontend success
//   - handleGbpCallback erreur (code manquant / state KO / Google KO)
//     → redirect frontend error

import { describe, it, expect, vi, beforeEach } from 'vitest';

let oauth: typeof import('../gbp-oauth');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  oauth = await import('../gbp-oauth');
});

function makeEnv(overrides: any = {}) {
  const kv = new Map<string, string>();
  return {
    // Prod lit GBP_OAUTH_CLIENT_ID / GBP_OAUTH_CLIENT_SECRET (gbp-oauth.ts
    // gbpCredentials) — distincts de GOOGLE_OAUTH_* (G4 Calendar).
    GBP_OAUTH_CLIENT_ID: 'gcid',
    GBP_OAUTH_CLIENT_SECRET: 'gsecret',
    FRONTEND_URL: 'https://app.intralys.dev',
    TOKEN_KEY: 'test-key-32-chars-for-aes-gcm!!',
    STATE_STORE: {
      get: vi.fn(async (k: string) => kv.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { kv.set(k, v); }),
      delete: vi.fn(async (k: string) => { kv.delete(k); }),
    },
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { last_row_id: 1 } }),
      first: vi.fn().mockResolvedValue({ id: 'oauth-conn-1' }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    },
    ...overrides,
  } as any;
}

describe('handleGbpAuthorize', () => {
  it('redirige vers accounts.google.com avec scope GBP + state CSRF stocké KV', async () => {
    const env = makeEnv();
    const url = new URL('https://app.intralys.dev/api/gbp/oauth/authorize');
    const req = new Request(url.toString());
    // capGuard (capabilities.ts:requireCapability) bloque 403 si la cap
    // 'settings.manage' n'est pas dans auth.capabilities. On l'injecte.
    const auth = {
      userId: 'u1',
      clientId: 'c1',
      role: 'admin',
      capabilities: new Set(['settings.manage']),
    } as any;

    const res = await oauth.handleGbpAuthorize(req, env, auth);
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=gcid');
    expect(location).toMatch(/scope=[^&]*business/i);
    expect(env.STATE_STORE.put).toHaveBeenCalled();
  });

  it('refuse si pas de clientId dans auth', async () => {
    const env = makeEnv();
    const req = new Request('https://app.intralys.dev/api/gbp/oauth/authorize');
    const auth = {
      userId: 'u1',
      role: 'admin',
      capabilities: new Set(['settings.manage']),
    } as any;
    const res = await oauth.handleGbpAuthorize(req, env, auth);
    expect([400, 401, 403]).toContain(res.status);
  });
});

describe('handleGbpCallback', () => {
  // ── Conventions prod (gbp-oauth.ts) ────────────────────────────────────
  //   • Signature : handleGbpCallback(request, env) — pas de 3e arg.
  //   • State KV : clé `gbp_oauth_state:${nonce}` (préfixe figé), payload
  //     JSON { client_id, agency_id, origin }. Le query param `state` est
  //     le nonce BRUT (pas base64), il sert directement de suffixe KV.
  //   • Échange token via fetch (mock global) sur oauth2.googleapis.com.

  it('redirige error si code manquant', async () => {
    const env = makeEnv();
    const url = new URL('https://app.intralys.dev/api/gbp/oauth/callback?state=abc');
    const req = new Request(url.toString());
    const res = await oauth.handleGbpCallback(req, env);
    expect([302, 303, 400]).toContain(res.status);
    if (res.status >= 300 && res.status < 400) {
      expect(res.headers.get('location') ?? '').toMatch(/error|gbp/);
    }
  });

  it('redirige error si state KV introuvable (CSRF)', async () => {
    const env = makeEnv();
    // Nonce non stocké → STATE_STORE.get renvoie null → reason=state.
    const nonce = 'never-stored';
    const url = new URL(`https://app.intralys.dev/api/gbp/oauth/callback?code=c1&state=${encodeURIComponent(nonce)}`);
    const req = new Request(url.toString());
    const res = await oauth.handleGbpCallback(req, env);
    expect([302, 303, 400, 403]).toContain(res.status);
  });

  it('OK : code valide + state valide → INSERT + redirect frontend success', async () => {
    const env = makeEnv();
    const nonce = 'good-nonce';
    // Clé KV figée : `gbp_oauth_state:${nonce}` (pas `gbp_state:`).
    // Payload GbpOauthState = { client_id, agency_id, origin }.
    await env.STATE_STORE.put(
      `gbp_oauth_state:${nonce}`,
      JSON.stringify({ client_id: 'c1', agency_id: null, origin: 'https://app.intralys.dev' }),
    );
    // 1er fetch = échange token Google ; 2e fetch (userinfo) best-effort.
    (global.fetch as any)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/business.manage' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: 'owner@example.com' }), { status: 200 }),
      );
    const url = new URL(`https://app.intralys.dev/api/gbp/oauth/callback?code=valid_code&state=${encodeURIComponent(nonce)}`);
    const req = new Request(url.toString());
    const res = await oauth.handleGbpCallback(req, env);
    expect([302, 303]).toContain(res.status);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('intralys.dev');
    // INSERT effectué (DELETE+INSERT oauth_connections via .first RETURNING,
    // puis DELETE+INSERT gbp_connections via .run).
    expect(env.DB.run).toHaveBeenCalled();
    // State consommé (one-time use, anti-replay).
    expect(env.STATE_STORE.delete).toHaveBeenCalled();
  });

  it('redirige error si Google retourne 400/401 sur l\'échange code', async () => {
    const env = makeEnv();
    const nonce = 'good-nonce-2';
    await env.STATE_STORE.put(
      `gbp_oauth_state:${nonce}`,
      JSON.stringify({ client_id: 'c1', agency_id: null, origin: 'https://app.intralys.dev' }),
    );
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    const url = new URL(`https://app.intralys.dev/api/gbp/oauth/callback?code=bad&state=${encodeURIComponent(nonce)}`);
    const req = new Request(url.toString());
    const res = await oauth.handleGbpCallback(req, env);
    expect([302, 303, 400, 502]).toContain(res.status);
  });

  it('paramètre `error` Google présent → redirect error sans appel token', async () => {
    const env = makeEnv();
    const url = new URL('https://app.intralys.dev/api/gbp/oauth/callback?error=access_denied&state=xxx');
    const req = new Request(url.toString());
    const res = await oauth.handleGbpCallback(req, env);
    expect([302, 303, 400, 403]).toContain(res.status);
    expect((global.fetch as any).mock.calls.length).toBe(0);
  });
});
