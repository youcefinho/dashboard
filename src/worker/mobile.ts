import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

// ── Soft Delete & Trash ─────────────────────────────────────

export async function handleSoftDeleteLead(
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  leadId: string
): Promise<Response> {
  // Vérifier que le lead existe et appartient au client
  const lead = await env.DB.prepare(
    'SELECT id, client_id FROM leads WHERE id = ? AND deleted_at IS NULL'
  ).bind(leadId).first() as { id: string; client_id: string } | null;

  if (!lead) return json({ error: 'Lead introuvable' }, 404);
  if (auth.role !== 'admin' && lead.client_id !== auth.clientId) {
    return json({ error: 'Non autorisé' }, 403);
  }

  await env.DB.prepare(
    "UPDATE leads SET deleted_at = datetime('now') WHERE id = ?"
  ).bind(leadId).run();

  return json({ data: { success: true } });
}

export async function handleRestoreLead(
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  leadId: string
): Promise<Response> {
  const lead = await env.DB.prepare(
    'SELECT id, client_id FROM leads WHERE id = ? AND deleted_at IS NOT NULL'
  ).bind(leadId).first() as { id: string; client_id: string } | null;

  if (!lead) return json({ error: 'Lead introuvable dans la corbeille' }, 404);
  if (auth.role !== 'admin' && lead.client_id !== auth.clientId) {
    return json({ error: 'Non autorisé' }, 403);
  }

  await env.DB.prepare(
    'UPDATE leads SET deleted_at = NULL WHERE id = ?'
  ).bind(leadId).run();

  return json({ data: { success: true } });
}

export async function handleGetTrash(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  let query = 'SELECT id, name, email, phone, deleted_at, client_id FROM leads WHERE deleted_at IS NOT NULL';
  const params: string[] = [];

  if (auth.role !== 'admin' && auth.clientId) {
    query += ' AND client_id = ?';
    params.push(auth.clientId);
  }

  query += ' ORDER BY deleted_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ data: results || [] });
}

export async function handleEmptyTrash(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Seuls les admins peuvent vider la corbeille' }, 403);
  }

  // Hard delete leads supprimés depuis plus de 30 jours
  await env.DB.prepare(
    "DELETE FROM leads WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')"
  ).run();

  return json({ data: { success: true } });
}

// ── Device Tokens (Push Notifications) ──────────────────────

export async function handleRegisterDevice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  const body = await request.json() as { token: string; platform?: string };
  const token = sanitizeInput(body.token, 500);
  const platform = sanitizeInput(body.platform || 'web', 20);

  if (!token) return json({ error: 'Token requis' }, 400);

  const id = `dt_${crypto.randomUUID()}`;

  // Upsert : supprimer l'ancien token de cet appareil s'il existe
  await env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
  await env.DB.prepare(
    'INSERT INTO device_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)'
  ).bind(id, auth.userId, token, platform).run();

  return json({ data: { id } }, 201);
}

export async function handleUnregisterDevice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  const body = await request.json() as { token: string };
  const token = sanitizeInput(body.token, 500);

  if (!token) return json({ error: 'Token requis' }, 400);

  await env.DB.prepare(
    'DELETE FROM device_tokens WHERE token = ? AND user_id = ?'
  ).bind(token, auth.userId).run();

  return json({ data: { success: true } });
}

// ── SSE Events Stream (temps réel) ──────────────────────────

export async function handleEventsStream(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  // Server-Sent Events : envoie les dernières activités toutes les 5s
  // Note : sur Workers, on ne peut pas garder la connexion ouverte indéfiniment
  // On renvoie les 10 dernières activités depuis les 5 dernières minutes
  
  let query = `
    SELECT al.*, l.name as lead_name 
    FROM activity_log al 
    LEFT JOIN leads l ON al.lead_id = l.id 
    WHERE al.created_at > datetime('now', '-5 minutes')
  `;
  const params: string[] = [];

  if (auth.role !== 'admin' && auth.clientId) {
    query += ' AND l.client_id = ?';
    params.push(auth.clientId);
  }

  query += ' ORDER BY al.created_at DESC LIMIT 10';

  const { results } = await env.DB.prepare(query).bind(...params).all();

  const events = (results || []).map(r => `data: ${JSON.stringify(r)}\n\n`).join('');
  
  return new Response(events || 'data: {"type":"heartbeat"}\n\n', {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}
