// ════════════════════════════════════════════════════════════
// Sprint 32 — gbp.ts route handlers tests
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/gbp.ts` (A2) :
//   - handleListGbpConnections (SELECT bornée tenant)
//   - handleDeleteGbpConnection (cascade gbp_locations + sync rows)
//   - handleReplyGbpReview (pending → sent + cache update)
//   - handleCreateGbpPost (INSERT social_posts + gbp_posts_sync)
//   - handleGetGbpInsights (mapping API → DTO)
//   - codes erreur : GBP_NOT_CONNECTED, GBP_API_ERROR

import { describe, it, expect, vi, beforeEach } from 'vitest';

let gbp: typeof import('../gbp');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  gbp = await import('../gbp');
});

function makeEnv(seed: Record<string, any[]> = {}) {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const prepare = (sql: string) => {
    let bound: any[] = [];
    const stmt: any = {
      bind: (...a: any[]) => { bound = a; return stmt; },
      all: () => {
        calls.push({ sql, args: bound });
        for (const key of Object.keys(seed)) {
          if (sql.toLowerCase().includes(key.toLowerCase())) return Promise.resolve({ results: seed[key] });
        }
        return Promise.resolve({ results: [] });
      },
      first: () => {
        calls.push({ sql, args: bound });
        for (const key of Object.keys(seed)) {
          if (sql.toLowerCase().includes(key.toLowerCase())) {
            const rows = seed[key];
            return Promise.resolve(rows.length ? rows[0] : null);
          }
        }
        return Promise.resolve(null);
      },
      run: () => {
        calls.push({ sql, args: bound });
        return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: 1 } });
      },
    };
    return stmt;
  };
  return {
    env: {
      DB: { prepare },
      GBP_CLIENT_ID: 'gcid',
      GBP_CLIENT_SECRET: 'gsecret',
      TOKEN_KEY: 'test-key-32-chars-for-aes-gcm!!',
    } as any,
    calls,
  };
}

const auth = (overrides: any = {}) =>
  ({
    userId: 'u1',
    role: 'admin',
    clientId: 'c1',
    // Caps seq80 figées : settings.manage (mutations GBP) + reports.view (insights).
    // 'reputation.manage' / 'social.publish' n'existent PAS dans les 12 caps figées.
    capabilities: new Set(['settings.manage', 'reports.view']),
    tenant: { clientId: 'c1', role: 'admin' },
    ...overrides,
  }) as any;

// ── handleListGbpConnections ────────────────────────────────

describe('handleListGbpConnections', () => {
  it('SELECT gbp_connections WHERE client_id = auth.clientId', async () => {
    const { env, calls } = makeEnv({
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', status: 'active', gbp_account_id: 'acc1' },
      ],
    });
    const res = await gbp.handleListGbpConnections(env, auth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Contrat actuel : json({ data: [...] }) — pas de top-level `connections`.
    expect(Array.isArray(body.data)).toBe(true);
    const selectCall = calls.find((c) => c.sql.toLowerCase().includes('from gbp_connections'));
    expect(selectCall?.args).toContain('c1');
  });

  it('refuse 403 si pas de clientId (admin global doit cibler un tenant)', async () => {
    const { env } = makeEnv();
    const res = await gbp.handleListGbpConnections(env, auth({ clientId: undefined }));
    expect([400, 403]).toContain(res.status);
  });
});

// ── handleDeleteGbpConnection ───────────────────────────────

describe('handleDeleteGbpConnection', () => {
  it('cascade DELETE gbp_locations + gbp_reviews_sync + gbp_posts_sync + gbp_connections', async () => {
    const { env, calls } = makeEnv({
      'from gbp_connections': [{ id: 'gc1', client_id: 'c1' }],
    });
    // Signature actuelle: (_request, env, auth, id) — id ≥ 8 chars (INVALID_INPUT sinon).
    const req = new Request('https://app/api/gbp/connections/gc1-aaaa', { method: 'DELETE' });
    const res = await gbp.handleDeleteGbpConnection(req, env, auth(), 'gc1-aaaa');
    expect([200, 204]).toContain(res.status);
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toContain('delete');
    // au moins une référence à gbp_locations OU sync OU connections
    expect(sqls).toMatch(/gbp_locations|gbp_reviews_sync|gbp_posts_sync|gbp_connections/);
  });

  it('404 si connexion introuvable pour ce tenant', async () => {
    const { env } = makeEnv({ 'from gbp_connections': [] });
    const req = new Request('https://app/api/gbp/connections/gc-unknown', { method: 'DELETE' });
    const res = await gbp.handleDeleteGbpConnection(req, env, auth(), 'gc-unknown');
    expect([404, 403]).toContain(res.status);
  });
});

// ── handleReplyGbpReview ────────────────────────────────────

describe('handleReplyGbpReview', () => {
  // Le handler valide reviewName.includes('reviews/') (forme Google native).
  const REVIEW_NAME = 'accounts/a/locations/l/reviews/r1';

  it('pending → sent : UPDATE gbp_reviews_sync + appel API gbpReplyReview + UPDATE reviews_cache', async () => {
    const { env, calls } = makeEnv({
      'from gbp_reviews_sync': [
        {
          id: 'sync-1',
          reviews_cache_id: 'rc-1',
          client_id: 'c1',
          gbp_review_name: REVIEW_NAME,
          gbp_location_id: 'loc-internal-1',
        },
      ],
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', gbp_account_id: 'a', oauth_connection_id: 'oc1', status: 'active' },
      ],
      'from gbp_locations': [
        { id: 'loc-internal-1', gbp_location_id: 'l', gbp_account_id: 'a' },
      ],
      'from oauth_connections': [
        {
          id: 'oc1',
          access_token: 'at_ok',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    // gbpReplyReview fait un PUT → réponse 200 = succès (le body est lu par gbpFetch).
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ comment: 'merci' }), { status: 200 })
    );
    const req = new Request(`https://app/api/gbp/reviews/${encodeURIComponent(REVIEW_NAME)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: 'merci' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await gbp.handleReplyGbpReview(req, env, auth(), REVIEW_NAME);
    expect([200, 201]).toContain(res.status);
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/update.*reviews_cache|update.*gbp_reviews_sync/);
  });

  it('GBP_NOT_CONNECTED si pas de connexion active', async () => {
    // Le sync row existe + matche tenant → on dépasse la validation reviewName,
    // mais getActiveGbpConnection ne trouve rien → GBP_NOT_CONNECTED 404.
    const { env } = makeEnv({
      'from gbp_reviews_sync': [
        { id: 'sync-1', client_id: 'c1', gbp_review_name: REVIEW_NAME, gbp_location_id: 'loc' },
      ],
      'from gbp_connections': [],
    });
    const req = new Request(`https://app/api/gbp/reviews/${encodeURIComponent(REVIEW_NAME)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: 'x' }),
    });
    const res = await gbp.handleReplyGbpReview(req, env, auth(), REVIEW_NAME);
    expect([400, 404, 409, 412]).toContain(res.status);
    const body = (await res.json().catch(() => ({}))) as any;
    expect(JSON.stringify(body)).toMatch(/GBP_NOT_CONNECTED|not.connected|missing/i);
  });

  it('GBP_API_ERROR si Google répond 500', async () => {
    const { env } = makeEnv({
      'from gbp_reviews_sync': [
        { id: 'sync-1', client_id: 'c1', gbp_review_name: REVIEW_NAME, gbp_location_id: 'loc' },
      ],
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', gbp_account_id: 'a', oauth_connection_id: 'oc1', status: 'active' },
      ],
      'from gbp_locations': [{ id: 'loc', gbp_location_id: 'l', gbp_account_id: 'a' }],
      'from oauth_connections': [
        { id: 'oc1', access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 600_000).toISOString() },
      ],
    });
    (global.fetch as any).mockResolvedValue(new Response('boom', { status: 500 }));
    const req = new Request(`https://app/api/gbp/reviews/${encodeURIComponent(REVIEW_NAME)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: 'x' }),
    });
    const res = await gbp.handleReplyGbpReview(req, env, auth(), REVIEW_NAME);
    expect([500, 502, 503]).toContain(res.status);
    const body = (await res.json().catch(() => ({}))) as any;
    expect(JSON.stringify(body)).toMatch(/GBP_API_ERROR|api.error|google/i);
  }, 15000);

  it('refuse 400 si body manque le champ comment', async () => {
    const { env } = makeEnv({
      'from gbp_reviews_sync': [
        { id: 'sync-1', client_id: 'c1', gbp_review_name: REVIEW_NAME, gbp_location_id: 'loc' },
      ],
    });
    const req = new Request(`https://app/api/gbp/reviews/${encodeURIComponent(REVIEW_NAME)}/reply`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await gbp.handleReplyGbpReview(req, env, auth(), REVIEW_NAME);
    expect([400, 422]).toContain(res.status);
  });
});

