// ── Module Lead Notes — Intralys CRM ────────────────────────
// Notes multiples par lead — Sprint 2
import type { Env } from './types';
import { sanitizeInput, json } from './helpers';
import { autoEnrollForTrigger } from './workflows';

// ── Handlers ────────────────────────────────────────────────

// Lister les notes d'un lead
export async function handleGetLeadNotes(
  env: Env, _auth: { role: string }, leadId: string
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT n.*, u.name as author_name
     FROM lead_notes n
     LEFT JOIN users u ON u.id = n.user_id
     WHERE n.lead_id = ?
     ORDER BY n.is_pinned DESC, n.created_at DESC`
  ).bind(leadId).all();

  return json({ data: results || [] });
}

// Créer une note
export async function handleCreateLeadNote(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  const body = await request.json() as {
    body?: string;
    category?: string;
    is_pinned?: boolean;
  };

  if (!body.body?.trim()) return json({ error: 'Le contenu de la note est requis' }, 400);

  const allowedCategories = ['general', 'call', 'meeting', 'follow-up', 'important'];
  const category = allowedCategories.includes(body.category || '') ? body.category : 'general';

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO lead_notes (id, lead_id, user_id, body, category, is_pinned)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id, leadId, auth.userId,
    sanitizeInput(body.body.trim(), 10000),
    category,
    body.is_pinned ? 1 : 0
  ).run();

  // Mettre à jour last_activity_at
  await env.DB.prepare(
    "UPDATE leads SET last_activity_at = datetime('now') WHERE id = ?"
  ).bind(leadId).run();

  await autoEnrollForTrigger(env, 'note_added', leadId);

  return json({ data: { id } }, 201);
}

// Modifier une note
export async function handleUpdateLeadNote(
  request: Request, env: Env, _auth: { role: string; userId: string },
  _leadId: string, noteId: string
): Promise<Response> {
  const body = await request.json() as {
    body?: string;
    category?: string;
    is_pinned?: boolean;
  };

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.body !== undefined) {
    updates.push('body = ?');
    params.push(sanitizeInput(body.body.trim(), 10000));
  }
  if (body.category !== undefined) {
    const allowedCategories = ['general', 'call', 'meeting', 'follow-up', 'important'];
    if (allowedCategories.includes(body.category)) {
      updates.push('category = ?');
      params.push(body.category);
    }
  }
  if (body.is_pinned !== undefined) {
    updates.push('is_pinned = ?');
    params.push(body.is_pinned ? 1 : 0);
  }

  if (updates.length === 0) return json({ error: 'Rien à modifier' }, 400);

  params.push(noteId);
  await env.DB.prepare(
    `UPDATE lead_notes SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ success: true });
}

// Supprimer une note
export async function handleDeleteLeadNote(
  env: Env, auth: { role: string; userId: string },
  _leadId: string, noteId: string
): Promise<Response> {
  // Vérifier que la note appartient au user (ou admin)
  if (auth.role !== 'admin') {
    const note = await env.DB.prepare(
      'SELECT user_id FROM lead_notes WHERE id = ?'
    ).bind(noteId).first() as { user_id: string } | null;
    if (note && note.user_id !== auth.userId) {
      return json({ error: 'Vous ne pouvez supprimer que vos propres notes' }, 403);
    }
  }

  await env.DB.prepare('DELETE FROM lead_notes WHERE id = ?').bind(noteId).run();
  return json({ success: true });
}
