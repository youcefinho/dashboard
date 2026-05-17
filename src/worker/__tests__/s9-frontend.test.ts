// ── s9-frontend.test.ts — Sprint S9 Phase B (Manager C) ─────────────────────
//
// Couvre le scope FRONT délégué §7 docs/PERF-S9.md :
//   1. src/lib/api.ts → getClientLeads : pagination opt-in additive.
//      - sans limit/offset : URL SANS limit/offset, `.data` lu (rétro-compat).
//      - avec {limit,offset} : query `limit=&offset=`, `.data` toujours lu.
//      - réponse sans `total` reste valide (rétro-compat byte).
//      - réponse avec total/limit/offset : champs additifs typés exposés.
//   2. Câblage telemetry : initWebVitalsWithAlerts (webVitals.ts, FIGÉ — non
//      modifié) déclenche bien un POST/beacon vers /api/telemetry/web-vitals.
//      On teste le CONTRAT de câblage (main.tsx utilise ce helper), pas le
//      module webVitals.ts qui reste lecture seule.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Placement : src/worker/__tests__/ → collecté par vitest.config.ts glob
// `src/worker/__tests__/**/*.test.ts` (environment: node). Aucune extension
// de vitest.config.ts requise. Les globals navigateur (fetch, localStorage,
// navigator, window) sont stubbés via vi.stubGlobal. @capacitor/core est mocké
// (api.ts l'importe au top-level pour API_BASE).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @capacitor/core : api.ts l'importe pour décider API_BASE ───────────
// Plateforme web → API_BASE = '/api' (chemin relatif, pas d'URL absolue).
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// ── Stubs globals (env node : pas de window/localStorage/fetch natifs) ──────
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
    location: { href: '', hostname: 'app.intralys.ca', pathname: '/dashboard' },
    matchMedia: undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ── 1. getClientLeads — pagination opt-in additive ─────────────────────────

describe('S9 front — getClientLeads rétro-compat (sans limit/offset)', () => {
  it('aucun param : URL SANS limit/offset, lit `.data`', async () => {
    const { getClientLeads } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ data: [{ id: 'l1' }, { id: 'l2' }] });

    const res = await getClientLeads('client-1');

    expect(fetchCalls).toHaveLength(1);
    const u = fetchCalls[0].url;
    expect(u).toBe('/api/clients/client-1/leads');
    expect(u).not.toContain('limit');
    expect(u).not.toContain('offset');
    expect(u).not.toContain('?'); // query string totalement absente
    // Contrat .data inchangé.
    expect(res.data).toEqual([{ id: 'l1' }, { id: 'l2' }]);
  });

  it('filtres status/type/search conservés, toujours SANS limit/offset', async () => {
    const { getClientLeads } = await import('../../lib/api');
    await getClientLeads('client-1', { status: 'new', type: 'inbound', search: 'jean' });

    const u = fetchCalls[0].url;
    expect(u).toContain('status=new');
    expect(u).toContain('type=inbound');
    expect(u).toContain('search=jean');
    expect(u).not.toContain('limit=');
    expect(u).not.toContain('offset=');
  });

  it('réponse sans `total` reste valide (rétro-compat byte, `.data` lu)', async () => {
    const { getClientLeads } = await import('../../lib/api');
    fetchImpl = async () => makeJsonResponse({ data: [{ id: 'x' }] }); // pas de total/limit/offset

    const res = await getClientLeads('client-1');
    expect(res.data).toEqual([{ id: 'x' }]);
    expect(res.total).toBeUndefined();
    expect(res.limit).toBeUndefined();
    expect(res.offset).toBeUndefined();
    expect(res.error).toBeUndefined();
  });
});

