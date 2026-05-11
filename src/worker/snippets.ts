import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

export async function handleGetSnippets(
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const query = 'SELECT * FROM snippets WHERE user_id = ? ORDER BY name ASC';
  const { results } = await env.DB.prepare(query).bind(auth.userId).all();
  return json({ data: results || [] });
}

export async function handleCreateSnippet(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const shortcut = sanitizeInput(body.shortcut as string, 50);
  const textBody = sanitizeInput(body.body as string, 5000);

  if (!name || !textBody) return json({ error: 'Nom et contenu requis' }, 400);

  // Get user's client_id
  const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO snippets (id, client_id, user_id, name, shortcut, body) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, user?.client_id || '', auth.userId, name, shortcut || '', textBody).run();

  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdateSnippet(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  snippetId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const shortcut = sanitizeInput(body.shortcut as string, 50);
  const textBody = sanitizeInput(body.body as string, 5000);

  if (!name || !textBody) return json({ error: 'Nom et contenu requis' }, 400);

  const res = await env.DB.prepare(
    `UPDATE snippets SET name = ?, shortcut = ?, body = ? WHERE id = ? AND user_id = ?`
  ).bind(name, shortcut || '', textBody, snippetId, auth.userId).run();

  if (res.meta.changes === 0) return json({ error: 'Snippet introuvable ou non autorisé' }, 404);

  return json({ data: { success: true } });
}

export async function handleDeleteSnippet(
  env: Env,
  auth: { userId: string; role: string },
  snippetId: string
): Promise<Response> {
  const res = await env.DB.prepare(
    'DELETE FROM snippets WHERE id = ? AND user_id = ?'
  ).bind(snippetId, auth.userId).run();

  if (res.meta.changes === 0) return json({ error: 'Snippet introuvable ou non autorisé' }, 404);

  return json({ data: { success: true } });
}