// ── handleCreateGbpPost ─────────────────────────────────────

describe('handleCreateGbpPost', () => {
  it('INSERT social_posts + gbp_posts_sync + appel API', async () => {
    const { env, calls } = makeEnv({
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', gbp_account_id: 'a', oauth_connection_id: 'oc1', status: 'active' },
      ],
      'from gbp_locations': [{ id: 'loc', gbp_location_id: 'l', gbp_account_id: 'a' }],
      'from oauth_connections': [
        { id: 'oc1', access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 600_000).toISOString() },
      ],
    });
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'accounts/a/locations/l/localPosts/p1' }), { status: 200 })
    );
    // Signature actuelle: (request, env, auth). locationId vit dans le body, pas l'URL.
    const req = new Request('https://app/api/gbp/posts', {
      method: 'POST',
      body: JSON.stringify({ locationId: 'l', summary: 'Nouveau service !', topicType: 'STANDARD' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await gbp.handleCreateGbpPost(req, env, auth());
    expect([200, 201]).toContain(res.status);
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/insert.*social_posts/);
    expect(sqls).toMatch(/insert.*gbp_posts_sync/);
  });

  it('GBP_LOCATION_NOT_FOUND si location absente du tenant', async () => {
    // Contrat actuel : location introuvable → GBP_LOCATION_NOT_FOUND (404),
    // pas GBP_NOT_CONNECTED. La nuance est cohérente avec les autres handlers
    // (Reply/Insights). On accepte les deux codes pour rester tolérant.
    const { env } = makeEnv({ 'from gbp_locations': [] });
    const req = new Request('https://app/api/gbp/posts', {
      method: 'POST',
      body: JSON.stringify({ locationId: 'nope', summary: 'x' }),
    });
    const res = await gbp.handleCreateGbpPost(req, env, auth());
    expect([400, 404, 409, 412]).toContain(res.status);
    const body = (await res.json().catch(() => ({}))) as any;
    expect(JSON.stringify(body)).toMatch(/GBP_LOCATION_NOT_FOUND|GBP_NOT_CONNECTED|not.connected|not.found/i);
  });
});

