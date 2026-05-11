// ── Module Forms — Intralys CRM ─────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { autoEnrollForTrigger } from './workflows';

export async function handlePublicFormGet(env: Env, url: URL): Promise<Response> {
  const slug = url.pathname.replace('/api/form/', '');
  if (!slug) return json({ error: 'Slug requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);
  return json({ data: form });
}

export async function handlePublicFormSubmit(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { form_id?: string; data?: Record<string, unknown> };
  if (!body.form_id || !body.data) return json({ error: 'form_id et data requis' }, 400);
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ? AND is_active = 1')
    .bind(body.form_id).first() as Record<string, unknown> | null;
  if (!form) return json({ error: 'Formulaire non trouvé' }, 404);

  const subId = crypto.randomUUID();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  await env.DB.prepare(
    'INSERT INTO form_submissions (id, form_id, client_id, data, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(subId, body.form_id, form.client_id as string, JSON.stringify(body.data), ip, sanitizeInput(ua, 300)).run();

  if (form.submit_action === 'create_lead') {
    const d = body.data as Record<string, string>;
    const leadId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO leads (id, client_id, name, email, phone, source, message, status, pipeline_id, stage_id)
       VALUES (?, ?, ?, ?, ?, 'form', ?, 'new', 'pipeline-default', 'stage-new')`
    ).bind(leadId, form.client_id as string, sanitizeInput(d.name || d.nom || '', 100),
      sanitizeInput(d.email || '', 200).toLowerCase(), sanitizeInput(d.phone || d.telephone || '', 30),
      sanitizeInput(d.message || d.note || '', 2000)).run();
    await env.DB.prepare('UPDATE form_submissions SET lead_id = ? WHERE id = ?').bind(leadId, subId).run();
    await autoEnrollForTrigger(env, 'form_submitted', leadId);
  }

  return json({ data: { id: subId, success_message: form.success_message, redirect_url: form.redirect_url } }, 201);
}

export async function handleGetForms(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare('SELECT f.*, (SELECT COUNT(*) FROM form_submissions WHERE form_id = f.id) as submission_count FROM forms f ORDER BY f.created_at DESC').all();
  return json({ data: results || [] });
}

export async function handleCreateForm(request: Request, env: Env, auth: { role: string; userId: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  if (!body.client_id || !body.name || !body.slug) return json({ error: 'client_id, name et slug requis' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO forms (id, client_id, name, slug, description, fields, submit_action, success_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.client_id as string, sanitizeInput(body.name as string, 200), sanitizeInput(body.slug as string, 50),
    sanitizeInput((body.description || '') as string, 500), JSON.stringify(body.fields || []),
    (body.submit_action || 'create_lead') as string, sanitizeInput((body.success_message || 'Merci !') as string, 500)).run();
  await audit(env, auth.userId, 'form.create', 'form', id);
  return json({ data: { id } }, 201);
}

export async function handleUpdateForm(request: Request, env: Env, auth: { role: string; userId: string }, formId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const u: string[] = []; const p: (string | number)[] = [];
  if (body.name) { u.push('name = ?'); p.push(sanitizeInput(body.name as string, 200)); }
  if (body.fields) { u.push('fields = ?'); p.push(JSON.stringify(body.fields)); }
  if (body.is_active !== undefined) { u.push('is_active = ?'); p.push(body.is_active as number); }
  if (body.success_message) { u.push('success_message = ?'); p.push(sanitizeInput(body.success_message as string, 500)); }
  if (body.submit_action) { u.push('submit_action = ?'); p.push(body.submit_action as string); }
  if (u.length === 0) return json({ error: 'Aucune modification' }, 400);
  u.push("updated_at = datetime('now')"); p.push(formId);
  await env.DB.prepare(`UPDATE forms SET ${u.join(', ')} WHERE id = ?`).bind(...p).run();
  await audit(env, auth.userId, 'form.update', 'form', formId);
  return json({ data: { success: true } });
}

export async function handleDeleteForm(env: Env, auth: { role: string; userId: string }, formId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  await env.DB.prepare('DELETE FROM form_submissions WHERE form_id = ?').bind(formId).run();
  await env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId).run();
  await audit(env, auth.userId, 'form.delete', 'form', formId);
  return json({ data: { success: true } });
}

export async function handleGetFormSubmissions(env: Env, auth: { role: string }, formId: string, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const { results } = await env.DB.prepare(
    'SELECT * FROM form_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(formId, limit).all();
  return json({ data: results || [] });
}
