// ── Sprint 24 — Observabilité : request-metrics (Phase B impl) ───────────
//
// Helper appelé via `ctx.waitUntil(recordRequestMetric(env, {...}))` au point
// de sortie du fetch handler (worker.ts). Best-effort STRICT : tout throw est
// swallowé. JAMAIS bloquant pour la requête utilisateur.
//
// Pourquoi `bucket_start` à la minute : agrégation pré-calculée (route × min ×
// status × tenant) ↔ requêtes admin /request-metrics rapides sans GROUP BY
// coûteux. Convention SQLite : strftime('%Y-%m-%d %H:%M:00','now').
//
// `normalizeRoute` (regex defensive) : remplace par `:id` les segments qui
// matchent UUID v4, hex 16+ chars, CUID, ObjectId Mongo — pour que la
// dimension `route` agrégée n'explose pas (1 ligne par leadId distinct serait
// inutilisable).

import type { Env } from '../types';

export interface RecordRequestMetricContext {
  /** Méthode HTTP brute (`GET` / `POST` / ...). */
  method: string;
  /** Path brut de la requête (avant normalisation, avec UUID/IDs). */
  rawPath: string;
  /** Status HTTP final renvoyé au client. */
  status: number;
  /** Tenant résolu (`authCtx.clientId`) si dispo, sinon `null`. */
  tenantId: string | null;
  /** Latence end-to-end en ms (`Date.now() - __startMs`). */
  latencyMs: number;
}

// Regex defensive : détecte les segments dynamiques pour les normaliser en `:id`.
// Ordre : UUID v4 / hex 16+ / CUID / ObjectId Mongo 24 hex.
// Note : ObjectId Mongo (24 hex) est INCLUS dans `hex 16+` — pas besoin d'alt
// séparée. CUID est case-insensitive (`/i`). Tous les segments matchés sont
// remplacés par `:id`.
const SEG_REGEX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|c[a-z0-9]{20,})$/i;

/**
 * Normalise un path en remplaçant les segments d'ID dynamiques par `:id`.
 *
 * Exemples :
 *   `/api/leads/7c4a8d09ca3762af61e59520943dc26494f8941b` → `/api/leads/:id`
 *   `/api/admin/alert-rules/cjld2cjxh0000qzrmn831i7rn`    → `/api/admin/alert-rules/:id`
 *   `/api/health`                                          → `/api/health` (inchangé)
 */
export function normalizeRoute(path: string): string {
  return path.split('/').map(seg => (SEG_REGEX.test(seg) ? ':id' : seg)).join('/');
}

/**
 * Enregistre une métrique requête agrégée (best-effort, never-throw).
 *
 * @param env  Worker env (D1 binding).
 * @param ctx  Contexte de la requête sortante (cf. interface ci-dessus).
 *
 * INSERT direct dans `request_metrics` (1 ligne par requête, agrégat fait côté
 * SELECT admin via GROUP BY bucket_start). UPSERT non utilisé : volume request
 * = volume INSERT, mais avec bucket_start à la minute la dimension reste
 * acceptable + index `idx_req_metrics_bucket` accélère les SELECT admin.
 *
 * GARANTI NEVER-THROW : try/catch global swallow (table absente, D1 KO).
 */
export async function recordRequestMetric(
  env: Env,
  ctx: RecordRequestMetricContext,
): Promise<void> {
  try {
    const route = normalizeRoute(ctx.rawPath);
    await env.DB.prepare(
      `INSERT INTO request_metrics (bucket_start, route, method, status, tenant_id, count, latency_sum_ms, latency_max_ms)
       VALUES (strftime('%Y-%m-%d %H:%M:00','now'), ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(route, ctx.method, ctx.status, ctx.tenantId, ctx.latencyMs, ctx.latencyMs)
      .run();
  } catch {
    // Best-effort SWALLOW : table absente (seq122 pas jouée) ou erreur D1 →
    // on ne bloque JAMAIS le handler appelant.
    return;
  }
}
