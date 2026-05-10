// ── Module Notifications — Intralys CRM ─────────────────────
import type { Env } from './types';
import { json } from './helpers';

export async function handleGetNotifications(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);

  let query = 'SELECT * FROM notifications WHERE user_id = ?';
  const params: (string | number)[] = [auth.userId];

  if (unreadOnly) {
    query += ' AND is_read = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all();

  // Compter les non-lues
  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(auth.userId).all();
  const unreadCount = (countResult.results?.[0] as { count: number } | undefined)?.count || 0;

  return json({ data: results || [], unread_count: unreadCount });
}

export async function handleReadNotification(env: Env, auth: { userId: string; role: string }, notifId: string): Promise<Response> {
  await env.DB.prepare(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?"
  ).bind(notifId, auth.userId).run();
  return json({ data: { success: true } });
}

export async function handleReadAllNotifications(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  await env.DB.prepare(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0"
  ).bind(auth.userId).run();
  return json({ data: { success: true } });
}
