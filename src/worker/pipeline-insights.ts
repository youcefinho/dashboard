// ── Module Pipeline Insights — Sprint 49 M2.2 + M2.3 ───────────
// Détection de goulots pipeline + anomalies d'activité (déterministe, SQL D1).
//
// Endpoints :
//   GET /api/pipeline/bottlenecks   → { bottlenecks: [...] }   (M2.2)
//   GET /api/analytics/anomalies    → { anomalies: [...] }     (M2.3)
//
// Calculs 100% déterministes — pas d'appel LLM (offline-safe, rapide). Le
// client a un fallback miroir (src/lib/pipelineBottleneck.ts / anomalyDetect.ts).

import type { Env } from './types';
import { json } from './helpers';

// ── M2.2 : Bottleneck detection ─────────────────────────────────

interface StageRow {
  id: string;
  name: string;
  probability: number | null;
}

interface LeadStageRow {
  id: string;
  stage_id: string | null;
  updated_at: string | null;
  created_at: string | null;
}

interface Bottleneck {
  stageId: string;
  stageName: string;
  avgDays: number;
  baselineDays: number;
  stuckLeadIds: string[];
}

function daysFrom(dateStr: string | null): number {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

export async function handleGetPipelineBottlenecks(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL,
): Promise<Response> {
  const pipelineId = url.searchParams.get('pipeline_id') || undefined;

  // Stages du pipeline (ou par défaut si non précisé)
  let stages: StageRow[];
  if (pipelineId) {
    const r = await env.DB.prepare(
      `SELECT id, name, probability FROM pipeline_stages
       WHERE pipeline_id = ? ORDER BY sort_order ASC`,
    )
      .bind(pipelineId)
      .all<StageRow>();
    stages = (r.results || []) as StageRow[];
  } else {
    const def = await env.DB.prepare(
      `SELECT id FROM pipelines WHERE is_default = 1 LIMIT 1`,
    )
      .first<{ id: string }>()
      .catch(() => null);
    if (!def) return json({ data: { bottlenecks: [] } });
    const r = await env.DB.prepare(
      `SELECT id, name, probability FROM pipeline_stages
       WHERE pipeline_id = ? ORDER BY sort_order ASC`,
    )
      .bind(def.id)
      .all<StageRow>();
    stages = (r.results || []) as StageRow[];
  }
  if (stages.length === 0) return json({ data: { bottlenecks: [] } });

  const firstStageId = stages[0]?.id;
  const stageIds = stages.map((s) => s.id);
  const placeholders = stageIds.map(() => '?').join(',');
  const leadsRes = await env.DB.prepare(
    `SELECT id, stage_id, updated_at, created_at FROM leads
     WHERE (stage_id IN (${placeholders}) OR stage_id IS NULL)
       AND status NOT IN ('won','lost','closed')`,
  )
    .bind(...stageIds)
    .all<LeadStageRow>()
    .catch(() => ({ results: [] as LeadStageRow[] }));
  const leads = (leadsRes.results || []) as LeadStageRow[];

  const stageAvg: {
    stage: StageRow;
    avg: number;
    leadDays: Array<{ id: string; days: number }>;
  }[] = [];

  for (const stage of stages) {
    if (stage.probability === 0 || stage.probability === 100) continue;
    const stageLeads = leads.filter(
      (l) => (l.stage_id || firstStageId) === stage.id,
    );
    if (stageLeads.length === 0) continue;
    const leadDays = stageLeads.map((l) => ({
      id: l.id,
      days: daysFrom(l.updated_at || l.created_at),
    }));
    const avg = leadDays.reduce((s, d) => s + d.days, 0) / leadDays.length;
    stageAvg.push({ stage, avg, leadDays });
  }

  if (stageAvg.length === 0) return json({ data: { bottlenecks: [] } });

  const baseline = median(stageAvg.map((s) => s.avg));
  if (baseline <= 0) return json({ data: { bottlenecks: [] } });

  const bottlenecks: Bottleneck[] = [];
  for (const s of stageAvg) {
    if (s.leadDays.length < 3) continue;
    if (s.avg > baseline * 1.5) {
      bottlenecks.push({
        stageId: s.stage.id,
        stageName: s.stage.name,
        avgDays: Math.round(s.avg),
        baselineDays: Math.round(baseline),
        stuckLeadIds: s.leadDays
          .filter((d) => d.days >= baseline)
          .map((d) => d.id),
      });
    }
  }
  bottlenecks.sort((a, b) => b.avgDays - a.avgDays);

  return json({ data: { bottlenecks } });
}

// ── M2.3 : Activity anomaly alerts ──────────────────────────────

type AnomalySeverity = 'info' | 'warning' | 'critical';

interface Anomaly {
  metric: string;
  label: string;
  current: number;
  baseline: number;
  deltaPct: number;
  severity: AnomalySeverity;
}

const WEEK_MS = 7 * 86_400_000;

async function countSince(
  env: Env,
  sql: string,
  fromMs: number,
  toMs: number,
): Promise<number> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const row = await env.DB.prepare(sql)
    .bind(fromIso, toIso)
    .first<{ c: number }>()
    .catch(() => null);
  return Number(row?.c || 0);
}

export async function handleGetActivityAnomalies(
  env: Env,
  _auth: { userId: string; role: string },
): Promise<Response> {
  const now = Date.now();
  const currentFrom = now - WEEK_MS;
  // Baseline = moyenne hebdo des 4 semaines précédentes
  const baselineFrom = now - 5 * WEEK_MS;
  const baselineTo = now - WEEK_MS;

  type MetricDef = {
    metric: string;
    label: string;
    sql: string;
  };
  const metrics: MetricDef[] = [
    {
      metric: 'leads_created',
      label: 'nouveaux leads',
      sql: `SELECT COUNT(*) as c FROM leads WHERE created_at >= ? AND created_at < ?`,
    },
    {
      metric: 'messages_sent',
      label: 'messages envoyés',
      sql: `SELECT COUNT(*) as c FROM messages WHERE direction = 'outbound' AND created_at >= ? AND created_at < ?`,
    },
    {
      metric: 'tasks_done',
      label: 'tâches complétées',
      sql: `SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND updated_at >= ? AND updated_at < ?`,
    },
    {
      metric: 'appointments_booked',
      label: 'rendez-vous pris',
      sql: `SELECT COUNT(*) as c FROM appointments WHERE created_at >= ? AND created_at < ?`,
    },
  ];

  const anomalies: Anomaly[] = [];
  for (const m of metrics) {
    const current = await countSince(env, m.sql, currentFrom, now);
    const prior4 = await countSince(env, m.sql, baselineFrom, baselineTo);
    const baseline = prior4 / 4; // moyenne hebdo

    // Pas assez d'historique → on saute (évite faux positifs en démarrage)
    if (baseline < 3) continue;
    if (current >= baseline * 0.6) continue;

    const deltaPct = Math.round(((current - baseline) / baseline) * 100);
    const ratio = current / baseline;
    const severity: AnomalySeverity =
      ratio < 0.3 ? 'critical' : ratio < 0.5 ? 'warning' : 'info';

    anomalies.push({
      metric: m.metric,
      label: m.label,
      current,
      baseline: Math.round(baseline),
      deltaPct,
      severity,
    });
  }

  anomalies.sort((a, b) => a.deltaPct - b.deltaPct);
  return json({ data: { anomalies } });
}
