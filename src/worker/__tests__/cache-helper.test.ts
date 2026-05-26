// ── cache-helper.test.ts — Sprint 25 (Manager-B) ─────────────────────────
//
// Couvre src/worker/lib/cache.ts : cacheGet / cachePut / cacheBust.
//
// Stratégie de mock : on patch `globalThis.caches` (Cache API Cloudflare). Le
// helper lit `caches.default` via `(caches as { default?: Cache }).default`.
// Trois cas couverts : (1) cache présent qui round-trip Request → Response,
// (2) cache absent (helpers → never throws), (3) injection du header
// Cache-Control max-age côté put.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement. Glob : src/worker/__tests__/**/*.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cacheGet, cachePut, cacheBust } from '../lib/cache';

// ── In-memory cache mock (calque l'API Cloudflare Cache) ──────────────────
// keyForRequest(req) doit être stable (string) — on prend req.url.
function createInMemoryCache(): {
  cache: { match: (req: Request) => Promise<Response | undefined>; put: (req: Request, res: Response) => Promise<void>; delete: (req: Request) => Promise<boolean> };
  store: Map<string, Response>;
} {
  const store = new Map<string, Response>();
  const cache = {
    async match(req: Request): Promise<Response | undefined> {
      const stored = store.get(req.url);
      // Le helper `cachePut` clone la réponse côté put ; ici on re-clone à la
      // lecture pour autoriser plusieurs lectures successives.
      return stored ? stored.clone() : undefined;
    },
    async put(req: Request, res: Response): Promise<void> {
      // Cloudflare clone l'input ; on stocke tel quel (le helper a déjà cloné
      // ET ré-emballé pour injecter le header Cache-Control).
      store.set(req.url, res);
    },
    async delete(req: Request): Promise<boolean> {
      return store.delete(req.url);
    },
  };
  return { cache, store };
}

// Sauvegarde / restauration de `globalThis.caches` (peut être undefined côté
// vitest node).
const originalCaches: unknown = (globalThis as unknown as { caches?: unknown }).caches;

function setCachesDefault(c: unknown): void {
  (globalThis as unknown as { caches: { default?: unknown } }).caches = { default: c };
}

function unsetCaches(): void {
  (globalThis as unknown as { caches?: unknown }).caches = undefined;
}

function restoreCaches(): void {
  (globalThis as unknown as { caches?: unknown }).caches = originalCaches;
}

describe('Sprint 25 — cache helper (Cache API best-effort)', () => {
  afterEach(() => {
    restoreCaches();
  });

  it('cacheGet retourne null quand cache vide (miss)', async () => {
    const { cache } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/test', { method: 'GET' });
    const hit = await cacheGet(req);
    expect(hit).toBeNull();
  });

  it('cachePut puis cacheGet même Request → hit', async () => {
    const { cache, store } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/billing/plans?tenant=t1', { method: 'GET' });
    const body = JSON.stringify({ plans: ['starter', 'pro'] });
    const res = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

    await cachePut(req, res, 300);
    expect(store.size).toBe(1);

    const hit = await cacheGet(req);
    expect(hit).not.toBeNull();
    expect(hit!.status).toBe(200);
    const hitBody = await hit!.text();
    expect(hitBody).toBe(body);
  });

  it('cacheBust après put → miss à la lecture suivante', async () => {
    const { cache, store } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/capabilities?user=u1', { method: 'GET' });
    const res = new Response(JSON.stringify({ caps: ['read'] }), { status: 200 });

    await cachePut(req, res, 30);
    expect(store.size).toBe(1);

    await cacheBust(req);
    expect(store.size).toBe(0);

    const hit = await cacheGet(req);
    expect(hit).toBeNull();
  });

  it('best-effort never-throws quand caches.default undefined', async () => {
    unsetCaches();
    const req = new Request('https://cache.local/test', { method: 'GET' });

    // Les 3 helpers doivent résoudre sans throw même sans Cache API.
    await expect(cacheGet(req)).resolves.toBeNull();
    await expect(cachePut(req, new Response('x'), 60)).resolves.toBeUndefined();
    await expect(cacheBust(req)).resolves.toBeUndefined();
  });

  it('best-effort never-throws quand caches.default lui-même = undefined', async () => {
    setCachesDefault(undefined);
    const req = new Request('https://cache.local/test', { method: 'GET' });

    await expect(cacheGet(req)).resolves.toBeNull();
    await expect(cachePut(req, new Response('x'), 60)).resolves.toBeUndefined();
    await expect(cacheBust(req)).resolves.toBeUndefined();
  });

  it('cachePut injecte le header Cache-Control: public, max-age=N', async () => {
    const { cache, store } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/observability/request-metrics?tenant=t1&period=24h', { method: 'GET' });
    // Pas de Cache-Control côté input : le helper doit le poser.
    const res = new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await cachePut(req, res, 60);
    const stored = store.get(req.url);
    expect(stored).toBeDefined();
    expect(stored!.headers.get('Cache-Control')).toBe('public, max-age=60');
    // Vérifie aussi que le content-type d'origine est préservé.
    expect(stored!.headers.get('Content-Type')).toBe('application/json');
  });

  it('cachePut override un Cache-Control existant côté input', async () => {
    const { cache, store } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/test', { method: 'GET' });
    const res = new Response('x', {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });

    await cachePut(req, res, 120);
    const stored = store.get(req.url);
    expect(stored).toBeDefined();
    expect(stored!.headers.get('Cache-Control')).toBe('public, max-age=120');
  });

  it('cachePut clamp les TTL négatifs à 0 (pas de max-age négatif)', async () => {
    const { cache, store } = createInMemoryCache();
    setCachesDefault(cache);
    const req = new Request('https://cache.local/test', { method: 'GET' });
    const res = new Response('x', { status: 200 });

    await cachePut(req, res, -5);
    const stored = store.get(req.url);
    expect(stored).toBeDefined();
    expect(stored!.headers.get('Cache-Control')).toBe('public, max-age=0');
  });
});

// ── Garde-fou TS : on n'importe rien de fragile / on consomme `beforeEach`
//    pour rester aligné avec les autres suites du repo.
beforeEach(() => {
  // no-op — placeholder pour future fixture commune.
});
