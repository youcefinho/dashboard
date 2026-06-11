// ── Sprint 91 (seq186) — Rate-Limiting Distribué (Cloudflare KV) ─────────
// Middleware global de rate-limiting basé sur Cloudflare KV (fixed-window
// counter). Remplace le rate-limiter D1 (rate-limit.ts) pour les routes
// globales. Le rate-limiter D1 RESTE en place pour les handlers spécifiques
// qui l'appellent déjà (rétro-compat 100%).
//
// Algorithme : Fixed-window counter en KV avec TTL auto-expire.
// Clé KV : `rl:{tier}:{identifier}:{windowStart}`.
// TTL = windowSec + 1 (marge sécurité).
//
// Idiome FAIL-OPEN : si KV est absent (env.RATE_LIMITER undefined) ou si
// KV panne, retourne { allowed: true } SANS bloquer. Calque exact du
// comportement fail-open de rate-limit.ts (D1) et audit() (helpers.ts).
//
// Trois tiers :
//   - public    : 60 req/min/IP  (routes pré-auth, webhooks, etc.)
//   - authenticated : 120 req/min/user (routes post-requireAuth)
//   - api       : 300 req/min/key (routes /api/public/v1/*)

// ── Types ────────────────────────────────────────────────────

/** Tier de rate-limiting (déterminé par le contexte de la requête). */
export type RateLimitTier = 'public' | 'authenticated' | 'api';

/** Configuration d'un tier de rate-limiting. */
export interface RateLimitTierConfig {
  /** Nombre maximum de requêtes autorisées dans la fenêtre. */
  max: number;
  /** Durée de la fenêtre en secondes. */
  windowSec: number;
}

/** Résultat d'une vérification de rate-limit KV. */
export interface RateLimitKVResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  /** Début de la fenêtre courante (epoch seconds). */
  resetAt: number;
  tier: RateLimitTier;
}

// ── Configuration des tiers ──────────────────────────────────

export const RATE_LIMIT_TIERS: Record<RateLimitTier, RateLimitTierConfig> = {
  public:        { max: 60,  windowSec: 60 },
  authenticated: { max: 120, windowSec: 60 },
  api:           { max: 300, windowSec: 60 },
};

// ── Fonction principale ──────────────────────────────────────

/**
 * Vérifie et incrémente le compteur de rate-limit en KV.
 *
 * @param kv - Namespace KV (env.RATE_LIMITER). Si null/undefined, fail-open.
 * @param identifier - Identifiant unique (IP, userId, apiKeyId).
 * @param tier - Tier de rate-limiting à appliquer.
 * @returns Résultat de la vérification (allowed, remaining, retryAfterSec).
 */
export async function checkRateLimitKV(
  kv: KVNamespace | undefined | null,
  identifier: string,
  tier: RateLimitTier,
): Promise<RateLimitKVResult> {
  const config = RATE_LIMIT_TIERS[tier];
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % config.windowSec);
  const resetAt = windowStart + config.windowSec;

  // Fail-open : KV absent → toujours autorisé.
  if (!kv) {
    return {
      allowed: true,
      remaining: config.max,
      retryAfterSec: 0,
      resetAt,
      tier,
    };
  }

  const key = `rl:${tier}:${identifier}:${windowStart}`;

  try {
    // Lecture du compteur courant.
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) : 0;

    if (count >= config.max) {
      // Quota dépassé : calcul du retry_after basé sur le temps restant
      // dans la fenêtre courante.
      const retryAfterSec = Math.max(1, resetAt - now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
        resetAt,
        tier,
      };
    }

    // Quota OK : incrémente le compteur.
    // TTL = windowSec + 1 pour marge de sécurité (auto-expire).
    // Note : KV put n'est PAS atomique (race condition possible entre
    // get et put sous charge extrême — acceptable pour un rate-limiter
    // best-effort). Pour un compteur atomique strict, utiliser Durable
    // Objects (backlog S91-B).
    await kv.put(key, String(count + 1), {
      expirationTtl: config.windowSec + 1,
    });

    return {
      allowed: true,
      remaining: Math.max(0, config.max - count - 1),
      retryAfterSec: 0,
      resetAt,
      tier,
    };
  } catch {
    // Fail-open : panne KV → toujours autorisé.
    // Calque idiome `audit()` best-effort (helpers.ts:78-86) et
    // checkRateLimit D1 (rate-limit.ts:65-70).
    return {
      allowed: true,
      remaining: config.max,
      retryAfterSec: 0,
      resetAt,
      tier,
    };
  }
}

// ── Headers builder ──────────────────────────────────────────

/**
 * Construit les headers de rate-limit standard (RFC 6585 / IETF draft).
 * À injecter dans TOUTES les réponses API (même celles autorisées).
 *
 * Headers :
 *   X-RateLimit-Limit     : quota max pour le tier
 *   X-RateLimit-Remaining : requêtes restantes dans la fenêtre
 *   X-RateLimit-Reset     : epoch (sec) de fin de fenêtre
 *   Retry-After           : secondes avant prochaine tentative (429 uniquement)
 */
export function buildRateLimitHeaders(
  result: RateLimitKVResult,
): Record<string, string> {
  const config = RATE_LIMIT_TIERS[result.tier];
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(config.max),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSec);
  }

  return headers;
}

// ── Réponse 429 ──────────────────────────────────────────────

/**
 * Construit une réponse 429 JSON standardisée.
 * Message en français (convention Intralys) avec code machine stable.
 */
export function rateLimitedResponse(
  result: RateLimitKVResult,
): Response {
  const headers = buildRateLimitHeaders(result);
  headers['Content-Type'] = 'application/json';

  return new Response(
    JSON.stringify({
      error: 'Trop de requêtes. Réessayez plus tard.',
      code: 'RATE_LIMITED',
      retry_after_seconds: result.retryAfterSec,
    }),
    { status: 429, headers },
  );
}
