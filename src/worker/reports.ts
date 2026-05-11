// ── Module Reports — Intralys CRM ───────────────────────────
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

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
