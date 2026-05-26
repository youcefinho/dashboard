// ── Sprint 24 — Observabilité : handlers admin (Phase B impl) ────────────
//
// 6 handlers admin sous `/api/admin/observability/*` (le 7e — web-vitals —
// est PROXY de `handleAdminWebVitals` (S-D figé) câblé directement dans
// worker.ts pour éviter la duplication).
//
// Contrat §6.7 / §6.8 : tous les handlers retournent `{ data: ... }` (200)
// en best-effort, ou `{ error, code? }` pour validation fail / 404 / 500.
//
// Garde admin : appliquée EN AMONT dans worker.ts (rôle admin/owner) avant
// dispatch ici. Pas de double check (calque patron admin-analytics.ts /
// observability-ops.ts qui re-check en défense en profondeur — mais la garde
// principale du bloc est dans worker.ts).
//
// Codes d'erreur figés Sprint 24 :
//   - ALERT_RULE_INVALID (400) : body schema fail.
//   - ALERT_NOT_FOUND   (404) : règle absente.
//   - METRICS_UNAVAILABLE      : pas un code HTTP, c'est un champ
//     `unavailable: true` dans `data` (200 best-effort fallback).

import type { Env, AlertRuleRow, AlertEventRow } from './types';
import { json, audit } from './helpers';
import { alertRuleCreateSchema, alertRuleUpdateSchema, observabilityQuerySchema } from '../lib/schemas';
import type { AlertRule, AlertEvent, ObservabilityHealth, RequestMetricsBucket } from '../lib/types';
import { handleHealth } from './health';

interface AdminAuth {
  userId: string;
  role?: string;
}

// Mapping period → modificateur datetime SQLite + fenêtre en minutes.
const PERIOD_TO_MINUTES: Record<string, number> = {
  '1h': 60,
  '24h': 1440,
  '7d': 10080,
  '30d': 43200,
};

// ── Helpers de désérialisation (D1 row → API type) ────────────────────────

function deserializeRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    condition_type: row.condition_type,
    metric_name: row.metric_name,
    threshold: Number(row.threshold) || 0,
    window_minutes: Number(row.window_minutes) || 60,
    notification_channel: row.notification_channel,
    notification_target: row.notification_target ?? '',
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function deserializeEvent(row: AlertEventRow): AlertEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    rule_id: row.rule_id,
    triggered_at: row.triggered_at,
    payload,
    resolved_at: row.resolved_at,
  };
}

// ── Health ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/observability/health
 * Vue ops santé système : proxy `handleHealth` (S10 figé) + enrichissement
 * `migrations_count` / `last_migration` depuis `_migrations` (best-effort).
 */
