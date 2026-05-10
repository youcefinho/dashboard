// ── Module Tasks — Intralys CRM ─────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

export async function handleGetTasks(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const leadId = url.searchParams.get('lead_id');

  let query = `SELECT t.*, l.name as lead_name FROM tasks t
               LEFT JOIN leads l ON t.lead_id = l.id WHERE 1=1`;
  const params: string[] = [];

  if (auth.role !== 'admin') {
    query += ' AND (t.assigned_to = ? OR t.created_by = ?)';
    params.push(auth.userId, auth.userId);
  }
  if (status && ['todo', 'in_progress', 'done'].includes(status)) { query += ' AND t.status = ?'; params.push(status); }
  if (priority && ['high', 'medium', 'low'].includes(priority)) { query += ' AND t.priority = ?'; params.push(priority); }
  if (leadId) { query += ' AND t.lead_id = ?'; params.push(sanitizeInput(leadId, 100)); }

  query += " ORDER BY (CASE t.status WHEN 'done' THEN 1 ELSE 0 END), t.due_date ASC LIMIT 200";

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateTask(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  if (!title) return json({ error: 'Titre requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, title,
    sanitizeInput(body.description as string, 1000),
    sanitizeInput(body.due_date as string, 30) || null,
    sanitizeInput(body.priority as string, 10) || 'medium',
    sanitizeInput(body.status as string, 20) || 'todo',
    (body.lead_id as string) || null,
    (body.client_id as string) || null,
    sanitizeInput(body.assigned_to as string, 100) || auth.userId,
    auth.userId,
  ).run();

  return json({ data: { id } }, 201);
}

export async function handlePatchTask(request: Request, env: Env, _auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];
  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.due_date !== undefined) { updates.push('due_date = ?'); params.push(sanitizeInput(body.due_date as string, 30) || null); }
  if (body.priority) { updates.push('priority = ?'); params.push(sanitizeInput(body.priority as string, 10)); }
  if (body.status) { updates.push('status = ?'); params.push(sanitizeInput(body.status as string, 20)); }
  if (body.assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(sanitizeInput(body.assigned_to as string, 100)); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(taskId);
  await env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

export async function handleDeleteTask(env: Env, auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  // Vérifier que l'utilisateur est admin ou owner de la tâche
  if (auth.role !== 'admin') {
    const task = await env.DB.prepare('SELECT assigned_to, created_by FROM tasks WHERE id = ?').bind(taskId).first() as { assigned_to: string | null; created_by: string | null } | null;
    if (!task || (task.assigned_to !== auth.userId && task.created_by !== auth.userId)) {
      return json({ error: 'Non autorisé' }, 403);
    }
  }
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
  await audit(env, auth.userId, 'task.delete', 'task', taskId);
  return json({ data: { success: true } });
}
