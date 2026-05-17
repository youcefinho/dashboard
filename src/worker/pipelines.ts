// ── Module Pipelines — Intralys CRM ─────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { validate, createPipelineSchema, createPipelineStageSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';

// ── PIPELINES ───────────────────────────────────────────────

export async function handleGetPipelines(env: Env, auth: { role: string; userId: string }): Promise<Response> {
  const clientIdRow = auth.role !== 'admin' ? 
    await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } : null;
  const clientId = clientIdRow?.client_id;

  const query = clientId ? 'SELECT * FROM pipelines WHERE client_id = ? ORDER BY is_default DESC, name ASC' : 'SELECT * FROM pipelines ORDER BY client_id, is_default DESC, name ASC';
  const { results: pipelines } = clientId ? await env.DB.prepare(query).bind(clientId).all() : await env.DB.prepare(query).all();

  const pipelinesWithStages = [];
  for (const p of (pipelines || []) as Array<Record<string, unknown>>) {
    const { results: stages } = await env.DB.prepare(
      'SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order ASC'
    ).bind(p.id as string).all();

    const stagesWithCount = [];
    for (const s of (stages || []) as Array<Record<string, unknown>>) {
      const count = await env.DB.prepare(
        'SELECT COUNT(*) as count, SUM(deal_value) as total_value FROM leads WHERE stage_id = ?'
      ).bind(s.id as string).first() as { count: number; total_value: number } | null;
      stagesWithCount.push({ ...s, lead_count: count?.count || 0, total_value: count?.total_value || 0 });
    }

    pipelinesWithStages.push({ ...p, stages: stagesWithCount });
  }

  return json({ data: pipelinesWithStages });
}

