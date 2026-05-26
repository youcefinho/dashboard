// ── observability-ops.ts — Sprint S-D §6.3 (LOT D, Manager B) ──────────────
//
// Endpoint ADMIN read-only : GET /api/admin/web-vitals
//   Agrège la télémétrie Web Vitals (table `web_vitals`, créée S9
//   migration-sprintS9-m1.sql:65-77) en métriques ops : count / avg / p75
//   par `metric_name`, fenêtrées par période.
//
// Garde admin : RÉPLIQUE LOCALE du patron `admin-analytics.ts:16-23`
//   (pas d'import cross-module). Le dispatch worker.ts (Manager A) garde DÉJÀ
//   en amont — ce handler re-vérifie : défense en profondeur.
//
// Best-effort STRICT : table absente / DB throw → 200 + metrics:[].
//   JAMAIS 500, JAMAIS 503 (§6.3 robustesse).
//
// Multi-tenant : `web_vitals` est une table télémétrie GLOBALE ops. Sa
//   colonne `client_id TEXT REFERENCES clients(id)` est NULLABLE (cf
//   migration-sprintS9-m1.sql:72 — pas de NOT NULL, pas de scoping imposé)
//   et le producteur S9 (POST /api/telemetry/web-vitals) ne porte pas de
//   sémantique tenant obligatoire. Cohérent avec admin-analytics.ts :
//   vue ops admin-only, agrégat global → aucun filtre client_id requis.

import type { Env } from './types';
import { json } from './helpers';

// Réplique LOCALE (pas d'import du requireAdmin de admin-analytics.ts — le
// patron §6.3 impose la copie locale du pattern admin-analytics.ts:16-23).
const ADMIN_ROLES = new Set(['admin', 'owner']);

function requireAdmin(auth: { userId: string; role: string }): Response | null {
  if (!ADMIN_ROLES.has(auth.role)) {
    return json({ error: 'Accès réservé aux administrateurs.' }, 403);
  }
  return null;
}

// `?period=24h|7d|30d` → modificateur datetime SQLite pour `created_at`.
const PERIOD_OFFSET: Record<string, string> = {
  '24h': '-24 hours',
  '7d': '-7 days',
  '30d': '-30 days',
};

interface VitalRow {
  metric_name: string;
  count: number;
  avg: number;
}

interface VitalMetric {
  metric_name: string;
  count: number;
  avg: number;
  p75: number;
}

/**
 * GET /api/admin/web-vitals — agrégat ops Web Vitals (admin/owner only).
 *
 * Réponse §6.3 (200) :
 *   { data: { metrics: [{ metric_name, count, avg, p75 }], period, since } }
 *
 * Best-effort : toute erreur (table absente, SQL KO) →
 *   { data: { metrics: [], period, since } } (200). JAMAIS 5xx.
 */
export async function handleAdminWebVitals(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  // Défense en profondeur : la garde existe DÉJÀ côté dispatch worker.ts,
  // on la re-vérifie ici (jamais supprimer la garde côté handler — §6.3).
  const denied = requireAdmin(auth);
  if (denied) return denied;

  // Paramètre période : valeur invalide → défaut '7d' (§6.3).
  const url = new URL(request.url);
  const raw = (url.searchParams.get('period') || '7d').toLowerCase();
  const period = PERIOD_OFFSET[raw] ? raw : '7d';
  const offset = PERIOD_OFFSET[period]!;

  // `since` : borne basse calculée côté DB (datetime('now', offset)) pour
  // rester cohérent avec le filtre SQL appliqué. Best-effort : si la lecture
  // de `since` échoue, on retombe sur une valeur ISO calculée en JS.
  let since: string;
  try {
    const sinceRow = (await env.DB
      .prepare(`SELECT datetime('now', ?) AS since`)
      .bind(offset)
      .first()) as { since?: string } | null;
    since = (sinceRow && typeof sinceRow.since === 'string')
      ? sinceRow.since
      : jsSince(period);
  } catch {
    since = jsSince(period);
  }

  // Agrégat count/avg par metric_name sur la fenêtre. Lecture seule.
  try {
    const agg = await env.DB
      .prepare(
        `SELECT metric_name,
                COUNT(*)   AS count,
                AVG(value) AS avg
           FROM web_vitals
          WHERE created_at >= datetime('now', ?)
          GROUP BY metric_name
          ORDER BY metric_name`,
      )
      .bind(offset)
      .all() as { results: VitalRow[] };

    const rows = (agg && Array.isArray(agg.results)) ? agg.results : [];
    const metrics: VitalMetric[] = [];

    for (const r of rows) {
      const name = r.metric_name;
      const count = Number(r.count) || 0;
      const avg = round2(Number(r.avg) || 0);
      const p75 = await p75For(env, name, offset, count);
      metrics.push({ metric_name: name, count, avg, p75 });
    }

    return json({ data: { metrics, period, since } });
  } catch {
    // Best-effort §6.3 : table absente / erreur SQL → liste vide, JAMAIS 500.
    return json({ data: { metrics: [], period, since } });
  }
}

/**
 * p75 approximatif (méthode documentée — cf docs/OBSERVABILITY-OPS-S-D3.md) :
 *   nearest-rank. On ordonne les `value` ASC sur la fenêtre pour la métrique
 *   et on lit la ligne d'index `floor(count * 3 / 4)` via LIMIT 1 OFFSET.
 *   - count == 0 → 0 (pas de donnée).
 *   - count == 1 → offset 0 = la seule valeur.
 *   Compatible D1/SQLite (pas de fonction percentile native). O(count·log)
 *   par métrique ; volumétrie web_vitals ops faible → acceptable. Erreur →
 *   0 (best-effort, ne casse jamais la réponse globale).
 */
async function p75For(
  env: Env,
  metricName: string,
  offset: string,
  count: number,
): Promise<number> {
  if (count <= 0) return 0;
  const rank = Math.floor((count * 3) / 4); // nearest-rank, 0-based offset
  try {
    const row = (await env.DB
      .prepare(
        `SELECT value
           FROM web_vitals
          WHERE metric_name = ?
            AND created_at >= datetime('now', ?)
          ORDER BY value ASC
          LIMIT 1 OFFSET ?`,
      )
      .bind(metricName, offset, rank)
      .first()) as { value?: number } | null;
    if (row && typeof row.value === 'number') return round2(row.value);
  } catch {
    /* best-effort : p75 indisponible pour cette métrique → 0 */
  }
  return 0;
}

// Fallback `since` calculé en JS si la lecture DB échoue (best-effort).
function jsSince(period: string): string {
  const ms =
    period === '24h' ? 24 * 3600_000
    : period === '30d' ? 30 * 86_400_000
    : 7 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
