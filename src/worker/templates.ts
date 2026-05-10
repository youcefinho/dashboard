// ── Module Templates — Intralys CRM ─────────────────────────
import type { Env } from './types';
import { sanitizeInput, json } from './helpers';

export async function handleGetTemplates(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const category = url.searchParams.get('category');

  let query = 'SELECT * FROM email_templates WHERE is_active = 1';
  const params: string[] = [];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

export async function handleCreateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const subject = sanitizeInput(body.subject as string, 200);
  const bodyHtml = sanitizeInput(body.body_html as string, 10000);
  const category = sanitizeInput(body.category as string, 20) || 'general';

  if (!name || !subject || !bodyHtml) {
    return json({ error: 'Nom, sujet et contenu requis' }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO email_templates (id, name, subject, body_html, category)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, subject, bodyHtml, category).run();

  return json({ data: { id } }, 201);
}

export async function handleUpdateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: string[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.subject) { updates.push('subject = ?'); params.push(sanitizeInput(body.subject as string, 200)); }
  if (body.body_html) { updates.push('body_html = ?'); params.push(sanitizeInput(body.body_html as string, 10000)); }
  if (body.category) { updates.push('category = ?'); params.push(sanitizeInput(body.category as string, 20)); }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(templateId);

  await env.DB.prepare(
    `UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ data: { success: true } });
}

export async function handleDeleteTemplate(
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  await env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(templateId).run();

  return json({ data: { success: true } });
}
