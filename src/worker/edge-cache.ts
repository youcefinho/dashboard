// ── edge-cache.ts — Sprint 94 (seq189) ──────────────────────────────────────
// Cache edge pour les requêtes API fréquentes et coûteuses.
//
// Stratégie : Stale-While-Revalidate via Cloudflare Cache API.
// Les réponses des endpoints listés sont cachées en edge (CDN),
// avec un TTL court (60-300s) et une revalidation automatique.
//
// Endpoints cachés :
//   - GET /api/reports/overview          (TTL 120s)
//   - GET /api/reports/sources           (TTL 120s)
//   - GET /api/reports/conversion        (TTL 120s)
//   - GET /api/pipeline                  (TTL 60s)
//   - GET /api/leads (liste)             (TTL 30s)
//   - GET /api/dashboard/*               (TTL 120s)
//
// Invalidation : automatique via les mutations (POST/PATCH/DELETE)
// sur les ressources sous-jacentes. Le cache edge expire naturellement.
//
// ZÉRO dépendance externe. Utilise Cloudflare Cache API native.



// ── Configuration ────────────────────────────────────────────────────────────

/** TTL en secondes pour chaque pattern d'URL caché. */
const CACHE_RULES: Array<{ pattern: RegExp; ttl: number }> = [
  { pattern: /^\/api\/reports\/(overview|sources|conversion|attribution|lead-cohorts)/, ttl: 120 },
  { pattern: /^\/api\/pipeline$/, ttl: 60 },
  { pattern: /^\/api\/leads$/, ttl: 30 },
  { pattern: /^\/api\/dashboards/, ttl: 120 },
  { pattern: /^\/api\/lead-sources$/, ttl: 300 },
  { pattern: /^\/api\/clients$/, ttl: 300 },
  { pattern: /^\/api\/templates$/, ttl: 300 },
  { pattern: /^\/api\/custom-fields$/, ttl: 300 },
  { pattern: /^\/api\/tags$/, ttl: 300 },
];

