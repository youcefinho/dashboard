// ── edge-cache-engine.ts — Sprint 94 (seq189) ──────────────────────────────
// Cache Edge & Optimisation CDN pour formulaires publics et widgets.
//
// Couvre :
//   - Construction de clés de cache canoniques (déterministes)
//   - Profils de cache par type de contenu
//   - Construction de headers Cache-Control + Vary + ETag
//   - Détection de staleness
//   - Clés de purge ciblée (invalidation)
//   - ETag basé sur SHA-256 tronqué
//
// ZÉRO I/O. Helpers purs (sauf buildETag qui utilise crypto.subtle).

// ── Profils de cache ──────────────────────────────────────────────────────

export const CACHE_PROFILES = Object.freeze({
  /** Formulaires publics : 5 min de cache Edge. */
  public_form: { ttlSec: 300, staleWhileRevalidate: 60, isPublic: true },
  /** Widgets chat/embed : 10 min de cache. */
  widget: { ttlSec: 600, staleWhileRevalidate: 120, isPublic: true },
  /** API authentifiée : jamais cachée. */
  api: { ttlSec: 0, staleWhileRevalidate: 0, isPublic: false },
  /** Assets statiques (images, CSS, JS) : 24h. */
  asset: { ttlSec: 86400, staleWhileRevalidate: 3600, isPublic: true },
  /** Pages de site builder : 15 min. */
  site_page: { ttlSec: 900, staleWhileRevalidate: 120, isPublic: true },
  /** Réponses storefront publiques : 2 min. */
  storefront: { ttlSec: 120, staleWhileRevalidate: 30, isPublic: true },
} as const);

export type CacheProfileName = keyof typeof CACHE_PROFILES;

export interface CacheProfile {
  ttlSec: number;
  staleWhileRevalidate: number;
  isPublic: boolean;
}

// ── Routes cachables ──────────────────────────────────────────────────────

/** Whitelist des chemins d'API pouvant être cachés. */
const CACHEABLE_PATH_PREFIXES: ReadonlyArray<{
  prefix: string;
  profile: CacheProfileName;
}> = [
  { prefix: '/api/public/forms/', profile: 'public_form' },
  { prefix: '/api/public/chat-widget/', profile: 'widget' },
  { prefix: '/api/public/sites/', profile: 'site_page' },
  { prefix: '/api/public/storefront/', profile: 'storefront' },
  { prefix: '/assets/', profile: 'asset' },
];

/** Détermine si une requête peut être cachée et retourne le profil associé.
 *  Seules les méthodes GET/HEAD sont cachables. */
export function shouldCache(
  method: string,
  path: string,
): { cacheable: boolean; profile?: CacheProfileName } {
  if (method !== 'GET' && method !== 'HEAD') {
    return { cacheable: false };
  }
  for (const entry of CACHEABLE_PATH_PREFIXES) {
    if (path.startsWith(entry.prefix)) {
      return { cacheable: true, profile: entry.profile };
    }
  }
  return { cacheable: false };
}

// ── Clé de cache canonique ────────────────────────────────────────────────

/** Construit une clé de cache canonique et déterministe.
 *  Les paramètres de query sont triés alphabétiquement pour garantir
 *  que la même ressource produit toujours la même clé. */
export function buildCacheKey(url: string, extraParams?: Record<string, string>): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL relative → on la préfixe
    parsed = new URL(url, 'https://cache.local');
  }

  // Fusionner les extra params
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      parsed.searchParams.set(k, v);
    }
  }

  // Trier les paramètres
  const sortedParams = new URLSearchParams(
    [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );

  // Reconstruire la clé sans origin (pour portabilité Edge)
  const paramStr = sortedParams.toString();
  return `${parsed.pathname}${paramStr ? '?' + paramStr : ''}`;
}

// ── Headers Cache-Control ─────────────────────────────────────────────────

export interface CacheHeadersOptions {
  /** Profil de cache à utiliser. */
  profile: CacheProfileName;
  /** ETag optionnel pour revalidation 304. */
  etag?: string;
  /** Headers Vary supplémentaires. */
  vary?: string[];
}

/** Construit les headers HTTP de cache selon le profil. */
export function buildCacheHeaders(options: CacheHeadersOptions): Record<string, string> {
  const config = CACHE_PROFILES[options.profile];
  const headers: Record<string, string> = {};

  if (config.ttlSec === 0) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
  } else {
    const parts: string[] = [];
    parts.push(config.isPublic ? 'public' : 'private');
    parts.push(`max-age=${config.ttlSec}`);
    if (config.staleWhileRevalidate > 0) {
      parts.push(`stale-while-revalidate=${config.staleWhileRevalidate}`);
    }
    headers['Cache-Control'] = parts.join(', ');
  }

  // Vary header — toujours Accept-Encoding + optionnel
  const varyParts = ['Accept-Encoding'];
  if (options.vary) varyParts.push(...options.vary);
  headers['Vary'] = varyParts.join(', ');

  // ETag
  if (options.etag) {
    headers['ETag'] = `"${options.etag}"`;
  }

  return headers;
}

// ── ETag ──────────────────────────────────────────────────────────────────

/** Génère un ETag basé sur le SHA-256 tronqué du contenu (16 premiers chars hex).
 *  Suffisant pour la revalidation CDN sans collision pratique. */
export async function buildETag(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}

// ── Staleness ─────────────────────────────────────────────────────────────

/** Vérifie si un élément en cache est périmé.
 *  @param cachedAtMs — timestamp epoch ms de la mise en cache.
 *  @param ttlSec — durée de vie en secondes.
 *  @param nowMs — timestamp actuel (injectable pour tests). */
export function isStale(cachedAtMs: number, ttlSec: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(cachedAtMs) || !Number.isFinite(ttlSec)) return true;
  if (ttlSec <= 0) return true;
  return nowMs - cachedAtMs > ttlSec * 1000;
}

// ── Clés de purge ciblée ──────────────────────────────────────────────────

/** Construit la liste des clés de cache à invalider lors d'une mise à jour.
 *  Utilisé pour la purge ciblée via Cache API de Cloudflare. */
export function buildPurgeKeys(
  clientId: string,
  resourceType: 'form' | 'widget' | 'site' | 'storefront' | 'all',
): string[] {
  const prefixMap: Record<string, string[]> = {
    form: [`/api/public/forms/${clientId}`],
    widget: [`/api/public/chat-widget/${clientId}`],
    site: [`/api/public/sites/${clientId}`],
    storefront: [`/api/public/storefront/${clientId}`],
    all: [
      `/api/public/forms/${clientId}`,
      `/api/public/chat-widget/${clientId}`,
      `/api/public/sites/${clientId}`,
      `/api/public/storefront/${clientId}`,
    ],
  };
  return prefixMap[resourceType] ?? [];
}
