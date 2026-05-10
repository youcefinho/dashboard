// ── Module Pipelines — Intralys CRM ─────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

export async function handleGetPipelines(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results: pipelines } = await env.DB.prepare(
    'SELECT * FROM pipelines ORDER BY position ASC'
  ).all();

  // Charger les stages pour chaque pipeline
  const pipelinesWithStages = [];
  for (const p of (pipelines || []) as Array<Record<string, unknown>>) {
    const { results: stages } = await env.DB.prepare(
      'SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position ASC'
    ).bind(p.id as string).all();

    // Compter les leads par stage
    const stagesWithCount = [];
    for (const s of (stages || []) as Array<Record<string, unknown>>) {
      const count = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM leads WHERE stage_id = ?'
      ).bind(s.id as string).first() as { count: number } | null;
      stagesWithCount.push({ ...s, lead_count: count?.count || 0 });
    }

    pipelinesWithStages.push({ ...p, stages: stagesWithCount });
  }

  return json({ data: pipelinesWithStages });
}

export async function handleCreatePipeline(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { name?: string; description?: string };
  if (!body.name) return json({ error: 'Nom requis' }, 400);

  const id = crypto.randomUUID();
  const maxPos = await env.DB.prepare('SELECT MAX(position) as max_pos FROM pipelines').first() as { max_pos: number | null } | null;
  const position = (maxPos?.max_pos ?? -1) + 1;

  await env.DB.prepare(
    "INSERT INTO pipelines (id, name, description, position) VALUES (?, ?, ?, ?)"
  ).bind(id, sanitizeInput(body.name, 200), sanitizeInput(body.description || '', 500), position).run();

  await audit(env, auth.userId, 'pipeline.create', 'pipeline', id, { name: body.name });
  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdatePipeline(
  request: Request, env: Env, auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { name?: string; description?: string; position?: number };
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description, 500)); }
  if (body.position !== undefined) { updates.push('position = ?'); params.push(body.position); }

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
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  // Empêcher la suppression du pipeline par défaut
  const pipeline = await env.DB.prepare('SELECT is_default FROM pipelines WHERE id = ?').bind(pipelineId).first() as { is_default: number } | null;
  if (!pipeline) return json({ error: 'Pipeline introuvable' }, 404);
  if (pipeline.is_default) return json({ error: 'Impossible de supprimer le pipeline par défaut' }, 400);

  // Migrer les leads orphelins vers le pipeline par défaut
  const defaultPipeline = await env.DB.prepare("SELECT id FROM pipelines WHERE is_default = 1").first() as { id: string } | null;
  if (defaultPipeline) {
    await env.DB.prepare('UPDATE leads SET pipeline_id = ? WHERE pipeline_id = ?').bind(defaultPipeline.id, pipelineId).run();
  }

  await env.DB.prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?').bind(pipelineId).run();
  await env.DB.prepare('DELETE FROM pipelines WHERE id = ?').bind(pipelineId).run();
  await audit(env, auth.userId, 'pipeline.delete', 'pipeline', pipelineId);
  return json({ data: { success: true } });
}

// ── Pipeline Stages ─────────────────────────────────────────

export async function handleGetPipelineStages(
  env: Env, auth: { role: string }, pipelineId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare(
    'SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position ASC'
  ).bind(pipelineId).all();
  return json({ data: results || [] });
}

export async function handleCreatePipelineStage(
  request: Request, env: Env, auth: { role: string; userId: string }, pipelineId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { name?: string; slug?: string; color?: string; is_win_stage?: boolean; is_loss_stage?: boolean };
  if (!body.name || !body.slug) return json({ error: 'Nom et slug requis' }, 400);

  const id = crypto.randomUUID();
  const maxPos = await env.DB.prepare('SELECT MAX(position) as max_pos FROM pipeline_stages WHERE pipeline_id = ?').bind(pipelineId).first() as { max_pos: number | null } | null;
  const position = (maxPos?.max_pos ?? -1) + 1;

  await env.DB.prepare(
    "INSERT INTO pipeline_stages (id, pipeline_id, name, slug, color, position, is_win_stage, is_loss_stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, pipelineId, sanitizeInput(body.name, 100), sanitizeInput(body.slug, 50), body.color || '#6366f1', position, body.is_win_stage ? 1 : 0, body.is_loss_stage ? 1 : 0).run();

  await audit(env, auth.userId, 'stage.create', 'pipeline_stage', id, { name: body.name, pipeline_id: pipelineId });
  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdatePipelineStage(
  request: Request, env: Env, auth: { role: string; userId: string }, _pipelineId: string, stageId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { name?: string; slug?: string; color?: string; position?: number; is_win_stage?: boolean; is_loss_stage?: boolean };
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name, 100)); }
  if (body.slug) { updates.push('slug = ?'); params.push(sanitizeInput(body.slug, 50)); }
  if (body.color) { updates.push('color = ?'); params.push(sanitizeInput(body.color, 20)); }
  if (body.position !== undefined) { updates.push('position = ?'); params.push(body.position); }
  if (body.is_win_stage !== undefined) { updates.push('is_win_stage = ?'); params.push(body.is_win_stage ? 1 : 0); }
  if (body.is_loss_stage !== undefined) { updates.push('is_loss_stage = ?'); params.push(body.is_loss_stage ? 1 : 0); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  params.push(stageId);

  await env.DB.prepare(`UPDATE pipeline_stages SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await audit(env, auth.userId, 'stage.update', 'pipeline_stage', stageId);
  return json({ data: { success: true } });
}

export async function handleDeletePipelineStage(
  env: Env, auth: { role: string; userId: string }, _pipelineId: string, stageId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  // Remettre les leads de ce stage à NULL
  await env.DB.prepare('UPDATE leads SET stage_id = NULL WHERE stage_id = ?').bind(stageId).run();
  await env.DB.prepare('DELETE FROM pipeline_stages WHERE id = ?').bind(stageId).run();
  await audit(env, auth.userId, 'stage.delete', 'pipeline_stage', stageId);
  return json({ data: { success: true } });
}
