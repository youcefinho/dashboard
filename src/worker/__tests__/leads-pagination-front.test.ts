// ── leads-pagination-front.test.ts — LOT RÉEL Phase B (Manager B) ───────────
//
// Couvre le scope FRONT délégué docs/LOT-REEL.md §6.A :
//   1. src/lib/api.ts → getLeads : pagination CURSEUR opt-in additive.
//      - sans limit/cursor : URL SANS limit/cursor, `.data` lu (rétro-compat
//        byte-identique avec le comportement actuel — appelants Dashboard/
//        Reports/Documents/Clients/Sidebar/AppLayout/CommandPalette intacts).
//      - avec {limit,cursor} : query `limit=&cursor=` transmis tels quels,
//        `.data` toujours lu, `next_cursor` exposé (champ additif).
//      - réponse sans `next_cursor` reste valide (plus de page).
//   2. src/lib/api.ts → getAiStatus : GET /api/health, lit `.ai_mock`.
//      - ai_mock:true → { ai_mock:true } ; absent/KO → { ai_mock:false }
//        (défaut prudent : pas de bannière démo si on ne sait pas).
//
// ⚠ NE PAS confondre avec getClientLeads (S9, offset-based) — cf
//   s9-frontend.test.ts. Curseur ≠ offset, contrats distincts.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Placement : src/worker/__tests__/ → collecté par vitest.config.ts glob
// `src/worker/__tests__/**/*.test.ts` (environment: node). Pattern calqué
// sur s9-frontend.test.ts (stubs globals + mock @capacitor/core).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @capacitor/core : api.ts l'importe pour décider API_BASE ───────────
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// ── Stubs globals (env node) ───────────────────────────────────────────────
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async () => makeJsonResponse({ data: [] });

  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });

  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  }));

  vi.stubGlobal('window', {
    location: { href: '', hostname: 'app.intralys.ca', pathname: '/leads' },
    matchMedia: undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ── 1. getLeads — rétro-compat (sans limit/cursor) ─────────────────────────

describe('LOT RÉEL — getLeads rétro-compat (sans limit/cursor)', () => {
  it('aucun param : URL SANS limit/cursor, lit `.data`', async () => {
    const { getLeads } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ data: [{ id: 'l1' }, { id: 'l2' }] });

    const res = await getLeads();

    expect(fetchCalls).toHaveLength(1);
    const u = fetchCalls[0].url;
    expect(u).toBe('/api/leads');
    expect(u).not.toContain('limit');
    expect(u).not.toContain('cursor');
    expect(u).not.toContain('?'); // query string totalement absente
    // Contrat `.data` inchangé (byte-identique au comportement actuel).
    expect(res.data).toEqual([{ id: 'l1' }, { id: 'l2' }]);
  });

  it('filtres existants conservés, toujours SANS limit/cursor', async () => {
    const { getLeads } = await import('../../lib/api');
    await getLeads({ status: 'new', search: 'jean', source: 'facebook', client_id: 'c1' });

    const u = fetchCalls[0].url;
    expect(u).toContain('status=new');
    expect(u).toContain('search=jean');
    expect(u).toContain('source=facebook');
    expect(u).toContain('client_id=c1');
    expect(u).not.toContain('limit=');
    expect(u).not.toContain('cursor=');
  });

  it('réponse sans `next_cursor` reste valide (rétro-compat, `.data` lu)', async () => {
    const { getLeads } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ data: [{ id: 'x' }] }); // pas de next_cursor

    const res = await getLeads();
    expect(res.data).toEqual([{ id: 'x' }]);
    expect(res.next_cursor).toBeUndefined();
    expect(res.error).toBeUndefined();
  });
});

// ── getLeads — pagination curseur opt-in ───────────────────────────────────

describe('LOT RÉEL — getLeads pagination curseur opt-in', () => {
  it('{limit:25, cursor:"abc"} : query transmis, `.data` lu, next_cursor exposé', async () => {
    const { getLeads } = await import('../../lib/api');
    fetchImpl = async () =>
      makeJsonResponse({ data: [{ id: 'l3' }], next_cursor: 'def456' });

    const res = await getLeads({ limit: 25, cursor: 'abc' });

    const u = fetchCalls[0].url;
    expect(u).toContain('limit=25');
    expect(u).toContain('cursor=abc');
    // `.data` lu par défaut (contrat inchangé).
    expect(res.data).toEqual([{ id: 'l3' }]);
    // Champ additif curseur exposé.
    expect(res.next_cursor).toBe('def456');
  });

  it('next_cursor:null ⇒ exposé tel quel (signale fin de pagination)', async () => {
    const { getLeads } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ data: [{ id: 'last' }], next_cursor: null });

    const res = await getLeads({ cursor: 'tail' });
    expect(res.data).toEqual([{ id: 'last' }]);
    expect(res.next_cursor).toBeNull();
  });

  it('limit:0 (falsy mais défini) est bien émis', async () => {
    const { getLeads } = await import('../../lib/api');
    await getLeads({ limit: 0 });
    expect(fetchCalls[0].url).toContain('limit=0');
  });

  it('filtres + curseur cumulables', async () => {
    const { getLeads } = await import('../../lib/api');
    await getLeads({ status: 'won', limit: 10, cursor: 'pg2' });
    const u = fetchCalls[0].url;
    expect(u).toContain('status=won');
    expect(u).toContain('limit=10');
    expect(u).toContain('cursor=pg2');
  });
});

// ── 2. getAiStatus — lit /api/health .ai_mock ──────────────────────────────

describe('LOT RÉEL — getAiStatus (/api/health .ai_mock)', () => {
  it('ai_mock:true → { ai_mock:true }, GET /api/health', async () => {
    const { getAiStatus } = await import('../../lib/api');
    fetchImpl = async () =>
      makeJsonResponse({ status: 'ok', db: 'ok', ai_mock: true });

    const res = await getAiStatus();
    expect(fetchCalls[0].url).toBe('/api/health');
    expect(res).toEqual({ ai_mock: true });
  });

  it('ai_mock:false → { ai_mock:false }', async () => {
    const { getAiStatus } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ status: 'ok', ai_mock: false });
    expect(await getAiStatus()).toEqual({ ai_mock: false });
  });

  it('champ ai_mock absent → défaut prudent { ai_mock:false }', async () => {
    const { getAiStatus } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ status: 'ok', db: 'ok' });
    expect(await getAiStatus()).toEqual({ ai_mock: false });
  });

  it('réponse erreur (503) → défaut prudent { ai_mock:false }', async () => {
    const { getAiStatus } = await import('../../lib/api');
    fetchImpl = async () =>
      makeJsonResponse({ status: 'error', error: 'db down' }, 503);
    expect(await getAiStatus()).toEqual({ ai_mock: false });
  });

  it('valeur non-booléenne (truthy) NON traitée comme true (=== true strict)', async () => {
    const { getAiStatus } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ ai_mock: 'true' });
    expect(await getAiStatus()).toEqual({ ai_mock: false });
  });
});
