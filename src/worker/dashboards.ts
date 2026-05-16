// ══════════════════════════════════════════════════════════════
// ██  Module Dashboards — Sprint 46 M1.3
// ██  Custom dashboards builder (Reports)
// ══════════════════════════════════════════════════════════════
//
// Endpoints :
//   GET    /api/dashboards               → list user dashboards
//   POST   /api/dashboards               → create new
//   GET    /api/dashboards/:id           → detail one
//   PUT    /api/dashboards/:id           → update
//   DELETE /api/dashboards/:id           → delete
//   POST   /api/dashboards/:id/share     → generate share token
//   GET    /api/public/dashboards/:token → public read by share token
//
// Storage : table `dashboards` (D1) — voir migration-sprint46.sql
//
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

type Auth = { id?: string; userId?: string; role?: string };

function getUserId(auth: Auth): string {
  return (auth?.id || auth?.userId || '1') as string;
}

function genToken(): string {
  // 24 chars url-safe
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ── List ─────────────────────────────────────────────────────
export async function handleGetDashboards(env: Env, auth: Auth): Promise<Response> {
  const userId = getUserId(auth);
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, name, config, share_token, created_at, updated_at
     FROM dashboards
     WHERE user_id = ?
     ORDER BY updated_at DESC`
  ).bind(userId).all();

  // Parse config JSON pour le client
  const list = (results || []).map((r: any) => ({
    ...r,
    config: safeParseJson(r.config),
  }));
  return json({ data: list });
}

// ── Get one ──────────────────────────────────────────────────
export async function handleGetDashboard(env: Env, auth: Auth, id: string): Promise<Response> {
  const userId = getUserId(auth);
  const row = await env.DB.prepare(
    `SELECT id, user_id, name, config, share_token, created_at, updated_at
     FROM dashboards
     WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first() as any;
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);
  return json({ data: { ...row, config: safeParseJson(row.config) } });
}

// ── Create ───────────────────────────────────────────────────
export async function handleCreateDashboard(request: Request, env: Env, auth: Auth): Promise<Response> {
  const body = await request.json() as any;
  const name = sanitizeInput(body?.name || 'Nouveau dashboard').slice(0, 120);
  const config = body?.config ?? { widgets: [], cols: 12 };

  const userId = getUserId(auth);
  const result = await env.DB.prepare(
    `INSERT INTO dashboards (user_id, name, config) VALUES (?, ?, ?)`
  ).bind(userId, name, JSON.stringify(config)).run();

  const id = (result.meta as any)?.last_row_id;
  return json({ data: { id, user_id: userId, name, config, share_token: null } }, 201);
}

// ── Update ───────────────────────────────────────────────────
export async function handleUpdateDashboard(
  request: Request, env: Env, auth: Auth, id: string
): Promise<Response> {
  const body = await request.json() as any;
  const userId = getUserId(auth);

  const current = await env.DB.prepare(
    `SELECT id FROM dashboards WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!current) return json({ error: 'Dashboard introuvable' }, 404);

  const sets: string[] = [];
  const binds: any[] = [];
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    binds.push(sanitizeInput(body.name).slice(0, 120));
  }
  if (body.config !== undefined) {
    sets.push('config = ?');
    binds.push(JSON.stringify(body.config));
  }
  if (sets.length === 0) return json({ data: { success: true, noop: true } });
  sets.push('updated_at = (unixepoch())');
  binds.push(id, userId);

  await env.DB.prepare(
    `UPDATE dashboards SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...binds).run();
  return json({ data: { success: true } });
}

// ── Delete ───────────────────────────────────────────────────
export async function handleDeleteDashboard(env: Env, auth: Auth, id: string): Promise<Response> {
  const userId = getUserId(auth);
  await env.DB.prepare(
    `DELETE FROM dashboards WHERE id = ? AND user_id = ?`
  ).bind(id, userId).run();
  return json({ data: { success: true } });
}

// ── Share — generate/refresh share token ─────────────────────
export async function handleShareDashboard(env: Env, auth: Auth, id: string): Promise<Response> {
  const userId = getUserId(auth);
  const row = await env.DB.prepare(
    `SELECT id, share_token FROM dashboards WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first() as any;
  if (!row) return json({ error: 'Dashboard introuvable' }, 404);

  let token = row.share_token as string | null;
  if (!token) {
    token = genToken();
    await env.DB.prepare(
      `UPDATE dashboards SET share_token = ?, updated_at = (unixepoch()) WHERE id = ?`
    ).bind(token, id).run();
  }
  return json({ data: { share_token: token, url: `/dashboards/shared/${token}` } });
}

// ── Public read by token ─────────────────────────────────────
export async function handleGetSharedDashboard(env: Env, token: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, name, config, updated_at FROM dashboards WHERE share_token = ?`
  ).bind(token).first() as any;
  if (!row) return json({ error: 'Lien invalide ou expiré' }, 404);
  return json({ data: { ...row, config: safeParseJson(row.config) } });
}

// ── Helpers ──────────────────────────────────────────────────
function safeParseJson(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return null; }
}
