// ── api-versioning.ts — Sprint 96 (seq191) ──────────────────────────────────
// Versioning strict de l'API publique Intralys.
//
// Stratégie : préfixe de route (/v1/, /v2/) avec transformateurs de payloads
// pour maintenir la rétro-compatibilité.
//
// Le routeur interne (worker.ts) reste sur /api/* (non-versionné).
// Les requêtes /v1/api/* et /v2/api/* sont transformées en /api/* avec
// un contexte de version attaché. Les réponses sont adaptées selon la version.
//
// Pourquoi :
//   - Les intégrations tierces (Zapier, Make, webhooks) dépendent de contrats
//     stables. Un changement de payload en /api/ peut casser leurs flux.
//   - /v1/ gèle le format actuel ; /v2/ pourra introduire des breaking changes.
//
// ZÉRO migration SQL. ZÉRO nouvelle table. Pure logique de routing.

import { json } from './helpers';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ApiVersionContext {
  /** Version demandée (1, 2, etc.) */
  version: number;
  /** Path original avant rewrite (ex: /v1/api/leads) */
  originalPath: string;
  /** Path rewrite sans le préfixe de version (ex: /api/leads) */
  rewrittenPath: string;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Versions supportées. */
export const SUPPORTED_VERSIONS = [1, 2] as const;
export type SupportedVersion = typeof SUPPORTED_VERSIONS[number];

/** Version par défaut si aucun préfixe de version n'est fourni. */
export const DEFAULT_VERSION: SupportedVersion = 1;

/** Version la plus récente (utilisée pour /latest/). */
export const LATEST_VERSION: SupportedVersion = 2;

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Pattern pour détecter un préfixe de version : /v1/api/... ou /v2/api/... */
const VERSION_PREFIX_RE = /^\/v(\d+)(\/api\/.*)$/;

/**
 * Parse le préfixe de version d'un pathname.
 * Retourne null si le path n'a pas de préfixe de version.
 *
 * Exemples :
 *   '/v1/api/leads' → { version: 1, originalPath: '/v1/api/leads', rewrittenPath: '/api/leads' }
 *   '/api/leads'    → null (pas de préfixe)
 *   '/v3/api/leads' → null (version non supportée → 404 dans le handler)
 */
export function parseVersionPrefix(pathname: string): ApiVersionContext | null {
  const match = pathname.match(VERSION_PREFIX_RE);
  if (!match) return null;

  const version = parseInt(match[1]!, 10);
  const rewrittenPath = match[2]!;

  // Vérifier que la version est supportée
  if (!SUPPORTED_VERSIONS.includes(version as SupportedVersion)) {
    return null; // Sera traité comme une 404
  }

  return {
    version,
    originalPath: pathname,
    rewrittenPath,
  };
}

// ── Transformateurs de réponse v1 → v2 ───────────────────────────────────────

/**
 * Transforme la réponse JSON selon la version demandée.
 * v1 = format actuel (rétro-compat garantie).
 * v2 = format modernisé (enveloppe standardisée + pagination).
 */
export async function transformResponse(
  response: Response,
  versionCtx: ApiVersionContext,
): Promise<Response> {
  // v1 : aucune transformation (format actuel = v1 par défaut)
  if (versionCtx.version === 1) {
    return addVersionHeaders(response, versionCtx);
  }

  // v2 : enveloppe standardisée + métadonnées
  if (versionCtx.version === 2) {
    return transformV2Response(response, versionCtx);
  }

  // Version non gérée : passthrough
  return addVersionHeaders(response, versionCtx);
}

/**
 * Ajoute les headers de version à la réponse.
 */
function addVersionHeaders(response: Response, ctx: ApiVersionContext): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('X-API-Version', String(ctx.version));
  newResponse.headers.set('X-API-Latest-Version', String(LATEST_VERSION));
  return newResponse;
}

/**
 * Transforme le payload pour la v2 :
 * - Enveloppe standardisée { data, meta, errors }
 * - Pagination dans meta
 * - Timestamps ISO 8601
 */
async function transformV2Response(
  response: Response,
  ctx: ApiVersionContext,
): Promise<Response> {
  // Ne pas transformer les non-JSON ou les erreurs HTTP
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return addVersionHeaders(response, ctx);
  }

  try {
    const body = await response.json() as Record<string, unknown>;

    // Le format v2 normalise l'enveloppe
    const v2Body: Record<string, unknown> = {
      api_version: ctx.version,
      data: body.data ?? body,
      meta: {
        version: ctx.version,
        path: ctx.originalPath,
        timestamp: new Date().toISOString(),
      },
    };

    // Transférer les champs de pagination s'ils existent
    if (body.total !== undefined) {
      (v2Body.meta as Record<string, unknown>).total = body.total;
    }
    if (body.page !== undefined) {
      (v2Body.meta as Record<string, unknown>).page = body.page;
    }

    // Si la réponse originale contient un champ 'error', le normaliser
    if (body.error) {
      v2Body.errors = [{ message: body.error, code: body.error_code || 'UNKNOWN' }];
      delete v2Body.data;
    }

    const v2Response = json(v2Body, response.status);
    return addVersionHeaders(v2Response, ctx);
  } catch {
    // En cas d'erreur de parsing, retourner la réponse originale
    return addVersionHeaders(response, ctx);
  }
}

// ── Middleware d'intégration worker.ts ────────────────────────────────────────

/**
 * Middleware de versioning. À placer en amont du dispatch dans worker.ts.
 *
 * Usage :
 *   const versionCtx = parseVersionPrefix(url.pathname);
 *   if (versionCtx) {
 *     // Rewrite le path pour le routeur interne
 *     path = versionCtx.rewrittenPath;
 *     // Après le dispatch :
 *     response = await transformResponse(response, versionCtx);
 *   }
 */
export function handleUnsupportedVersion(pathname: string): Response | null {
  const match = pathname.match(/^\/v(\d+)\/api\//);
  if (!match) return null;

  const version = parseInt(match[1]!, 10);
  if (!SUPPORTED_VERSIONS.includes(version as SupportedVersion)) {
    return json({
      error: `Version API v${version} non supportée`,
      supported_versions: SUPPORTED_VERSIONS.map((v) => `v${v}`),
      latest: `v${LATEST_VERSION}`,
    }, 400);
  }

  return null; // Version supportée → continuer le dispatch normal
}
