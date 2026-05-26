// ── Sprint 24 — Observabilité : alert-evaluator (Phase B impl) ───────────
//
// `evaluateAlertRules(env)` est destiné à être appelé par un cron worker
// (backlog — pas câblé Phase B). Pour chaque règle `alert_rules` activée,
// calcule la métrique cible (`error_rate` / `p95_latency` / `web_vital_p75`)
// sur la fenêtre `window_minutes`, et si > `threshold` :
//   1. INSERT alert_events (rule_id, payload JSON {observed, threshold, ...})
//   2. Notify selon `notification_channel` :
//      - 'log'     → logger.warn(env, 'alert.fired', {...})
//      - 'webhook' → fetch POST best-effort (swallow errors)
//
// Best-effort STRICT : never throws — try/catch par règle + global. Si une
// règle échoue, les autres continuent. Retour `{ evaluated, fired }`.

import type { Env, AlertRuleRow } from '../types';
import { createLogger } from './logger';

export interface AlertEvaluationResult {
  /** Nombre de règles activées évaluées. */
  evaluated: number;
  /** Nombre de règles ayant déclenché (insertion alert_events + notify). */
  fired: number;
}

/**
 * Calcule la valeur courante d'une règle sur sa fenêtre `window_minutes`.
 * Retourne `null` si pas de donnée / erreur SQL (best-effort).
 */
async function computeMetricValue(
  env: Env,
  rule: AlertRuleRow,
): Promise<number | null> {
  const windowArg = `-${rule.window_minutes} minutes`;
  try {
    if (rule.condition_type === 'error_rate') {
      // Pourcentage d'erreurs 5xx sur la fenêtre. NULLIF protège div-by-zero.
      const row = (await env.DB
        .prepare(
          `SELECT 100.0 * SUM(CASE WHEN status >= 500 THEN count ELSE 0 END) / NULLIF(SUM(count), 0) AS v
             FROM request_metrics
            WHERE bucket_start > datetime('now', ?)`,
        )
        .bind(windowArg)
        .first()) as { v?: number | null } | null;
      const v = row && row.v != null ? Number(row.v) : null;
      return typeof v === 'number' && !Number.isNaN(v) ? v : null;
    }
    if (rule.condition_type === 'p95_latency') {
      // Approximation nearest-rank sur les buckets : on ordonne latency_max_ms
      // ASC, on prend la valeur à l'index `floor(0.95 * count)`. Filtre par
      // route si rule.metric_name est renseigné (sinon global).
      const countRow = (await env.DB
        .prepare(
          rule.metric_name
            ? `SELECT COUNT(*) AS c FROM request_metrics WHERE route = ? AND bucket_start > datetime('now', ?)`
            : `SELECT COUNT(*) AS c FROM request_metrics WHERE bucket_start > datetime('now', ?)`,
        )
        .bind(...(rule.metric_name ? [rule.metric_name, windowArg] : [windowArg]))
        .first()) as { c?: number } | null;
      const count = countRow && typeof countRow.c === 'number' ? countRow.c : 0;
      if (count <= 0) return null;
      const rank = Math.floor(count * 0.95);
      const row = (await env.DB
        .prepare(
          rule.metric_name
            ? `SELECT latency_max_ms AS v FROM request_metrics
                WHERE route = ? AND bucket_start > datetime('now', ?)
                ORDER BY latency_max_ms ASC LIMIT 1 OFFSET ?`
            : `SELECT latency_max_ms AS v FROM request_metrics
                WHERE bucket_start > datetime('now', ?)
                ORDER BY latency_max_ms ASC LIMIT 1 OFFSET ?`,
        )
        .bind(
          ...(rule.metric_name
            ? [rule.metric_name, windowArg, rank]
            : [windowArg, rank]),
        )
        .first()) as { v?: number } | null;
      return row && typeof row.v === 'number' ? row.v : null;
    }
    if (rule.condition_type === 'web_vital_p75') {
      // Nearest-rank sur web_vitals.value pour la métrique cible.
      if (!rule.metric_name) return null;
      const countRow = (await env.DB
        .prepare(
          `SELECT COUNT(*) AS c FROM web_vitals
            WHERE metric_name = ? AND created_at > datetime('now', ?)`,
        )
        .bind(rule.metric_name, windowArg)
        .first()) as { c?: number } | null;
      const count = countRow && typeof countRow.c === 'number' ? countRow.c : 0;
      if (count <= 0) return null;
      const rank = Math.floor(count * 0.75);
      const row = (await env.DB
        .prepare(
          `SELECT value AS v FROM web_vitals
            WHERE metric_name = ? AND created_at > datetime('now', ?)
            ORDER BY value ASC LIMIT 1 OFFSET ?`,
        )
        .bind(rule.metric_name, windowArg, rank)
        .first()) as { v?: number } | null;
      return row && typeof row.v === 'number' ? row.v : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Évalue toutes les règles d'alerte activées.
 *
 * @param env  Worker env.
 * @returns    `{ evaluated, fired }` — compte les règles parcourues et déclenchées.
 *
 * GARANTI NEVER-THROW : try/catch global + try/catch par règle.
 */
export async function evaluateAlertRules(env: Env): Promise<AlertEvaluationResult> {
  let evaluated = 0;
  let fired = 0;
  try {
    const res = (await env.DB
      .prepare(`SELECT * FROM alert_rules WHERE enabled = 1`)
      .all()) as { results?: AlertRuleRow[] };
    const rules = Array.isArray(res?.results) ? res.results : [];
    const logger = createLogger(env);

    for (const rule of rules) {
      evaluated++;
      try {
        const value = await computeMetricValue(env, rule);
        if (value == null) continue;
        if (value <= rule.threshold) continue;

        // FIRING : insert alert_events + notify selon channel.
        const payload = JSON.stringify({
          observed: value,
          threshold: rule.threshold,
          window_minutes: rule.window_minutes,
          condition_type: rule.condition_type,
          metric_name: rule.metric_name,
        });
        try {
          await env.DB
            .prepare(`INSERT INTO alert_events (rule_id, payload) VALUES (?, ?)`)
            .bind(rule.id, payload)
            .run();
        } catch {
          /* best-effort : insertion event KO ne bloque pas notify */
        }

        if (rule.notification_channel === 'log') {
          logger.warn('alert.fired', {
            rule_id: rule.id,
            name: rule.name,
            condition_type: rule.condition_type,
            observed: value,
            threshold: rule.threshold,
            window_minutes: rule.window_minutes,
          });
        } else if (
          rule.notification_channel === 'webhook' &&
          rule.notification_target &&
          rule.notification_target.length > 0
        ) {
          try {
            await fetch(rule.notification_target, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                rule: {
                  id: rule.id,
                  name: rule.name,
                  condition_type: rule.condition_type,
                  metric_name: rule.metric_name,
                  window_minutes: rule.window_minutes,
                },
                observed: value,
                threshold: rule.threshold,
              }),
            }).catch(() => undefined);
          } catch {
            /* best-effort : webhook KO n'empêche pas le fired++ */
          }
        }
        fired++;
      } catch {
        /* best-effort par règle : on continue avec les autres */
      }
    }
    return { evaluated, fired };
  } catch {
    return { evaluated, fired };
  }
}