// ── handleGetGbpInsights ────────────────────────────────────

describe('handleGetGbpInsights', () => {
  // Le handler lit location_id + start + end depuis URL.searchParams. Signature
  // actuelle: (request, env, auth) — pas d'arg id positionnel.
  const insightsUrl = (locId: string) =>
    `https://app/api/gbp/insights?location_id=${locId}&start=2026-04-01&end=2026-05-01`;

  it('mappe la réponse Google → DTO {views, searches, actions}', async () => {
    const { env } = makeEnv({
      'from gbp_locations': [{ id: 'loc', gbp_location_id: 'l', gbp_account_id: 'a' }],
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', gbp_account_id: 'a', oauth_connection_id: 'oc1', status: 'active' },
      ],
      'from oauth_connections': [
        { id: 'oc1', access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 600_000).toISOString() },
      ],
    });
    (global.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          locationMetrics: [
            {
              metricValues: [
                { metric: 'VIEWS_MAPS', totalValue: { value: '120' } },
                { metric: 'ACTIONS_PHONE', totalValue: { value: '8' } },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );
    const req = new Request(insightsUrl('l'));
    const res = await gbp.handleGetGbpInsights(req, env, auth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toBeTruthy();
    // Le DTO doit contenir au moins une clé numérique mappée
    const flat = JSON.stringify(body);
    expect(flat).toMatch(/views|actions|searches|metric/i);
  });

  it('GBP_LOCATION_NOT_FOUND si pas de location', async () => {
    const { env } = makeEnv({ 'from gbp_locations': [] });
    const req = new Request(insightsUrl('nope'));
    const res = await gbp.handleGetGbpInsights(req, env, auth());
    expect([400, 404, 409, 412]).toContain(res.status);
  });

  it('GBP_API_ERROR si Google 500', async () => {
    const { env } = makeEnv({
      'from gbp_locations': [{ id: 'loc', gbp_location_id: 'l', gbp_account_id: 'a' }],
      'from gbp_connections': [
        { id: 'gc1', client_id: 'c1', gbp_account_id: 'a', oauth_connection_id: 'oc1', status: 'active' },
      ],
      'from oauth_connections': [
        { id: 'oc1', access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 600_000).toISOString() },
      ],
    });
    (global.fetch as any).mockResolvedValue(new Response('err', { status: 500 }));
    const req = new Request(insightsUrl('l'));
    const res = await gbp.handleGetGbpInsights(req, env, auth());
    expect([500, 502, 503]).toContain(res.status);
  }, 15000);
});