describe('S9 front — getClientLeads pagination opt-in', () => {
  it('{limit:20, offset:40} : query `limit=20&offset=40`, `.data` toujours lu', async () => {
    const { getClientLeads } = await import('../../lib/api');
    fetchImpl = async () =>
      makeJsonResponse({ data: [{ id: 'l1' }], total: 57, limit: 20, offset: 40 });

    const res = await getClientLeads('client-1', { limit: 20, offset: 40 });

    const u = fetchCalls[0].url;
    expect(u).toContain('limit=20');
    expect(u).toContain('offset=40');
    // `.data` lu par défaut (contrat inchangé).
    expect(res.data).toEqual([{ id: 'l1' }]);
    // Champs additifs exposés via la variante typée optionnelle.
    expect(res.total).toBe(57);
    expect(res.limit).toBe(20);
    expect(res.offset).toBe(40);
  });

  it('offset:0 (valeur falsy mais définie) est bien émis', async () => {
    const { getClientLeads } = await import('../../lib/api');
    await getClientLeads('client-1', { offset: 0 });
    const u = fetchCalls[0].url;
    // Garde `!== undefined` (pas truthy) : offset=0 doit apparaître.
    expect(u).toContain('offset=0');
  });

  it('limit:0 (valeur falsy mais définie) est bien émis', async () => {
    const { getClientLeads } = await import('../../lib/api');
    await getClientLeads('client-1', { limit: 0 });
    expect(fetchCalls[0].url).toContain('limit=0');
  });

  it('filtres + pagination cumulables', async () => {
    const { getClientLeads } = await import('../../lib/api');
    await getClientLeads('client-1', { status: 'won', limit: 10, offset: 5 });
    const u = fetchCalls[0].url;
    expect(u).toContain('status=won');
    expect(u).toContain('limit=10');
    expect(u).toContain('offset=5');
  });
});

// ── 2. Câblage telemetry — initWebVitalsWithAlerts → beacon ────────────────
// webVitals.ts est FIGÉ : on ne le modifie pas, on prouve seulement que son
// API publique (utilisée par main.tsx) POST bien vers la route de A.

describe('S9 front — câblage Web Vitals → /api/telemetry/web-vitals', () => {
  it('reportToBackend POST sur /api/telemetry/web-vitals (sendBeacon prioritaire)', async () => {
    const beaconCalls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('navigator', {
      sendBeacon: (url: string, body: unknown) => {
        beaconCalls.push({ url, body });
        return true;
      },
    });
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[], public opts: unknown) {} });

    const { reportToBackend } = await import('../../lib/webVitals');
    reportToBackend({
      name: 'LCP',
      value: 2400,
      rating: 'good',
      delta: 0,
      id: 'sess-1',
      navigationType: '/dashboard',
    });

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0].url).toBe('/api/telemetry/web-vitals');
  });

  it('sans sendBeacon : fallback fetch POST keepalive sur la même route', async () => {
    vi.stubGlobal('navigator', {}); // pas de sendBeacon
    const { reportToBackend } = await import('../../lib/webVitals');

    reportToBackend({
      name: 'CLS',
      value: 0.05,
      rating: 'good',
      delta: 0.05,
      id: 'sess-2',
      navigationType: '/dashboard',
    });

    const post = fetchCalls.find((c) => c.url === '/api/telemetry/web-vitals');
    expect(post).toBeDefined();
    expect(post!.init?.method).toBe('POST');
    expect((post!.init as RequestInit & { keepalive?: boolean })?.keepalive).toBe(true);
  });

  it('initWebVitalsWithAlerts est exporté et appelable (helper câblé par main.tsx)', async () => {
    // main.tsx:128-131 importe et appelle initWebVitalsWithAlerts({}).
    // SSR-safe : sans PerformanceObserver → no-op interne, pas de throw.
    vi.stubGlobal('navigator', { sendBeacon: () => true });
    const mod = await import('../../lib/webVitals');
    expect(typeof mod.initWebVitalsWithAlerts).toBe('function');
    expect(() => mod.initWebVitalsWithAlerts({})).not.toThrow();
  });
});
