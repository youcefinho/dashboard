// ── Module Quick Replies — Sprint 43 M3.2 ──────────────────────
// Persistence D1 des quick replies per-lead (FIFO 3).
// Remplace le stub localStorage `src/lib/quickReplies.ts`.
//
// Endpoints :
//   GET  /api/leads/:id/quick-replies     → 3 plus récents (par user)
//   POST /api/leads/:id/quick-replies     body { content } → ajoute + auto-purge >3
//
// Comportement aligné src/lib/quickReplies.ts :
//   - skip si content vide
//   - skip si content > 280 chars
//   - dedup case-sensitive (bring to top)
//   - FIFO 3 (le plus récent en index 0)
//
// Cardinality : per-lead × per-user (cohérent avec "préférence personnelle utilisateur").
// Auto-purge >3 fait côté worker : DELETE des entrées au-delà du top-3 par (lead_id, user_id).

import type { Env } from './types';
import { json } from './helpers';

const MAX_PER_LEAD = 3;
const MAX_TEXT_LENGTH = 280;

interface QuickReplyRow {
  content: string;
  created_at: number;
}

export async function handleGetQuickReplies(
  env: Env,
  auth: { userId: string; role: string },
  leadId: string,
): Promise<Response> {
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT content, created_at FROM quick_replies
     WHERE lead_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(leadId, auth.userId, MAX_PER_LEAD).all<QuickReplyRow>();

  return json({ data: (results || []).map(r => r.content) });
}

export async function handleAddQuickReply(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  leadId: string,
): Promise<Response> {
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  let body: { content?: string };
  try {
    body = await request.json() as { content?: string };
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const trimmed = (body.content ?? '').trim();
  if (!trimmed) return json({ error: 'Contenu requis' }, 400);
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return json({ error: `Contenu trop long (max ${MAX_TEXT_LENGTH} chars)` }, 400);
  }

  // Vérifier que le lead existe
  const lead = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  // Dedup : retirer l'existant identique pour bring-to-top
  await env.DB.prepare(
    `DELETE FROM quick_replies WHERE lead_id = ? AND user_id = ? AND content = ?`
  ).bind(leadId, auth.userId, trimmed).run();

  // Insert le nouveau
  await env.DB.prepare(
    `INSERT INTO quick_replies (lead_id, user_id, content) VALUES (?, ?, ?)`
  ).bind(leadId, auth.userId, trimmed).run();

  // Auto-purge : garder seulement les MAX_PER_LEAD plus récents
  await env.DB.prepare(
    `DELETE FROM quick_replies
     WHERE lead_id = ? AND user_id = ?
       AND id NOT IN (
         SELECT id FROM quick_replies
         WHERE lead_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )`
  ).bind(leadId, auth.userId, leadId, auth.userId, MAX_PER_LEAD).run();

  // Retourner l'état à jour (parité avec pattern reactions)
  const { results } = await env.DB.prepare(
    `SELECT content, created_at FROM quick_replies
     WHERE lead_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(leadId, auth.userId, MAX_PER_LEAD).all<QuickReplyRow>();

  return json({ data: (results || []).map(r => r.content) });
}