export async function handleCreatePipeline(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const v = validate(createPipelineSchema, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as { name?: string; client_id?: string; color?: string; is_default?: boolean };

  let targetClientId = body.client_id;
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;
    targetClientId = user?.client_id;
  }
  if (!body.name || !targetClientId) return json({ error: 'Nom et client_id requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO pipelines (id, client_id, name, color, is_default) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, body.client_id, sanitizeInput(body.name, 200), sanitizeInput(body.color || '#0891b2', 20), body.is_default ? 1 : 0).run();

  await audit(env, auth.userId, 'pipeline.create', 'pipeline', id, { name: body.name });
  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdatePipeline(
  request: Request, env: Env, auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {
  const body = await request.json() as { name?: string; color?: string; is_default?: boolean };
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name, 200)); }
  if (body.color) { updates.push('color = ?'); params.push(sanitizeInput(body.color, 20)); }
  if (body.is_default !== undefined) { updates.push('is_default = ?'); params.push(body.is_default ? 1 : 0); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(pipelineId);

  await env.DB.prepare(`UPDATE pipelines SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await audit(env, auth.userId, 'pipeline.update', 'pipeline', pipelineId);
  return json({ data: { success: true } });
}

export async function handleDeletePipeline(
  env: Env, auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {

  const pipeline = await env.DB.prepare('SELECT is_default, client_id FROM pipelines WHERE id = ?').bind(pipelineId).first() as { is_default: number; client_id: string } | null;
  if (!pipeline) return json({ error: 'Pipeline introuvable' }, 404);
  if (pipeline.is_default) return json({ error: 'Impossible de supprimer le pipeline par défaut' }, 400);

  const defaultPipeline = await env.DB.prepare("SELECT id FROM pipelines WHERE is_default = 1 AND client_id = ?").bind(pipeline.client_id).first() as { id: string } | null;
  if (defaultPipeline) {
    await env.DB.prepare('UPDATE leads SET pipeline_id = ? WHERE pipeline_id = ?').bind(defaultPipeline.id, pipelineId).run();
  }

  await env.DB.prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?').bind(pipelineId).run();
  await env.DB.prepare('DELETE FROM pipelines WHERE id = ?').bind(pipelineId).run();
  await audit(env, auth.userId, 'pipeline.delete', 'pipeline', pipelineId);
  return json({ data: { success: true } });
}

// ── PIPELINE STAGES ─────────────────────────────────────────

export async function handleGetPipelineStages(
  env: Env, _auth: { role: string }, pipelineId: string
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order ASC'
  ).bind(pipelineId).all();
  return json({ data: results || [] });
}

export async function handleCreatePipelineStage(
  request: Request, env: Env, auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const v = validate(createPipelineStageSchema, rawBody);
  if (!v.success) return validationError(v.error);
  const body = v.data as { name?: string; color?: string; probability?: number; wip_limit?: number; sla_days?: number };
  if (!body.name) return json({ error: 'Nom requis' }, 400);

  const id = crypto.randomUUID();
  const maxPos = await env.DB.prepare('SELECT MAX(sort_order) as max_pos FROM pipeline_stages WHERE pipeline_id = ?').bind(pipelineId).first() as { max_pos: number | null } | null;
  const sort_order = (maxPos?.max_pos ?? -1) + 1;

  await env.DB.prepare(
    "INSERT INTO pipeline_stages (id, pipeline_id, name, color, sort_order, probability, wip_limit, sla_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, pipelineId, sanitizeInput(body.name, 100), sanitizeInput(body.color || '#9ca3af', 20), sort_order, body.probability || 0, body.wip_limit || 0, body.sla_days || 0).run();

  await audit(env, auth.userId, 'stage.create', 'pipeline_stage', id, { name: body.name, pipeline_id: pipelineId });
  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdatePipelineStage(
  request: Request, env: Env, auth: { role: string; userId: string }, _pipelineId: string, stageId: string
): Promise<Response> {
  const body = await request.json() as { name?: string; color?: string; sort_order?: number; probability?: number; wip_limit?: number; sla_days?: number };
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name, 100)); }
  if (body.color) { updates.push('color = ?'); params.push(sanitizeInput(body.color, 20)); }
  if (body.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(body.sort_order); }
  if (body.probability !== undefined) { updates.push('probability = ?'); params.push(body.probability); }
  if (body.wip_limit !== undefined) { updates.push('wip_limit = ?'); params.push(body.wip_limit); }
  if (body.sla_days !== undefined) { updates.push('sla_days = ?'); params.push(body.sla_days); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  params.push(stageId);

  await env.DB.prepare(`UPDATE pipeline_stages SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await audit(env, auth.userId, 'stage.update', 'pipeline_stage', stageId);
  return json({ data: { success: true } });
}

export async function handleDeletePipelineStage(
  env: Env, auth: { role: string; userId: string }, _pipelineId: string, stageId: string
): Promise<Response> {

  await env.DB.prepare('UPDATE leads SET stage_id = NULL WHERE stage_id = ?').bind(stageId).run();
  await env.DB.prepare('DELETE FROM pipeline_stages WHERE id = ?').bind(stageId).run();
  await audit(env, auth.userId, 'stage.delete', 'pipeline_stage', stageId);
  return json({ data: { success: true } });
}

export async function handleReorderPipelineStages(
  request: Request, env: Env, _auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {
  const body = await request.json() as { stages: { id: string; sort_order: number }[] };
  if (!body.stages || !Array.isArray(body.stages)) return json({ error: 'Stages array requis' }, 400);

  const stmts = body.stages.map(s => env.DB.prepare('UPDATE pipeline_stages SET sort_order = ? WHERE id = ? AND pipeline_id = ?').bind(s.sort_order, s.id, pipelineId));
  await env.DB.batch(stmts);
  return json({ data: { success: true } });
}

// ── LOST REASONS ──────────────────────────────────────────────

export async function handleGetLostReasons(
  env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  const clientIdRow = auth.role !== 'admin' ? 
    await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } : null;
  const clientId = clientIdRow?.client_id;

  const query = clientId ? 'SELECT * FROM lost_reasons WHERE client_id = ? ORDER BY sort_order ASC' : 'SELECT * FROM lost_reasons ORDER BY client_id, sort_order ASC';
  const { results } = clientId ? await env.DB.prepare(query).bind(clientId).all() : await env.DB.prepare(query).all();
  return json({ data: results || [] });
}

export async function handleCreateLostReason(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  const body = await request.json() as { label?: string; client_id?: string };
  
  let targetClientId = body.client_id;
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;
    targetClientId = user?.client_id;
  }
  if (!body.label || !targetClientId) return json({ error: 'Label et client_id requis' }, 400);

  const id = crypto.randomUUID();
  const maxPos = await env.DB.prepare('SELECT MAX(sort_order) as max_pos FROM lost_reasons WHERE client_id = ?').bind(body.client_id).first() as { max_pos: number | null } | null;
  const sort_order = (maxPos?.max_pos ?? -1) + 1;

  await env.DB.prepare(
    "INSERT INTO lost_reasons (id, client_id, label, sort_order) VALUES (?, ?, ?, ?)"
  ).bind(id, body.client_id, sanitizeInput(body.label, 100), sort_order).run();

  return json({ data: { id, success: true } }, 201);
}

// ── FORECAST ──────────────────────────────────────────────────

export async function handleGetPipelineForecast(
  env: Env, auth: { role: string; userId: string }, pipelineId: string, _url: URL
): Promise<Response> {
  // Verify pipeline access
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;
    if (!user) return json({ error: 'Unauthorized' }, 403);
    const pipeline = await env.DB.prepare('SELECT id FROM pipelines WHERE id = ? AND client_id = ?').bind(pipelineId, user.client_id).first();
    if (!pipeline) return json({ error: 'Pipeline introuvable' }, 404);
  }

  const query = `
    SELECT l.deal_value, s.probability, l.status, l.created_at, l.updated_at
    FROM leads l
    JOIN pipeline_stages s ON l.stage_id = s.id
    WHERE l.pipeline_id = ? AND l.status != 'lost'
  `;
  const { results: leads } = await env.DB.prepare(query).bind(pipelineId).all() as { results: any[] };

  let total_pipeline_value = 0;
  let weighted_total = 0;
  
  const monthMap: Record<string, { weighted_revenue: number; deal_count: number }> = {};
  
  for (const lead of (leads || [])) {
    const val = Number(lead.deal_value) || 0;
    const prob = Number(lead.probability) || 0;
    const weighted = (val * prob) / 100;
    
    total_pipeline_value += val;
    weighted_total += weighted;
    
    // Simulate expected close date if not present: 90 days from last update
    const expectedDate = new Date(lead.updated_at || lead.created_at || new Date());
    expectedDate.setDate(expectedDate.getDate() + 90);
    
    const monthKey = expectedDate.toISOString().substring(0, 7); // YYYY-MM
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = { weighted_revenue: 0, deal_count: 0 };
    }
    monthMap[monthKey].weighted_revenue += weighted;
    monthMap[monthKey].deal_count += 1;
  }

  // Filter based on period if necessary, for now we return all calculated
  const data = Object.keys(monthMap).sort().map(month => ({
    month,
    weighted_revenue: monthMap[month]!.weighted_revenue,
    deal_count: monthMap[month]!.deal_count
  }));

  return json({ data, total_pipeline_value, weighted_total });
}
