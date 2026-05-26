// ── Module Reports — Intralys CRM ───────────────────────────
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
// LOT D Phase B Manager-B : helpers de bornage scope dashboard (READ-ONLY
// usage des exports `dashboards.ts` — JAMAIS de modif cross-module).
import { loadDashboardInTenant, auditDashboard } from './dashboards';
// Renforcement P2 (2026-05-26) — helpers PURS query DSL + export CSV.
// Additif strict — la validation inline existante (whitelists frozen :254-281)
// reste autoritaire ; ces helpers servent aux extensions futures (POST /api/
// reports/query DSL avancé + export CSV) sans casser le contrat figé.
import {
  validateQueryFilters as _validateQueryFilters,
  validateDateRange as _validateDateRange,
  validateGroupBy as _validateGroupBy,
  validateAggregation as _validateAggregation,
  formatExportCsv as _formatExportCsv,
  VALID_REPORT_SOURCES as _VALID_REPORT_SOURCES,
  VALID_REPORT_DIMENSIONS as _VALID_REPORT_DIMENSIONS,
  VALID_AGGREGATIONS as _VALID_AGGREGATIONS,
} from './lib/reports-engine';
void _validateQueryFilters;
void _validateDateRange;
void _validateGroupBy;
void _validateAggregation;
void _formatExportCsv;
void _VALID_REPORT_SOURCES;
void _VALID_REPORT_DIMENSIONS;
void _VALID_AGGREGATIONS;

export async function handleReportsOverview(
  env: Env, auth: { role: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const days = parseInt(url.searchParams.get('days') || '30');
  const clientId = url.searchParams.get('client_id') || null;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let clientFilter = '';
  const params: string[] = [since];
  if (clientId) {
    clientFilter = ' AND client_id = ?';
    params.push(clientId);
  }

  const totalLeads = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM leads WHERE created_at >= ?${clientFilter}`
  ).bind(...params).first() as { count: number };

  const convertedLeads = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM leads WHERE status IN ('won','closed') AND created_at >= ?${clientFilter}`
  ).bind(...params).first() as { count: number };

  const lostLeads = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM leads WHERE status = 'lost' AND created_at >= ?${clientFilter}`
  ).bind(...params).first() as { count: number };

  const avgConversion = await env.DB.prepare(
    `SELECT AVG(JULIANDAY(updated_at) - JULIANDAY(created_at)) as avg_days
     FROM leads WHERE status IN ('won','closed') AND created_at >= ?${clientFilter}`
  ).bind(...params).first() as { avg_days: number | null };

  const { results: dailyLeads } = await env.DB.prepare(
    `SELECT DATE(created_at) as date, COUNT(*) as count
     FROM leads WHERE created_at >= ?${clientFilter}
     GROUP BY DATE(created_at) ORDER BY date ASC`
  ).bind(...params).all();

  const { results: byStatus } = await env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM leads WHERE created_at >= ?${clientFilter}
     GROUP BY status ORDER BY count DESC`
  ).bind(...params).all();

  const { results: byType } = await env.DB.prepare(
    `SELECT type, COUNT(*) as count
     FROM leads WHERE created_at >= ?${clientFilter}
     GROUP BY type`
  ).bind(...params).all();

  const total = totalLeads?.count || 0;
  const converted = convertedLeads?.count || 0;
  const conversionRate = total > 0 ? (converted / total * 100) : 0;

  return json({
    data: {
      period_days: days,
      kpis: {
        total_leads: total,
        converted_leads: converted,
        lost_leads: lostLeads?.count || 0,
        conversion_rate: Math.round(conversionRate * 10) / 10,
        avg_conversion_days: avgConversion?.avg_days ? Math.round(avgConversion.avg_days * 10) / 10 : null,
      },
      charts: {
        daily_leads: dailyLeads || [],
        by_status: byStatus || [],
        by_type: byType || [],
      },
    },
  });
}

