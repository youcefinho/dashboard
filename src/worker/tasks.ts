// ── Module Tasks — Intralys CRM ─────────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { autoEnrollForTrigger } from './workflows';

export async function handleGetTasks(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const leadId = url.searchParams.get('lead_id');
  const parentTaskId = url.searchParams.get('parent_task_id');

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
  if (parentTaskId) { query += ' AND t.parent_task_id = ?'; params.push(sanitizeInput(parentTaskId, 100)); }

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
    `INSERT INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by, recurring_rule, parent_task_id, reminder_minutes_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    sanitizeInput(body.recurring_rule as string, 100) || null,
    sanitizeInput(body.parent_task_id as string, 100) || null,
    body.reminder_minutes_before ? Number(body.reminder_minutes_before) : null
  ).run();

  // Webhook event
  if (body.client_id) {
    try {
      const { publishEvent } = await import('./webhooks-dispatch');
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
      if (task) {
        publishEvent(env, body.client_id as string, 'task.created', task);
      }
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }

  return json({ data: { id } }, 201);
}

export async function handlePatchTask(request: Request, env: Env, _auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  const oldTask = await env.DB.prepare('SELECT status, lead_id FROM tasks WHERE id = ?').bind(taskId).first() as { status: string; lead_id: string | null } | null;
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.due_date !== undefined) { updates.push('due_date = ?'); params.push(sanitizeInput(body.due_date as string, 30) || null); }
  if (body.priority) { updates.push('priority = ?'); params.push(sanitizeInput(body.priority as string, 10)); }
  if (body.status) { updates.push('status = ?'); params.push(sanitizeInput(body.status as string, 20)); }
  if (body.assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(sanitizeInput(body.assigned_to as string, 100)); }
  if (body.recurring_rule !== undefined) { updates.push('recurring_rule = ?'); params.push(sanitizeInput(body.recurring_rule as string, 100) || null); }
  if (body.reminder_minutes_before !== undefined) { updates.push('reminder_minutes_before = ?'); params.push(body.reminder_minutes_before ? Number(body.reminder_minutes_before) : null); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(taskId);
  await env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  if (oldTask && oldTask.status !== 'done' && body.status === 'done' && oldTask.lead_id) {
     await autoEnrollForTrigger(env, 'task_completed', oldTask.lead_id);
     
     // Webhook event
     try {
       const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
       if (task && task.client_id) {
         const { publishEvent } = await import('./webhooks-dispatch');
         publishEvent(env, task.client_id as string, 'task.completed', task);
       }
     } catch (e) {
       console.error('Webhook error:', e);
     }
  }

  return json({ data: { success: true } });
}

export async function handleDeleteTask(env: Env, auth: { userId: string; role: string }, taskId: string): Promise<Response> {
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

export async function processOverdueTasks(env: Env): Promise<void> {
  const { results: overdueTasks } = await env.DB.prepare(
    `SELECT t.id, t.lead_id FROM tasks t
     WHERE t.status != 'done' 
       AND t.due_date < datetime('now') 
       AND t.due_date > datetime('now', '-1 day')
       AND t.lead_id IS NOT NULL`
  ).all();

  if (overdueTasks && overdueTasks.length > 0) {
    for (const task of (overdueTasks as Array<{ id: string; lead_id: string }>)) {
      try { await autoEnrollForTrigger(env, 'task_overdue', task.lead_id); } catch { /* */ }
    }
  }
  const todayStr = new Date().toISOString().substring(5, 10);
  const { results: birthdayLeads } = await env.DB.prepare(`SELECT id FROM leads WHERE date_of_birth LIKE ?`).bind(`%${todayStr}`).all();
  if (birthdayLeads && birthdayLeads.length > 0) {
     for (const l of birthdayLeads as { id: string }[]) { try { await autoEnrollForTrigger(env, 'birthday_today', l.id); } catch { /* */ } }
  }
  const { results: inactiveLeads } = await env.DB.prepare(`SELECT id FROM leads WHERE last_activity_at < datetime('now', '-30 days') AND status NOT IN ('won', 'lost', 'closed')`).all();
  if (inactiveLeads && inactiveLeads.length > 0) {
     for (const l of inactiveLeads as { id: string }[]) { try { await autoEnrollForTrigger(env, 'inactivity_threshold', l.id); } catch { /* */ } }
  }
}

// ── Subtasks ──────────────────────────────────────────────────

export async function handleGetSubtasks(env: Env, taskId: string): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC').bind(taskId).all();
  return json({ data: results || [] });
}

export async function handleCreateSubtask(request: Request, env: Env, taskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  if (!title) return json({ error: 'Title required' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO subtasks (id, task_id, title) VALUES (?, ?, ?)')
    .bind(id, taskId, title).run();
  return json({ data: { id } }, 201);
}

export async function handleUpdateSubtask(request: Request, env: Env, subtaskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.is_done !== undefined) { updates.push('is_done = ?'); params.push(body.is_done ? 1 : 0); }
  if (body.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(Number(body.sort_order)); }
  if (updates.length === 0) return json({ error: 'No updates' }, 400);
  params.push(subtaskId);
  await env.DB.prepare(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

export async function handleDeleteSubtask(env: Env, subtaskId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM subtasks WHERE id = ?').bind(subtaskId).run();
  return json({ data: { success: true } });
}

// ── Comments ──────────────────────────────────────────────────

export async function handleGetTaskComments(env: Env, taskId: string): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC').bind(taskId).all();
  return json({ data: results || [] });
}

export async function handleCreateTaskComment(request: Request, env: Env, auth: { userId: string }, taskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const text = sanitizeInput(body.body as string, 2000);
  if (!text) return json({ error: 'Body required' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO task_comments (id, task_id, user_id, body) VALUES (?, ?, ?, ?)')
    .bind(id, taskId, auth.userId, text).run();
  return json({ data: { id } }, 201);
}

export async function handleDeleteTaskComment(env: Env, auth: { userId: string, role: string }, commentId: string): Promise<Response> {
  const comment = await env.DB.prepare('SELECT user_id FROM task_comments WHERE id = ?').bind(commentId).first() as { user_id: string } | null;
  if (!comment) return json({ error: 'Not found' }, 404);
  if (comment.user_id !== auth.userId && auth.role !== 'admin') return json({ error: 'Unauthorized' }, 403);
  await env.DB.prepare('DELETE FROM task_comments WHERE id = ?').bind(commentId).run();
  return json({ data: { success: true } });
}

// ── Templates ─────────────────────────────────────────────────

export async function handleGetTaskTemplates(env: Env, auth: { userId: string }): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM task_templates WHERE user_id = ? OR client_id IS NULL ORDER BY name ASC').bind(auth.userId).all();
  return json({ data: results || [] });
}

export async function handleCreateTaskTemplate(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 200);
  if (!name) return json({ error: 'Name required' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO task_templates (id, client_id, user_id, name, description, default_priority, default_due_offset_days, subtasks_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, null, auth.userId, name,
    sanitizeInput(body.description as string, 1000),
    sanitizeInput(body.default_priority as string, 20) || 'medium',
    Number(body.default_due_offset_days) || 0,
    JSON.stringify(body.subtasks || [])
  ).run();
  return json({ data: { id } }, 201);
}

export async function handleDeleteTaskTemplate(env: Env, auth: { userId: string, role: string }, templateId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM task_templates WHERE id = ? AND (user_id = ? OR ? = \'admin\')').bind(templateId, auth.userId, auth.role).run();
  return json({ data: { success: true } });
}

export async function handleApplyTaskTemplate(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  const body = await request.json() as { template_id: string, lead_id?: string, assigned_to?: string };
  const tpl = await env.DB.prepare('SELECT * FROM task_templates WHERE id = ?').bind(body.template_id).first() as any;
  if (!tpl) return json({ error: 'Template not found' }, 404);

  const taskId = crypto.randomUUID();
  let dueDate = null;
  if (tpl.default_due_offset_days) {
    const d = new Date();
    d.setDate(d.getDate() + tpl.default_due_offset_days);
    dueDate = d.toISOString().slice(0, 10);
  }

  await env.DB.prepare(`
    INSERT INTO tasks (id, title, description, priority, due_date, lead_id, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(taskId, tpl.name, tpl.description, tpl.default_priority, dueDate, body.lead_id || null, body.assigned_to || auth.userId, auth.userId).run();

  const subtasks = JSON.parse(tpl.subtasks_json || '[]');
  for (const st of subtasks) {
    await env.DB.prepare('INSERT INTO subtasks (id, task_id, title) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), taskId, st.title || st).run();
  }

  return json({ data: { id: taskId } }, 201);
}
