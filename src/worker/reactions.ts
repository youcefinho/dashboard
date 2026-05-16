// ── Module Reactions — Sprint 43 M3.1 ─────────────────────────
// Persistence D1 des reactions emoji par message.
// Remplace le stub localStorage `src/lib/reactions.ts`.
//
// Endpoints :
//   GET    /api/messages/:id/reactions
//   POST   /api/messages/:id/reactions        body { emoji }
//   DELETE /api/messages/:id/reactions/:emoji
//
// Table D1 : message_reactions (cf migration-sprint43.sql)
//
// Format réponse aligné sur `Reaction[]` dans src/lib/reactions.ts :
//   { emoji, count, userIds, reacted }
// trié par count desc puis emoji alpha (parité avec aggregate() client).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

interface ReactionRow {
  emoji: string;
  user_id: string;
}

interface ReactionDTO {
  emoji: string;
  count: number;
  userIds: string[];
  reacted: boolean;
}

/**
 * Aggregate les rows DB en DTO frontend.
 * Tri stable : count desc puis emoji alpha.
 */
function aggregate(rows: ReactionRow[], currentUserId: string): ReactionDTO[] {
  const byEmoji = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.emoji) continue;
    const list = byEmoji.get(r.emoji) ?? [];
    list.push(r.user_id);
    byEmoji.set(r.emoji, list);
  }
  const out: ReactionDTO[] = [];
  for (const [emoji, userIds] of byEmoji.entries()) {
    if (userIds.length === 0) continue;
    out.push({
      emoji,
      count: userIds.length,
      userIds: [...userIds],
      reacted: userIds.includes(currentUserId),
    });
  }
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });
  return out;
}

// Validation emoji : 1-32 chars, pas d'espace ni de retour ligne.
// SQLite TEXT accepte unicode → on garde permissif (1 char ≠ 1 codepoint pour les emojis composites).
function isValidEmoji(s: string): boolean {
  if (!s) return false;
  if (s.length > 32) return false;
  if (/[\s\n\r\t]/.test(s)) return false;
  return true;
}

export async function handleGetReactions(
  env: Env,
  auth: { userId: string; role: string },
  messageId: string,
): Promise<Response> {
  if (!messageId) return json({ error: 'message_id requis' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`
  ).bind(messageId).all<ReactionRow>();

  return json({ data: aggregate(results || [], auth.userId) });
}

export async function handleAddReaction(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  messageId: string,
): Promise<Response> {
  if (!messageId) return json({ error: 'message_id requis' }, 400);

  let body: { emoji?: string };
  try {
    body = await request.json() as { emoji?: string };
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }

  const emoji = sanitizeInput(body.emoji, 32);
  if (!isValidEmoji(emoji)) {
    return json({ error: 'Emoji invalide (max 32 chars, pas d\'espace)' }, 400);
  }

  // Vérifier que le message existe (best-effort — on retourne 404 si pas trouvé)
  const msg = await env.DB.prepare('SELECT id FROM messages WHERE id = ?').bind(messageId).first();
  if (!msg) return json({ error: 'Message introuvable' }, 404);

  // INSERT OR IGNORE → idempotent grâce au UNIQUE(message_id, user_id, emoji)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`
  ).bind(messageId, auth.userId, emoji).run();

  audit(env, auth.userId, 'add_reaction', 'message', messageId, { emoji }).catch(() => {});

  // Retourner l'état agrégé à jour (parité avec toggleReaction client)
  const { results } = await env.DB.prepare(
    `SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`
  ).bind(messageId).all<ReactionRow>();

  return json({ data: aggregate(results || [], auth.userId) });
}

export async function handleRemoveReaction(
  env: Env,
  auth: { userId: string; role: string },
  messageId: string,
  emoji: string,
): Promise<Response> {
  if (!messageId) return json({ error: 'message_id requis' }, 400);

  const cleanEmoji = sanitizeInput(decodeURIComponent(emoji || ''), 32);
  if (!isValidEmoji(cleanEmoji)) {
    return json({ error: 'Emoji invalide' }, 400);
  }

  await env.DB.prepare(
    `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`
  ).bind(messageId, auth.userId, cleanEmoji).run();

  audit(env, auth.userId, 'remove_reaction', 'message', messageId, { emoji: cleanEmoji }).catch(() => {});

  const { results } = await env.DB.prepare(
    `SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`
  ).bind(messageId).all<ReactionRow>();

  return json({ data: aggregate(results || [], auth.userId) });
}