export async function handleReportsSources(
  env: Env, auth: { role: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const days = parseInt(url.searchParams.get('days') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { results: sources } = await env.DB.prepare(
    `SELECT
       source,
       COUNT(*) as total_leads,
       SUM(CASE WHEN status IN ('won','closed') THEN 1 ELSE 0 END) as converted,
       SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
       ROUND(SUM(CASE WHEN status IN ('won','closed') THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as conversion_rate
     FROM leads WHERE created_at >= ?
     GROUP BY source ORDER BY total_leads DESC`
  ).bind(since).all();

  return json({ data: { period_days: days, sources: sources || [] } });
}

export async function handleReportsConversion(
  env: Env, auth: { role: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const days = parseInt(url.searchParams.get('days') || '90');
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const funnel = [];
  const stages = [
    { status: 'new', label: 'Nouveaux' },
    { status: 'contacted', label: 'Contactés' },
    { status: 'qualified', label: 'Qualifié' },
    { status: 'won', label: 'Gagné' },
    { status: 'closed', label: 'Fermés' },
  ];

  const totalLeads = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM leads WHERE created_at >= ?'
  ).bind(since).first() as { count: number };

  for (const stage of stages) {
    const stageIndex = stages.findIndex(s => s.status === stage.status);
    const reachedStatuses = stages.slice(stageIndex).map(s => `'${s.status}'`).join(',');

    const count = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM leads WHERE status IN (${reachedStatuses}) AND created_at >= ?`
    ).bind(since).first() as { count: number };

    funnel.push({
      stage: stage.status,
      label: stage.label,
      count: count?.count || 0,
      percentage: totalLeads?.count ? Math.round((count?.count || 0) / totalLeads.count * 100) : 0,
    });
  }

  const { results: avgTimes } = await env.DB.prepare(
    `SELECT
       action,
       AVG(JULIANDAY(created_at) - JULIANDAY(
         (SELECT MIN(a2.created_at) FROM activity_log a2 WHERE a2.lead_id = activity_log.lead_id)
       )) as avg_days_from_creation
     FROM activity_log
     WHERE action LIKE 'status_%' AND created_at >= ?
     GROUP BY action`
  ).bind(since).all();

  return json({
    data: {
      period_days: days,
      total_leads: totalLeads?.count || 0,
      funnel,
      avg_stage_times: avgTimes || [],
    },
  });
}

// ── Saved Reports ───────────────────────────────────────────

export async function handleGetSavedReports(env: Env, auth: any): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM saved_reports WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(auth.id || '1').all();
  
  return json({ data: results || [] });
}

export async function handleCreateSavedReport(request: Request, env: Env, auth: any): Promise<Response> {
  const body = await request.json() as any;
  const name = sanitizeInput(body.name);
  const type = sanitizeInput(body.type);
  const config = body.config_json ? JSON.stringify(body.config_json) : '{}';

  if (!name || !type) return json({ error: 'Name and type required' }, 400);

  const id = crypto.randomUUID();
  const userId = auth.id || '1';
  const clientId = request.headers.get('X-Client-Id') || null;

  await env.DB.prepare(
    'INSERT INTO saved_reports (id, user_id, client_id, name, type, config_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, clientId, name, type, config).run();

  return json({ data: { id, name, type, config_json: config } }, 201);
}

export async function handleDeleteSavedReport(env: Env, auth: any, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM saved_reports WHERE id = ? AND user_id = ?').bind(id, auth.id || '1').run();
  return json({ data: { success: true } });
}

// ── LOT D Reports Builder Hardening (2026-05-20) ─────────────
// POST /api/reports/widget — dispatcher UNIQUE bornage tenant pour le wiring
// `_dashboardCharts.tsx` (Phase B Manager-C remplace `sampleSeries(seed)` par
// `useWidgetData(widget)`). UNE SEULE route (anti-prolifération d'endpoints
// non-tenant-bornés). Body figé Phase A : `{ source, dimension, metric,
// filters?, dashboard_id? }`. Source ∈ { 'leads' | 'tasks' | 'orders' |
// 'invoices' | 'agency' } — dispatch interne Phase B vers les modules
// existants (ecommerce-analytics / clients-admin handleGetAgencyReports /
// leads / tasks bornés `auth.tenant.accessibleClientIds`). AUCUNE nouvelle
// source data — réutilisation pure des moteurs existants.
//
// Garde capability mode-agence-only (calque LOT B-bis / dashboards.ts:
// reportsCapGuard) : 'reports.view' suffit en lecture (un widget = une
// lecture agrégée). Legacy/mono-tenant → set legacy LARGE ⇒ pas de bridage.
// Mode agence → enforcement réel.
//
// État : IMPLÉMENTÉ. Dispatcher complet (par `source` → handler existant
// tenant-borné) + audit `dashboard_audit_log` (seq 88) écrits.
//
// ⚠ JAMAIS d'exposition de tables E4/E6 régulées (payments / payment_events /
// refunds / disputes / return_requests) côté widget — la liste blanche
// `source` ci-dessus est EXHAUSTIVE.

type WidgetAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

interface RunReportWidgetBody {
  source?: unknown;
  dimension?: unknown;
  metric?: unknown;
  filters?: unknown;
  dashboard_id?: unknown;
}

interface WidgetFilters {
  dateRange?: '7d' | '30d' | '90d' | '12m' | 'all';
  source?: string | null;
  status?: string | null;
  tags?: string[];
}

interface WidgetSeriesPoint {
  name: string;
  value: number;
}

interface WidgetRunOutput {
  series: WidgetSeriesPoint[];
  total: number;
  delta?: number;
}

// ── Whitelists STRICTES (DashboardBuilder.tsx fait foi) ────────────────────
// Sources canoniques du builder (5) :
const ALLOWED_SOURCES = new Set([
  'leads',
  'tasks',
  'conversations',
  'events',
  'invoices',
  // 'orders' / 'agency' = alias additifs côté backend (DashboardBuilder n'a
  // pas ces sources nativement, mais le brief les liste — on tolère silencieux
  // pour permettre extension future SANS modifier DashboardBuilder.tsx).
  'orders',
  'agency',
]);

// Metrics builder (6) :
const ALLOWED_METRICS = new Set(['count', 'sum', 'avg', 'median', 'min', 'max']);

// Dimensions builder (8) :
const ALLOWED_DIMENSIONS = new Set([
  'source',
  'status',
  'type',
  'owner',
  'client',
  'date',
  'week',
  'month',
]);

// Mapping `dimension` → colonne SQL réelle par `source`. Map vide ⇒ dimension
// non supportée pour cette source (renvoie série vide, jamais 500).
const DIMENSION_COLUMN: Record<string, Record<string, string>> = {
  leads: {
    source: 'COALESCE(NULLIF(source, \'\'), \'direct\')',
    status: 'status',
    type: 'COALESCE(NULLIF(type, \'\'), \'\')',
    owner: 'COALESCE(NULLIF(assigned_to, \'\'), \'\')',
    client: 'client_id',
    date: "substr(created_at, 1, 10)",
    week: "strftime('%Y-W%W', created_at)",
    month: "substr(created_at, 1, 7)",
  },
  tasks: {
    status: 'status',
    owner: 'COALESCE(NULLIF(assigned_to, \'\'), \'\')',
    client: 'client_id',
    date: "substr(created_at, 1, 10)",
    week: "strftime('%Y-W%W', created_at)",
    month: "substr(created_at, 1, 7)",
    // 'type' = priority pour les tasks (proxy raisonnable).
    type: 'priority',
  },
  invoices: {
    status: 'status',
    client: 'client_id',
    date: "substr(created_at, 1, 10)",
    week: "strftime('%Y-W%W', created_at)",
    month: "substr(created_at, 1, 7)",
  },
  // conversations/events/orders/agency : géré via handlers dédiés (pas SQL
  // direct ici — voir runOrdersSource / runAgencySource ci-dessous).
};

// Mapping `metric` → expression SQL agrégée par source/dimension. Format clé :
// `${source}|${metric}`. Si absent → COUNT(*) par défaut sécurisé.
const METRIC_EXPR: Record<string, string> = {
  'leads|count': 'COUNT(*)',
  'leads|sum': 'COALESCE(SUM(deal_value), 0)',
  'leads|avg': 'COALESCE(AVG(deal_value), 0)',
  'leads|min': 'COALESCE(MIN(deal_value), 0)',
  'leads|max': 'COALESCE(MAX(deal_value), 0)',
  // SQLite n'a pas MEDIAN natif → fallback AVG (raisonnable, jamais 500).
  'leads|median': 'COALESCE(AVG(deal_value), 0)',
  'tasks|count': 'COUNT(*)',
  // Tasks n'ont pas de montant — sum/avg/min/max retombent sur COUNT.
  'tasks|sum': 'COUNT(*)',
  'tasks|avg': 'COUNT(*)',
  'tasks|min': 'COUNT(*)',
  'tasks|max': 'COUNT(*)',
  'tasks|median': 'COUNT(*)',
  'invoices|count': 'COUNT(*)',
  'invoices|sum': 'COALESCE(SUM(amount), 0)',
  'invoices|avg': 'COALESCE(AVG(amount), 0)',
  'invoices|min': 'COALESCE(MIN(amount), 0)',
  'invoices|max': 'COALESCE(MAX(amount), 0)',
  'invoices|median': 'COALESCE(AVG(amount), 0)',
};

// Fenêtres temporelles (dateRange filter) → since SQL.
function resolveSince(dateRange: string | undefined): string | null {
  switch (dateRange) {
    case '7d':
      return new Date(Date.now() - 7 * 86400000).toISOString();
    case '30d':
      return new Date(Date.now() - 30 * 86400000).toISOString();
    case '90d':
      return new Date(Date.now() - 90 * 86400000).toISOString();
    case '12m':
      return new Date(Date.now() - 365 * 86400000).toISOString();
    case 'all':
    default:
      return null;
  }
}

// Limite dure par requête (anti-explosion résultat — un widget = ≤ 100 buckets).
const WIDGET_BUCKET_LIMIT = 100;

// Vrai si l'appel est legacy/mono-tenant (calque dashboards.ts:isLegacy).
function isLegacyAuth(auth: WidgetAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

// ── Dispatcher SQL générique leads/tasks/invoices (sources DB directes) ────
// Whitelist stricte par binding paramétré. Bornage tenant DUR en mode agence :
// `WHERE client_id IN (...)` avec accessibleClientIds. Legacy : pas de filtre
// tenant ajouté (rétro-compat byte-équivalente — handlers historiques ne
// filtraient pas par tenant non plus).
async function runGenericSource(
  env: Env,
  auth: WidgetAuth,
  source: 'leads' | 'tasks' | 'invoices',
  dimension: string,
  metric: string,
  filters: WidgetFilters,
): Promise<WidgetRunOutput> {
  const dimMap = DIMENSION_COLUMN[source] || {};
  const dimSql = dimMap[dimension];
  if (!dimSql) {
    return { series: [], total: 0 };
  }
  const metricSql = METRIC_EXPR[`${source}|${metric}`] || 'COUNT(*)';

  // ── Build WHERE ───────────────────────────────────────────────────────
  const where: string[] = [];
  const binds: any[] = [];

  // Bornage tenant — DUR en mode agence, no-op en legacy.
  if (!isLegacyAuth(auth)) {
    const accessible = auth.tenant!.accessibleClientIds || [];
    if (accessible.length === 0) {
      // Pas d'accès → série vide (jamais 500).
      return { series: [], total: 0 };
    }
    const ph = accessible.map(() => '?').join(',');
    where.push(`client_id IN (${ph})`);
    for (const c of accessible) binds.push(c);
  }

  // Filtre date (dateRange).
  const since = resolveSince(filters.dateRange);
  if (since) {
    where.push('created_at >= ?');
    binds.push(since);
  }

  // Filtre status (whitelist alphanumérique stricte).
  if (filters.status && typeof filters.status === 'string') {
    const safe = filters.status.replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    if (safe.length > 0) {
      where.push('status = ?');
      binds.push(safe);
    }
  }

  // Filtre source (lead `source` field) — applicable uniquement pour `leads`.
  if (source === 'leads' && filters.source && typeof filters.source === 'string') {
    const safe = filters.source.replace(/[^a-z0-9_\-. ]/gi, '').slice(0, 64);
    if (safe.length > 0) {
      where.push('source = ?');
      binds.push(safe);
    }
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

  const sql =
    `SELECT (${dimSql}) AS bucket, ${metricSql} AS val
       FROM ${source}` +
    whereSql +
    ` GROUP BY bucket
        ORDER BY val DESC
        LIMIT ${WIDGET_BUCKET_LIMIT}`;

  let results: Array<{ bucket: string | null; val: number | null }> = [];
  try {
    const r = await env.DB.prepare(sql).bind(...binds).all();
    results = (r.results || []) as Array<{ bucket: string | null; val: number | null }>;
  } catch {
    // Table absente / colonne manquante : best-effort vide.
    return { series: [], total: 0 };
  }

  let total = 0;
  const series: WidgetSeriesPoint[] = results.map((row) => {
    const v = Number(row.val) || 0;
    total += v;
    return {
      name: row.bucket == null || row.bucket === '' ? '(vide)' : String(row.bucket),
      value: Math.round(v * 100) / 100,
    };
  });

  return { series, total: Math.round(total * 100) / 100 };
}

// ── Dispatcher source 'orders' — RÉUTILISE ecommerce-analytics ────────────
// Lecture seule via SQL direct sur la table `orders` (bornée tenant). Évite
// la dépendance circulaire et le coût d'un import dynamique. Pattern calqué
// sur ecommerce-analytics.ts:handleEcommerceSalesByChannel (group by mois /
// canal / devise, jamais sommé cross-devise — ici on simplifie : un widget =
// une dimension primaire, le multi-devise est respecté par GROUP BY currency
// dans la mesure où la dimension `currency` n'est pas exposée par le builder
// actuel ; on borne les montants à CAD pour éviter sum cross-devise).
async function runOrdersSource(
  env: Env,
  auth: WidgetAuth,
  dimension: string,
  metric: string,
  filters: WidgetFilters,
): Promise<WidgetRunOutput> {
  // Mapping dimension orders → colonne (sous-ensemble pertinent pour widgets).
  const ORDERS_DIM: Record<string, string> = {
    status: 'status',
    client: 'client_id',
    source: 'LOWER(COALESCE(NULLIF(source, \'\'), \'web\'))',
    date: "substr(COALESCE(placed_at, created_at), 1, 10)",
    week: "strftime('%Y-W%W', COALESCE(placed_at, created_at))",
    month: "substr(COALESCE(placed_at, created_at), 1, 7)",
  };
  const dimSql = ORDERS_DIM[dimension];
  if (!dimSql) return { series: [], total: 0 };

  const metricSql =
    metric === 'count'
      ? 'COUNT(*)'
      : metric === 'sum'
        ? 'COALESCE(SUM(total_cents), 0)'
        : metric === 'avg'
          ? 'COALESCE(AVG(total_cents), 0)'
          : metric === 'min'
            ? 'COALESCE(MIN(total_cents), 0)'
            : metric === 'max'
              ? 'COALESCE(MAX(total_cents), 0)'
              : 'COALESCE(AVG(total_cents), 0)'; // median fallback avg

  const where: string[] = [];
  const binds: any[] = [];

  // Multi-devise garde-fou (ecommerce-analytics §10-14 figé) : si on agrège
  // un montant, on borne aux orders CAD (devise par défaut) pour éviter sum
  // cross-devise. Pour `count`, pas de restriction (pas de montant agrégé).
  if (metric !== 'count') {
    where.push("UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) = 'CAD'");
  }

  // Bornage tenant.
  if (!isLegacyAuth(auth)) {
    const accessible = auth.tenant!.accessibleClientIds || [];
    if (accessible.length === 0) return { series: [], total: 0 };
    const ph = accessible.map(() => '?').join(',');
    where.push(`client_id IN (${ph})`);
    for (const c of accessible) binds.push(c);
  }

  const since = resolveSince(filters.dateRange);
  if (since) {
    where.push('COALESCE(placed_at, created_at) >= ?');
    binds.push(since.slice(0, 19).replace('T', ' '));
  }

  if (filters.status && typeof filters.status === 'string') {
    const safe = filters.status.replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    if (safe.length > 0) {
      where.push('status = ?');
      binds.push(safe);
    }
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const sql =
    `SELECT (${dimSql}) AS bucket, ${metricSql} AS val
       FROM orders` +
    whereSql +
    ` GROUP BY bucket
        ORDER BY val DESC
        LIMIT ${WIDGET_BUCKET_LIMIT}`;

  let results: Array<{ bucket: string | null; val: number | null }> = [];
  try {
    const r = await env.DB.prepare(sql).bind(...binds).all();
    results = (r.results || []) as Array<{ bucket: string | null; val: number | null }>;
  } catch {
    return { series: [], total: 0 };
  }

  let total = 0;
  const series: WidgetSeriesPoint[] = results.map((row) => {
    const v = Number(row.val) || 0;
    total += v;
    return {
      name: row.bucket == null || row.bucket === '' ? '(vide)' : String(row.bucket),
      value: Math.round(v * 100) / 100,
    };
  });
  return { series, total: Math.round(total * 100) / 100 };
}

// ── Dispatcher source 'agency' — agrégat cross-sous-comptes ────────────────
// Réutilise la logique de clients-admin.handleGetAgencyReports : agrégat
// leads par sous-compte borné à `auth.tenant.accessibleClientIds`. Si pas en
// mode agence ou accessibleClientIds vide → série vide.
async function runAgencySource(
  env: Env,
  auth: WidgetAuth,
  _dimension: string,
  metric: string,
  _filters: WidgetFilters,
): Promise<WidgetRunOutput> {
  if (isLegacyAuth(auth)) return { series: [], total: 0 };
  const accessible = auth.tenant!.accessibleClientIds || [];
  if (accessible.length === 0) return { series: [], total: 0 };

  const ph = accessible.map(() => '?').join(',');
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id AS client_id,
              c.name AS client_name,
              COUNT(l.id) AS lead_count,
              SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won_count
         FROM clients c
         LEFT JOIN leads l ON l.client_id = c.id
        WHERE c.id IN (${ph})
        GROUP BY c.id, c.name
        ORDER BY lead_count DESC
        LIMIT ${WIDGET_BUCKET_LIMIT}`,
    )
      .bind(...accessible)
      .all();

    let total = 0;
    const series: WidgetSeriesPoint[] = (results || []).map((r) => {
      const row = r as {
        client_id: string;
        client_name: string | null;
        lead_count: number | null;
        won_count: number | null;
      };
      const leads = Number(row.lead_count) || 0;
      const won = Number(row.won_count) || 0;
      const val =
        metric === 'count'
          ? leads
          : metric === 'sum'
            ? won
            : leads > 0
              ? Math.round((won / leads) * 100)
              : 0;
      total += val;
      return {
        name: row.client_name || row.client_id,
        value: val,
      };
    });
    return { series, total };
  } catch {
    return { series: [], total: 0 };
  }
}

// ── Sources conversations / events : pas de table normalisée garantie ──────
// On retombe sur série vide (jamais 500) — extension future si tables
// `messages`/`activity_log` exposées. activity_log est lisible mais le
// modèle widget builder ne distingue pas events vs activity_log au niveau
// schema, on reste prudent et conservateur.

// ── LOT D Reports Builder Hardening (2026-05-20) — DISPATCHER RÉEL ────────
// POST /api/reports/widget — UNE SEULE route, dispatch par body.source.
// Bornage tenant DUR en mode agence (auth.tenant.accessibleClientIds).
// Legacy/mono-tenant : comportement byte-équivalent aux handlers historiques
// (pas de filtre tenant additionnel — set legacy LARGE).
//
// Garde capability mode-agence-only (calque LOT B-bis / dashboards.ts:
// reportsCapGuard) : 'reports.view' en lecture (widget = lecture agrégée).
//
// ⚠ JAMAIS d'exposition de tables E4/E6 régulées (payments / payment_events /
// refunds / disputes / return_requests). La whitelist `source` est
// EXHAUSTIVE et exclut ces tables.
//
// Audit `dashboard_audit_log` (seq 88) action='widget_run' best-effort si
// `dashboard_id` fourni — corrélation widget→dashboard pour anti-abus.
export async function handleRunReportWidget(
  request: Request,
  env: Env,
  auth: WidgetAuth,
): Promise<Response> {
  // Garde mode-agence-only (calque LOT B-bis). Legacy/mono-tenant : set
  // legacy LARGE ⇒ aucune régression. Mode agence : enforcement réel.
  if (auth?.tenant && auth.tenant.agencyId != null && auth.capabilities) {
    const g = requireCapability(auth.capabilities, 'reports.view');
    if (g) return g;
  }

  // ── Parse body strict ─────────────────────────────────────────────────
  let body: RunReportWidgetBody = {};
  try {
    body = (await request.json()) as RunReportWidgetBody;
  } catch {
    return json({ error: 'Payload invalide' }, 400);
  }
  const source =
    typeof body.source === 'string' ? sanitizeInput(body.source).slice(0, 60) : '';
  const dimension =
    typeof body.dimension === 'string'
      ? sanitizeInput(body.dimension).slice(0, 60)
      : '';
  const metric =
    typeof body.metric === 'string' ? sanitizeInput(body.metric).slice(0, 60) : '';
  const dashboardId =
    typeof body.dashboard_id === 'number' ||
    (typeof body.dashboard_id === 'string' && /^\d+$/.test(body.dashboard_id))
      ? String(body.dashboard_id)
      : null;

  // Whitelist STRICTE (anti-injection — jamais de string libre dans le SQL).
  if (!ALLOWED_SOURCES.has(source)) {
    return json({ error: 'Source invalide' }, 400);
  }
  if (!ALLOWED_DIMENSIONS.has(dimension)) {
    return json({ error: 'Dimension invalide' }, 400);
  }
  if (!ALLOWED_METRICS.has(metric)) {
    return json({ error: 'Métrique invalide' }, 400);
  }

  // Filtres optionnels : objet plat, whitelist clé par clé.
  const rawFilters =
    body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : {};
  const filters: WidgetFilters = {};
  if (
    typeof rawFilters.dateRange === 'string' &&
    ['7d', '30d', '90d', '12m', 'all'].includes(rawFilters.dateRange)
  ) {
    filters.dateRange = rawFilters.dateRange as WidgetFilters['dateRange'];
  }
  if (typeof rawFilters.source === 'string') {
    filters.source = sanitizeInput(rawFilters.source).slice(0, 64);
  }
  if (typeof rawFilters.status === 'string') {
    filters.status = sanitizeInput(rawFilters.status).slice(0, 32);
  }
  if (Array.isArray(rawFilters.tags)) {
    filters.tags = (rawFilters.tags as unknown[])
      .filter((t): t is string => typeof t === 'string')
      .map((t) => sanitizeInput(t).slice(0, 40))
      .slice(0, 16);
  }

  // Si dashboard_id fourni : vérifier appartenance tenant via loadDashboardInTenant.
  // DashboardAuth & WidgetAuth ont la même forme structurelle (CapAuth +
  // capabilities? + id?) — TS structural typing accepte le passage direct.
  if (dashboardId != null) {
    const owned = await loadDashboardInTenant(env, dashboardId, auth);
    if (!owned) {
      // Hors périmètre : 404 (zéro leak data).
      return json({ error: 'Dashboard introuvable' }, 404);
    }
    // Audit corrélation widget→dashboard (best-effort).
    const userId = (auth as { id?: string }).id || auth?.userId || null;
    void auditDashboard(env, dashboardId, userId, 'widget_run', request);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────
  let out: WidgetRunOutput;
  switch (source) {
    case 'leads':
    case 'tasks':
    case 'invoices':
      out = await runGenericSource(env, auth, source, dimension, metric, filters);
      break;
    case 'orders':
      out = await runOrdersSource(env, auth, dimension, metric, filters);
      break;
    case 'agency':
      out = await runAgencySource(env, auth, dimension, metric, filters);
      break;
    case 'conversations':
    case 'events':
    default:
      // Sources sans table normalisée widget-friendly : série vide (jamais 500).
      out = { series: [], total: 0 };
      break;
  }

  return json({ data: out });
}

// ── LOT ATTRIBUTION-D (2026-05-21) — Attribution multi-touch & cohortes leads ──
// 2 handlers LECTURE/AGRÉGAT bornés tenant. Garde capability mode-agence-only
// (calque handleRunReportWidget:652 / dashboards.ts reportsCapGuard) :
// 'reports.view' en lecture. Legacy/mono-tenant → set legacy LARGE ⇒ pas de
// bridage, comportement byte-équivalent.
//
// ⚠ HONNÊTETÉ (tracée docs/LOT-ATTRIBUTION-D.md §0/§6.A) :
//   - Attribution = multi-touch PROSPECTIF. Tant qu'1 seul touch/lead (cas
//     général tant que les leads ne sont pas ré-ingérés multi-source APRÈS
//     livraison), les 4 modèles (first/last/linéaire/time-decay) CONVERGENT.
//   - Cohortes leads = RÉTROACTIVES (JS sur leads.created_at + statut avancé),
//     calculables sur la donnée EXISTANTE (calque ecommerce handleEcommerceCohorts).
//
// État : IMPLÉMENTÉ (4 modèles d'attribution sur lead_touchpoints + cohortes JS).
//
// ⚠ JAMAIS d'exposition de tables E4/E6 régulées — lecture leads + lead_touchpoints
//   uniquement (acquisition), bornées client_id.

// Ventilation d'une source d'acquisition selon les 4 modèles d'attribution.
interface AttributionSourceRow {
  source: string;
  first_touch: number;
  last_touch: number;
  linear: number;
  time_decay: number;
}

// Cohorte de leads par mois d'acquisition (calque ecommerce CohortRow).
interface LeadCohortRow {
  month: string;
  size: number;
  retention: number[];
}

// GET /api/reports/attribution — répartition des conversions par modèle
// d'attribution multi-touch (first/last/linear/time-decay) + ventilation par
// source. État : IMPLÉMENTÉ (fallback vide { models: {}, by_source: [] }).
export async function handleReportsAttribution(
  env: Env,
  auth: WidgetAuth,
  url: URL,
): Promise<Response> {
  // Garde mode-agence-only (calque handleRunReportWidget:652).
  if (auth?.tenant && auth.tenant.agencyId != null && auth.capabilities) {
    const g = requireCapability(auth.capabilities, 'reports.view');
    if (g) return g;
  }

  const empty = { models: {}, by_source: [] as AttributionSourceRow[] };

  try {
    // ── Bornage tenant DUR (mode agence) / no-op (legacy) — JAMAIS le body. ──
    const where: string[] = [];
    const binds: any[] = [];
    if (!isLegacyAuth(auth)) {
      const accessible = auth.tenant!.accessibleClientIds || [];
      if (accessible.length === 0) return json({ data: empty });
      const ph = accessible.map(() => '?').join(',');
      where.push(`client_id IN (${ph})`);
      for (const c of accessible) binds.push(c);
    }

    // Filtre optionnel ?days= (fenêtre sur occurred_at). Défaut : tout.
    const rawDays = parseInt(url.searchParams.get('days') || '', 10);
    if (Number.isFinite(rawDays) && rawDays > 0) {
      const since = new Date(Date.now() - rawDays * 86400000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      where.push('occurred_at >= ?');
      binds.push(since);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    // Lecture bornée : touchpoints du tenant, ordonnés par lead + touch_order
    // (support direct des modèles first/last et du poids time-decay ordonné).
    // LIMIT dur de sécurité (anti-scan non borné).
    const sql =
      `SELECT lead_id, touch_order, source, occurred_at
         FROM lead_touchpoints` +
      whereSql +
      ` ORDER BY lead_id ASC, touch_order ASC
         LIMIT 50000`;

    let rows: Array<{
      lead_id: string | null;
      touch_order: number | null;
      source: string | null;
      occurred_at: string | null;
    }> = [];
    const r = await env.DB.prepare(sql).bind(...binds).all();
    rows = (r.results || []) as typeof rows;

    if (rows.length === 0) return json({ data: empty });

    // ── Regroupement par lead (touchs déjà triés par touch_order ASC). ──────
    interface Touch {
      source: string;
      order: number;
      occurredMs: number;
    }
    const byLead = new Map<string, Touch[]>();
    for (const row of rows) {
      const lid = row.lead_id == null ? '' : String(row.lead_id);
      if (!lid) continue;
      const src =
        row.source == null || String(row.source).trim() === ''
          ? '(direct)'
          : String(row.source).trim();
      const occ = row.occurred_at ? Date.parse(String(row.occurred_at).replace(' ', 'T') + 'Z') : NaN;
      const arr = byLead.get(lid) || [];
      arr.push({
        source: src,
        order: Number(row.touch_order) || 0,
        occurredMs: Number.isFinite(occ) ? occ : 0,
      });
      byLead.set(lid, arr);
    }

    // ── Accumulateurs de crédit par source pour les 4 modèles. ──────────────
    // HONNÊTETÉ : tant qu'1 seul touch/lead (cas général prospectif), les 4
    // modèles CONVERGENT (le touch unique reçoit 100% du crédit dans chaque
    // modèle). La divergence n'apparaît que pour les leads multi-touch.
    const credit = new Map<
      string,
      { first: number; last: number; linear: number; time_decay: number }
    >();
    const bump = (
      src: string,
      model: 'first' | 'last' | 'linear' | 'time_decay',
      v: number,
    ) => {
      let c = credit.get(src);
      if (!c) {
        c = { first: 0, last: 0, linear: 0, time_decay: 0 };
        credit.set(src, c);
      }
      c[model] += v;
    };

    const HALF_LIFE_MS = 7 * 86400000; // demi-vie 7j (poids time-decay).

    for (const touches of byLead.values()) {
      if (touches.length === 0) continue;
      // Tri défensif (déjà ORDER BY, mais on garantit l'ordre logique).
      touches.sort((a, b) => a.order - b.order || a.occurredMs - b.occurredMs);

      // 1 crédit de conversion par lead, réparti selon chaque modèle.
      // first-touch : 100% au premier touch.
      bump(touches[0]!.source, 'first', 1);
      // last-touch : 100% au dernier touch.
      bump(touches[touches.length - 1]!.source, 'last', 1);
      // linéaire : 1/n par touch.
      const share = 1 / touches.length;
      for (const t of touches) bump(t.source, 'linear', share);
      // time-decay : poids 2^(-Δt/demi-vie) relatif au dernier touch, normalisé
      //   à somme=1 sur le lead. 1 seul touch → poids 1 (convergence first/last).
      const lastMs = touches[touches.length - 1]!.occurredMs;
      const weights = touches.map((t) =>
        lastMs > 0 && t.occurredMs > 0
          ? Math.pow(2, -(lastMs - t.occurredMs) / HALF_LIFE_MS)
          : 1,
      );
      const wSum = weights.reduce((s, w) => s + w, 0) || touches.length;
      for (let i = 0; i < touches.length; i++) {
        bump(touches[i]!.source, 'time_decay', weights[i]! / wSum);
      }
    }

    // ── Ventilation par source (triée par crédit linéaire desc). ────────────
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const bySource: AttributionSourceRow[] = Array.from(credit.entries())
      .map(([source, c]) => ({
        source,
        first_touch: round2(c.first),
        last_touch: round2(c.last),
        linear: round2(c.linear),
        time_decay: round2(c.time_decay),
      }))
      .sort((a, b) => b.linear - a.linear)
      .slice(0, 100);

    // Totaux agrégés par modèle (somme des crédits sur toutes les sources =
    // nombre de leads avec ≥ 1 touch, par construction).
    const models = {
      first_touch: round2(bySource.reduce((s, r2) => s + r2.first_touch, 0)),
      last_touch: round2(bySource.reduce((s, r2) => s + r2.last_touch, 0)),
      linear: round2(bySource.reduce((s, r2) => s + r2.linear, 0)),
      time_decay: round2(bySource.reduce((s, r2) => s + r2.time_decay, 0)),
    };

    return json({ data: { models, by_source: bySource } });
  } catch {
    // Table `lead_touchpoints` absente / D1 indispo : best-effort vide.
    return json({ data: empty });
  }
}

// GET /api/reports/lead-cohorts — cohortes de leads par mois d'acquisition
// (created_at), rétention = % ayant atteint un statut avancé (contacted/
// qualified/won/closed) à M+i. État : IMPLÉMENTÉ (fallback vide { cohorts: [] }).
export async function handleReportsLeadCohorts(
  env: Env,
  auth: WidgetAuth,
  url: URL,
): Promise<Response> {
  // Garde mode-agence-only (calque handleRunReportWidget:652).
  if (auth?.tenant && auth.tenant.agencyId != null && auth.capabilities) {
    const g = requireCapability(auth.capabilities, 'reports.view');
    if (g) return g;
  }
  void url;

  const COHORT_MONTHS = 12; // fenêtre cohortes bornée (calque ecommerce).
  // Statuts « avancés » = lead qui a progressé au-delà de l'acquisition brute.
  const ADVANCED_STATUSES = new Set(['contacted', 'qualified', 'won', 'closed']);

  try {
    // ── Bornage tenant DUR (mode agence) / no-op (legacy) — JAMAIS le body. ──
    const where: string[] = [];
    const binds: any[] = [];
    if (!isLegacyAuth(auth)) {
      const accessible = auth.tenant!.accessibleClientIds || [];
      if (accessible.length === 0) return json({ data: { cohorts: [] as LeadCohortRow[] } });
      const ph = accessible.map(() => '?').join(',');
      where.push(`client_id IN (${ph})`);
      for (const c of accessible) binds.push(c);
    }

    // Fenêtre 12 mois glissants (borne dure, calque ecommerce).
    const since = new Date();
    since.setMonth(since.getMonth() - COHORT_MONTHS);
    const sinceIso = since.toISOString().slice(0, 19).replace('T', ' ');
    where.push('created_at >= ?');
    binds.push(sinceIso);

    const whereSql = ` WHERE ${where.join(' AND ')}`;
    const sql =
      `SELECT created_at, status FROM leads` + whereSql + ` LIMIT 50000`;

    const r = await env.DB.prepare(sql).bind(...binds).all();
    const rows = (r.results || []) as Array<{
      created_at: string | null;
      status: string | null;
    }>;
    if (rows.length === 0) return json({ data: { cohorts: [] as LeadCohortRow[] } });

    // Index mois absolu (depuis epoch) — offset M+i sans dérive (calque ecommerce).
    const monthIdx = (ym: string): number => {
      const parts = ym.split('-').map((n) => parseInt(n, 10));
      return (parts[0] ?? 0) * 12 + ((parts[1] ?? 1) - 1);
    };
    const monthOf = (iso: string | null): string | null => {
      if (!iso) return null;
      const s = String(iso);
      return s.length >= 7 ? s.slice(0, 7) : null;
    };

    // Regroupe par mois d'acquisition (created_at). size = leads créés ce mois.
    // advanced = leads de la cohorte ayant atteint un statut avancé.
    // RÉTROACTIF : un lead « avancé » est compté comme retenu à TOUS les M+i
    // jusqu'à la profondeur de la cohorte (le statut est l'état courant, on ne
    // dispose pas de l'historique de transition par mois — honnêteté : la
    // rétention reflète l'état ACTUEL projeté sur la profondeur, pas une
    // ré-activation mensuelle comme l'e-commerce).
    const cohortSize = new Map<string, number>();
    const cohortAdvanced = new Map<string, number>();
    for (const row of rows) {
      const ym = monthOf(row.created_at);
      if (!ym) continue;
      cohortSize.set(ym, (cohortSize.get(ym) || 0) + 1);
      const st = (row.status || '').toLowerCase();
      if (ADVANCED_STATUSES.has(st)) {
        cohortAdvanced.set(ym, (cohortAdvanced.get(ym) || 0) + 1);
      }
    }

    const nowIdx = monthIdx(new Date().toISOString().slice(0, 7));
    const cohorts: LeadCohortRow[] = [];
    const sortedMonths = Array.from(cohortSize.keys()).sort();
    for (const cm of sortedMonths) {
      const size = cohortSize.get(cm) || 0;
      const advanced = cohortAdvanced.get(cm) || 0;
      const advancedPct = size > 0 ? Math.round((advanced / size) * 100) : 0;
      // Profondeur = nb de mois entre la cohorte et maintenant (borné 12).
      const depth = Math.min(COHORT_MONTHS, nowIdx - monthIdx(cm) + 1);
      const retention: number[] = [];
      for (let i = 0; i < Math.max(1, depth); i++) {
        // M+0 = 100% (mois d'acquisition, tous les leads présents). M+i (i≥1) =
        // % de la cohorte ayant atteint un statut avancé (état projeté).
        retention.push(i === 0 ? 100 : advancedPct);
      }
      cohorts.push({ month: cm, size, retention });
    }

    return json({ data: { cohorts } });
  } catch {
    // Table `leads` absente / D1 indispo : best-effort vide.
    return json({ data: { cohorts: [] as LeadCohortRow[] } });
  }
}
