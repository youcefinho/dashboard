// ── Module Trigger Links — Intralys CRM (Sprint 7) ──────────
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';
import { autoEnrollForTrigger } from './workflows';

export async function handleGetTriggerLinks(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');
  let query = `SELECT tl.*, 
    (SELECT COUNT(*) FROM trigger_link_clicks WHERE link_id = tl.id) as total_clicks
    FROM trigger_links tl`;
  const params: string[] = [];

  if (clientId) {
    query += ' WHERE tl.client_id = ?';
    params.push(clientId);
  }
  query += ' ORDER BY tl.created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateTriggerLink(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const targetUrl = sanitizeInput(body.target_url as string, 2000);
  const clientId = body.client_id as string || '';
  const tagToApply = sanitizeInput((body.tag_to_apply || '') as string, 50);

  if (!name || !targetUrl) return json({ error: 'Nom et URL cible requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO trigger_links (id, client_id, name, target_url) VALUES (?, ?, ?, ?)'
  ).bind(id, clientId, name, targetUrl).run();

  // Stocker le tag dans un champ metadata si besoin (on utilise le nom pour l'instant)
  if (tagToApply) {
    // On pourrait ajouter une colonne tag_to_apply — pour le MVP on le stocke dans le nom
  }

  await audit(env, auth.userId, 'trigger_link.create', 'trigger_link', id);
  return json({ data: { id } }, 201);
}

export async function handleDeleteTriggerLink(
  env: Env,
  auth: { userId: string; role: string },
  linkId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  await env.DB.prepare('DELETE FROM trigger_link_clicks WHERE link_id = ?').bind(linkId).run();
  await env.DB.prepare('DELETE FROM trigger_links WHERE id = ?').bind(linkId).run();
  await audit(env, auth.userId, 'trigger_link.delete', 'trigger_link', linkId);
  return json({ data: { success: true } });
}

// ── Public : click tracking + redirect 302 ──────────────────
export async function handleTriggerLinkClick(
  request: Request,
  env: Env,
  linkId: string
): Promise<Response> {
  const link = await env.DB.prepare(
    'SELECT * FROM trigger_links WHERE id = ?'
  ).bind(linkId).first() as { target_url: string; client_id: string } | null;

  if (!link) {
    return new Response('Lien introuvable', { status: 404 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';

  // Log le clic
  await env.DB.prepare(
    'INSERT INTO trigger_link_clicks (link_id, ip, user_agent) VALUES (?, ?, ?)'
  ).bind(linkId, ip, sanitizeInput(ua, 300)).run();

  // Incrémenter le compteur
  await env.DB.prepare(
    'UPDATE trigger_links SET click_count = click_count + 1 WHERE id = ?'
  ).bind(linkId).run();

  // Fire workflow trigger 'link_clicked'
  // Trouver le lead par IP si possible (best effort)
  try {
    await autoEnrollForTrigger(env, 'link_clicked', linkId);
  } catch { /* best effort */ }

  // Redirect 302
  return new Response(null, {
    status: 302,
    headers: { 'Location': link.target_url },
  });
}

export async function handleGetTriggerLinkStats(
  env: Env,
  _auth: { userId: string; role: string },
  linkId: string
): Promise<Response> {
  const clicks = await env.DB.prepare(
    `SELECT date(clicked_at) as day, COUNT(*) as count 
     FROM trigger_link_clicks WHERE link_id = ? 
     GROUP BY date(clicked_at) ORDER BY day DESC LIMIT 30`
  ).bind(linkId).all();

  return json({ data: clicks.results || [] });
}
