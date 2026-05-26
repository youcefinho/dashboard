// ── Sprint 25 — Perf : helper Cache API Cloudflare Workers ─────────────────
// Best-effort STRICT (never throws). Calque request-metrics.ts (try/catch global
// swallow). PAS de KV requis — Cache API native via caches.default suffit pour
// les catalogues lecture seule TTL court (5min max recommandé).
//
// Clé = Request canonique. TTL via header Cache-Control: max-age=N côté put.
// L'invalidation se fait via cacheBust(req) sur les mutations, OU naturellement
// par expiration TTL.

function getCache(): Cache | null {
  try {
    const c = (caches as unknown as { default?: Cache }).default;
    return c ?? null;
  } catch {
    return null;
  }
}

/** Lit la réponse mise en cache pour la requête. null si miss/erreur. */
export async function cacheGet(req: Request): Promise<Response | null> {
  try {
    const c = getCache();
    if (!c) return null;
    const hit = await c.match(req);
    return hit ?? null;
  } catch {
    return null;
  }
}

/**
 * Persiste une copie de la réponse avec TTL. Mute le header Cache-Control
 * pour fixer max-age. Best-effort : silent si caches indispo.
 * À appeler via `ctx.waitUntil(cachePut(...))` pour ne PAS bloquer.
 */
export async function cachePut(req: Request, res: Response, ttlSec: number): Promise<void> {
  try {
    const c = getCache();
    if (!c) return;
    const cloned = res.clone();
    const headers = new Headers(cloned.headers);
    headers.set('Cache-Control', `public, max-age=${Math.max(0, Math.floor(ttlSec))}`);
    const cacheable = new Response(cloned.body, {
      status: cloned.status,
      statusText: cloned.statusText,
      headers,
    });
    await c.put(req, cacheable);
  } catch {
    /* never throws */
  }
}

/** Invalide une clé de cache (lecture suivante → miss). */
export async function cacheBust(req: Request): Promise<void> {
  try {
    const c = getCache();
    if (!c) return;
    await c.delete(req);
  } catch {
    /* never throws */
  }
}