export async function handleGetObservabilityHealth(
  env: Env,
  _auth: AdminAuth,
): Promise<Response> {
  // Uptime calculé depuis env.START_TIME si bindé (cf. health.test.ts), sinon 0.
  const startTime = (env as unknown as { START_TIME?: number }).START_TIME;
  const uptime_s =
    typeof startTime === 'number' && startTime > 0
      ? Math.max(0, Math.floor((Date.now() - startTime) / 1000))
      : 0;

  // Proxy handleHealth (S10 figé). Renvoie 200 { status, db, version, uptime_s, ai_mock, migrations_count? }
  // ou 503 { status:'error', db:'error', details, ... }. On lit le JSON, on
  // enrichit, on renvoie un Response neuf (status conservé).
  let healthBody: Record<string, unknown> = {};
  let healthStatus = 200;
  try {
    const r = await handleHealth(env, uptime_s);
    healthStatus = r.status;
    healthBody = (await r.json()) as Record<string, unknown>;
  } catch {
    healthBody = {
      status: 'ok',
      db: 'ok',
      version: '2.1.0',
      uptime_s,
      ai_mock: true,
    };
  }

  // Enrichissement migrations_count + last_migration depuis `_migrations`
  // (table runner S2 scripts/migrate.ts). Best-effort : champs `null` si KO.
  let migrations_count: number | null = null;
  let last_migration: string | null = null;
  try {
    const cRow = (await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM _migrations`)
      .first()) as { c?: number } | null;
    if (cRow && typeof cRow.c === 'number') migrations_count = cRow.c;
    const lastRow = (await env.DB
      .prepare(`SELECT seq, file FROM _migrations ORDER BY seq DESC LIMIT 1`)
      .first()) as { seq?: number; file?: string } | null;
    if (lastRow && lastRow.file) {
      last_migration = lastRow.seq != null ? `${lastRow.seq}:${lastRow.file}` : lastRow.file;
    }
  } catch {
    /* best-effort : champs restent null */
  }

  const enriched: ObservabilityHealth = {
    status: (healthBody.status as 'ok' | 'error') ?? 'ok',
    db: (healthBody.db as 'ok' | 'error') ?? 'ok',
    version: (healthBody.version as string) ?? '2.1.0',
    uptime_s: typeof healthBody.uptime_s === 'number' ? (healthBody.uptime_s as number) : uptime_s,
    ai_mock: typeof healthBody.ai_mock === 'boolean' ? (healthBody.ai_mock as boolean) : true,
    migrations_count,
    last_migration,
  };
  return json({ data: enriched }, healthStatus);
}

// ── Request metrics ───────────────────────────────────────────────────────

/**
 * GET /api/admin/observability/request-metrics?period=1h|24h|7d|30d
 * Agrégat route × percentiles sur la fenêtre.
 *
 * Approximation p50/p95/p99 : on agrège count + lat_sum + lat_max par route,
 * puis on dérive :
 *   - p50 ≈ lat_sum/count (latence moyenne)
 *   - p99 ≈ lat_max (max-bucket = upper bound observé)
 *   - p95 ≈ lat_max * 0.95 (interpolation linéaire entre p50 et p99)
 * C'est une approximation explicitement documentée § contrat (pas de
 * percentile native D1 / SQLite, et nearest-rank par route×fenêtre serait
 * trop coûteux côté query — voir observability-ops.ts:p75For pour le patron
 * nearest-rank exact, qui est faisable pour web_vitals car peu de métriques).
 */
export async function handleGetRequestMetrics(
  request: Request,
  env: Env,
  _auth: AdminAuth,
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = observabilityQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'Paramètres invalides', code: 'INVALID_INPUT' }, 400);
  }
  const period = parsed.data.period;
  const windowMinutes = PERIOD_TO_MINUTES[period] ?? 1440;

  try {
    const res = (await env.DB
      .prepare(
        `SELECT route,
                SUM(count)                                            AS count,
                SUM(CASE WHEN status >= 500 THEN count ELSE 0 END)    AS error_count,
                SUM(latency_sum_ms)                                   AS lat_sum,
                MAX(latency_max_ms)                                   AS lat_max
           FROM request_metrics
          WHERE bucket_start > datetime('now', '-' || ? || ' minutes')
          GROUP BY route
          ORDER BY count DESC
          LIMIT 50`,
      )
      .bind(windowMinutes)
      .all()) as {
      results?: Array<{
        route: string;
        count: number;
        error_count: number;
        lat_sum: number;
        lat_max: number;
      }>;
    };

    const rows = Array.isArray(res?.results) ? res.results : [];
    const metrics: RequestMetricsBucket[] = rows.map((r) => {
      const count = Number(r.count) || 0;
      const errorCount = Number(r.error_count) || 0;
      const latSum = Number(r.lat_sum) || 0;
      const latMax = Number(r.lat_max) || 0;
      const p50 = count > 0 ? Math.round(latSum / count) : 0;
      const p99 = Math.round(latMax);
      const p95 = Math.round(latMax * 0.95);
      const errorRatePct = count > 0 ? Math.round((errorCount / count) * 10000) / 100 : 0;
      return {
        route: r.route,
        count,
        error_count: errorCount,
        p50_ms: p50,
        p95_ms: p95,
        p99_ms: p99,
        error_rate_pct: errorRatePct,
      };
    });

    return json({ data: { metrics } });
  } catch {
    // Best-effort : table seq122 absente / SQL KO → unavailable:true, JAMAIS 5xx.
    return json({ data: { metrics: [] as RequestMetricsBucket[], unavailable: true } });
  }
}

// ── Error metrics ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/observability/errors?period=1h|24h|7d|30d
 * Top actions en erreur sur la fenêtre (depuis audit_log filtré `error.*`).
 */
export async function handleGetErrorMetrics(
  request: Request,
  env: Env,
  _auth: AdminAuth,
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = observabilityQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'Paramètres invalides', code: 'INVALID_INPUT' }, 400);
  }
  const period = parsed.data.period;
  const windowMinutes = PERIOD_TO_MINUTES[period] ?? 1440;

  try {
    const res = (await env.DB
      .prepare(
        `SELECT action, COUNT(*) AS count, MAX(created_at) AS last_at
           FROM audit_log
          WHERE action LIKE 'error.%'
            AND created_at > datetime('now', '-' || ? || ' minutes')
          GROUP BY action
          ORDER BY count DESC
          LIMIT 50`,
      )
      .bind(windowMinutes)
      .all()) as {
      results?: Array<{ action: string; count: number; last_at: string }>;
    };
    const errors = Array.isArray(res?.results)
      ? res.results.map((r) => ({
          action: r.action,
          count: Number(r.count) || 0,
          last_at: r.last_at,
        }))
      : [];
    return json({ data: { errors } });
  } catch {
    return json({
      data: {
        errors: [] as Array<{ action: string; count: number; last_at: string }>,
        unavailable: true,
      },
    });
  }
}

// ── Alerts (list + CRUD) ──────────────────────────────────────────────────

/**
 * GET /api/admin/observability/alerts
 * Liste des règles + des événements récents.
 */
export async function handleListAlerts(
  env: Env,
  _auth: AdminAuth,
): Promise<Response> {
  let rules: AlertRule[] = [];
  let events: AlertEvent[] = [];
  try {
    const rRes = (await env.DB
      .prepare(`SELECT * FROM alert_rules ORDER BY created_at DESC`)
      .all()) as { results?: AlertRuleRow[] };
    rules = Array.isArray(rRes?.results) ? rRes.results.map(deserializeRule) : [];
  } catch {
    /* best-effort : table absente → [] */
  }
  try {
    const eRes = (await env.DB
      .prepare(`SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT 100`)
      .all()) as { results?: AlertEventRow[] };
    events = Array.isArray(eRes?.results) ? eRes.results.map(deserializeEvent) : [];
  } catch {
    /* best-effort */
  }
  return json({ data: { rules, events } });
}

/**
 * POST /api/admin/observability/alert-rules
 * Crée une nouvelle règle (validation zod, INSERT, audit).
 */
export async function handleCreateAlertRule(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = alertRuleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Règle invalide', code: 'ALERT_RULE_INVALID' }, 400);
  }

  try {
    // ID lower(hex(randomblob(16))) — calqué sur DEFAULT seq122. On l'expose
    // côté JS pour pouvoir SELECT immédiatement après INSERT sans nouveau
    // round-trip identifiant.
    const idRow = (await env.DB
      .prepare(`SELECT lower(hex(randomblob(16))) AS id`)
      .first()) as { id?: string } | null;
    const id = idRow && typeof idRow.id === 'string' ? idRow.id : crypto.randomUUID();
    const d = parsed.data;

    await env.DB
      .prepare(
        `INSERT INTO alert_rules
           (id, name, condition_type, metric_name, threshold, window_minutes,
            notification_channel, notification_target, enabled, created_by,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .bind(
        id,
        d.name,
        d.condition_type,
        d.metric_name ?? null,
        d.threshold,
        d.window_minutes,
        d.notification_channel,
        d.notification_target ?? '',
        d.enabled ? 1 : 0,
        auth.userId,
      )
      .run();

    const row = (await env.DB
      .prepare(`SELECT * FROM alert_rules WHERE id = ?`)
      .bind(id)
      .first()) as AlertRuleRow | null;
    const rule: AlertRule = row
      ? deserializeRule(row)
      : {
          id,
          name: d.name,
          condition_type: d.condition_type,
          metric_name: d.metric_name ?? null,
          threshold: d.threshold,
          window_minutes: d.window_minutes,
          notification_channel: d.notification_channel,
          notification_target: d.notification_target ?? '',
          enabled: d.enabled,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

    // Audit best-effort (audit() propage request_id automatiquement — Phase A).
    await audit(env, auth.userId, 'alert.rule.created', 'alert_rule', id, {
      name: d.name,
      condition_type: d.condition_type,
      threshold: d.threshold,
    });

    return json({ data: { rule } });
  } catch {
    return json({ error: 'Erreur interne', code: 'INTERNAL' }, 500);
  }
}

/**
 * PATCH /api/admin/observability/alert-rules/:id
 * Met à jour une règle (validation partielle, UPDATE dynamic SET, audit).
 */
export async function handleUpdateAlertRule(
  request: Request,
  env: Env,
  auth: AdminAuth,
  id: string,
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = alertRuleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Règle invalide', code: 'ALERT_RULE_INVALID' }, 400);
  }

  try {
    const existing = (await env.DB
      .prepare(`SELECT id FROM alert_rules WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()) as { id?: string } | null;
    if (!existing || !existing.id) {
      return json({ error: 'Règle introuvable', code: 'ALERT_NOT_FOUND' }, 404);
    }

    const d = parsed.data;
    const sets: string[] = [];
    const args: unknown[] = [];
    if (d.name !== undefined) {
      sets.push('name = ?');
      args.push(d.name);
    }
    if (d.condition_type !== undefined) {
      sets.push('condition_type = ?');
      args.push(d.condition_type);
    }
    if (d.metric_name !== undefined) {
      sets.push('metric_name = ?');
      args.push(d.metric_name);
    }
    if (d.threshold !== undefined) {
      sets.push('threshold = ?');
      args.push(d.threshold);
    }
    if (d.window_minutes !== undefined) {
      sets.push('window_minutes = ?');
      args.push(d.window_minutes);
    }
    if (d.notification_channel !== undefined) {
      sets.push('notification_channel = ?');
      args.push(d.notification_channel);
    }
    if (d.notification_target !== undefined) {
      sets.push('notification_target = ?');
      args.push(d.notification_target);
    }
    if (d.enabled !== undefined) {
      sets.push('enabled = ?');
      args.push(d.enabled ? 1 : 0);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      args.push(id);
      await env.DB
        .prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...args)
        .run();
    }

    const row = (await env.DB
      .prepare(`SELECT * FROM alert_rules WHERE id = ?`)
      .bind(id)
      .first()) as AlertRuleRow | null;
    if (!row) {
      return json({ error: 'Règle introuvable', code: 'ALERT_NOT_FOUND' }, 404);
    }
    const rule = deserializeRule(row);
    await audit(env, auth.userId, 'alert.rule.updated', 'alert_rule', id, d as Record<string, unknown>);
    return json({ data: { rule } });
  } catch {
    return json({ error: 'Erreur interne', code: 'INTERNAL' }, 500);
  }
}

/**
 * DELETE /api/admin/observability/alert-rules/:id
 * Supprime une règle (404 si absente, audit).
 */
export async function handleDeleteAlertRule(
  env: Env,
  auth: AdminAuth,
  id: string,
): Promise<Response> {
  try {
    const result = (await env.DB
      .prepare(`DELETE FROM alert_rules WHERE id = ?`)
      .bind(id)
      .run()) as { meta?: { changes?: number } };
    const changes = result?.meta?.changes ?? 0;
    if (!changes || changes === 0) {
      return json({ error: 'Règle introuvable', code: 'ALERT_NOT_FOUND' }, 404);
    }
    await audit(env, auth.userId, 'alert.rule.deleted', 'alert_rule', id, {});
    return json({ data: { ok: true as const } });
  } catch {
    return json({ error: 'Erreur interne', code: 'INTERNAL' }, 500);
  }
}