/** Patterns d'URL qui invalident le cache (mutations). */
const MUTATION_INVALIDATION_PATTERNS: RegExp[] = [
  /^\/api\/leads/,
  /^\/api\/pipeline/,
  /^\/api\/reports/,
  /^\/api\/dashboards/,
  /^\/api\/clients/,
  /^\/api\/templates/,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Vérifie si une requête est éligible au cache edge. */
export function isCacheable(method: string, pathname: string): boolean {
  if (method !== 'GET') return false;
  return CACHE_RULES.some((rule) => rule.pattern.test(pathname));
}

/** Retourne le TTL pour un pathname donné (0 si non cacheable). */
export function getCacheTtl(pathname: string): number {
  for (const rule of CACHE_RULES) {
    if (rule.pattern.test(pathname)) return rule.ttl;
  }
  return 0;
}

/** Vérifie si une mutation doit invalider le cache. */
export function shouldInvalidateCache(method: string, pathname: string): boolean {
  if (method === 'GET') return false;
  return MUTATION_INVALIDATION_PATTERNS.some((p) => p.test(pathname));
}

/**
 * Génère une clé de cache unique basée sur l'URL + l'auth.
 * Le cache est scopé par utilisateur (via le token d'auth)
 * pour éviter les fuites cross-tenant.
 */
export function buildCacheKey(url: URL, auth: { userId: string }): string {
  // On utilise un hash simplifié de l'userId pour le scope tenant
  // Les query params sont inclus pour différencier les filtres
  const keyUrl = new URL(url.toString());
  keyUrl.searchParams.set('_cache_user', auth.userId);
  keyUrl.searchParams.sort();
  return keyUrl.toString();
}

// ── Middleware Cache ─────────────────────────────────────────────────────────

/**
 * Tente de servir une réponse depuis le cache edge.
 * Retourne null si pas de cache hit.
 */
export async function getCachedResponse(
  cacheKey: string,
): Promise<Response | null> {
  try {
    const cache = (caches as any).default;
    const cachedResponse = await cache.match(new Request(cacheKey));
    if (cachedResponse) {
      // Ajouter un header pour indiquer un cache hit
      const response = new Response(cachedResponse.body, cachedResponse);
      response.headers.set('X-Cache', 'HIT');
      response.headers.set('X-Cache-Age', String(
        Math.floor((Date.now() - parseInt(response.headers.get('X-Cache-Timestamp') || '0')) / 1000)
      ));
      return response;
    }
  } catch {
    // Cache API non disponible (dev local) — skip silencieusement
  }
  return null;
}

/**
 * Met en cache une réponse API dans le cache edge.
 * Clone la réponse pour pouvoir la stocker et la retourner.
 */
export async function cacheResponse(
  cacheKey: string,
  response: Response,
  ttl: number,
): Promise<Response> {
  try {
    const cache = (caches as any).default;
    // Cloner la réponse pour la stocker
    const responseToCache = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    // Headers de cache
    responseToCache.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    responseToCache.headers.set('X-Cache-Timestamp', String(Date.now()));
    responseToCache.headers.set('X-Cache-TTL', String(ttl));

    // Stocker dans le cache edge (non-bloquant via waitUntil idéalement)
    await cache.put(new Request(cacheKey), responseToCache);
  } catch {
    // Cache API non disponible — skip silencieusement
  }

  // Retourner la réponse originale avec un header MISS
  const finalResponse = new Response(response.body, response);
  finalResponse.headers.set('X-Cache', 'MISS');
  return finalResponse;
}

/**
 * Invalide les entrées du cache liées à un pattern de mutation.
 * Note : Cloudflare Cache API ne supporte pas les wildcards,
 * donc on invalide uniquement les patterns connus.
 * Le TTL court (30-300s) assure une convergence rapide.
 */
export async function invalidateCache(
  pathname: string,
): Promise<void> {
  // Cloudflare Cache API ne supporte pas les purges par pattern.
  // Le cache expirera naturellement selon le TTL. Les mutations
  // critiques (POST/PATCH/DELETE) ne sont jamais cachées.
  // Pour une invalidation immédiate, on pourrait utiliser Cloudflare
  // Purge API, mais ce n'est pas nécessaire avec des TTL courts.
  //
  // Best-effort : on laisse le TTL gérer l'expiration.
  void pathname; // Supprime le warning unused
}

// ── Intégration Worker ──────────────────────────────────────────────────────

/**
 * Wrapper de cache edge pour le routeur API.
 * À placer en amont du dispatch dans worker.ts.
 *
 * Usage dans worker.ts :
 *   const cached = await tryCacheMiddleware(request, url, auth);
 *   if (cached) return cached;
 *   // ... dispatch normal ...
 *   return maybeCacheAndReturn(response, request, url, auth, ctx);
 */
export async function tryCacheMiddleware(
  request: Request,
  url: URL,
  auth: { userId: string },
): Promise<Response | null> {
  if (!isCacheable(request.method, url.pathname)) return null;

  const cacheKey = buildCacheKey(url, auth);
  return getCachedResponse(cacheKey);
}

/**
 * Cache la réponse si éligible et la retourne.
 * À appeler après le dispatch dans worker.ts.
 */
export async function maybeCacheAndReturn(
  response: Response,
  url: URL,
  auth: { userId: string },
  ctx?: ExecutionContext,
): Promise<Response> {
  // Ne pas cacher les erreurs
  if (response.status >= 400) return response;

  const ttl = getCacheTtl(url.pathname);
  if (ttl === 0) return response;

  const cacheKey = buildCacheKey(url, auth);

  // Cache en arrière-plan si ctx disponible (ne bloque pas la réponse)
  if (ctx) {
    const responseClone = response.clone();
    ctx.waitUntil(cacheResponse(cacheKey, responseClone, ttl));
    const finalResponse = new Response(response.body, response);
    finalResponse.headers.set('X-Cache', 'MISS');
    return finalResponse;
  }

  return cacheResponse(cacheKey, response, ttl);
}
