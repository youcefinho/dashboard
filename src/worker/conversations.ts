// ── Module Conversations — Intralys CRM Sprint 3 ────────────
// CRUD conversations first-class + messages paginés
import type { Env } from './types';
import { sanitizeInput, json } from './helpers';

// ── Lister les conversations ────────────────────────────────

export async function handleGetConversations(
  env: Env,
  auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const channel = url.searchParams.get('channel');
  const status = url.searchParams.get('status') || 'open';
  const search = url.searchParams.get('search');
  const assigned = url.searchParams.get('assigned');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT c.*, l.name as lead_name, l.email as lead_email, l.phone as lead_phone, l.avatar_url as lead_avatar, u.name as assigned_name
    FROM conversations c
    LEFT JOIN leads l ON c.lead_id = l.id
    LEFT JOIN users u ON c.assigned_to = u.id
    WHERE 1=1`;
  const params: (string | number)[] = [];

  // Filtrer par rôle
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;
    if (user?.client_id) {
      query += ' AND c.client_id = ?';
      params.push(user.client_id);
    }
  }

  if (status && status !== 'all') {
    query += ' AND c.status = ?';
    params.push(status);
  }

  if (channel) {
    query += ' AND c.channel = ?';
    params.push(channel);
  }

  if (assigned) {
    query += ' AND c.assigned_to = ?';
    params.push(assigned);
  }

  if (search) {
    query += ' AND (l.name LIKE ? OR l.email LIKE ? OR c.subject LIKE ? OR c.last_message_preview LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  query += ' ORDER BY c.last_message_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Compteurs par statut pour les badges de la sidebar
  const { results: counts } = await env.DB.prepare(
    `SELECT status, COUNT(*) as count FROM conversations GROUP BY status`
  ).all();

  return json({
    data: results || [],
    meta: {
      counts: (counts || []) as Array<{ status: string; count: number }>,
    },
  });
}

// ── Détail d'une conversation + messages ────────────────────

export async function handleGetConversationDetail(
  env: Env,
  _auth: { userId: string; role: string },
  conversationId: string,
  url: URL
): Promise<Response> {
  const conv = await env.DB.prepare(
    `SELECT c.*, l.name as lead_name, l.email as lead_email, l.phone as lead_phone, l.avatar_url as lead_avatar, u.name as assigned_name
     FROM conversations c
     LEFT JOIN leads l ON c.lead_id = l.id
     LEFT JOIN users u ON c.assigned_to = u.id
     WHERE c.id = ?`
  ).bind(conversationId).first();

  if (!conv) return json({ error: 'Conversation introuvable' }, 404);

  // Messages paginés
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let msgQuery = `SELECT m.*, u.name as sender_name
    FROM messages m
    LEFT JOIN users u ON m.sent_by = u.id
    WHERE m.conversation_id = ?`;
  const msgParams: (string | number)[] = [conversationId];

  if (cursor) {
    msgQuery += ' AND m.created_at < ?';
    msgParams.push(cursor);
  }

  msgQuery += ' ORDER BY m.created_at DESC LIMIT ?';
  msgParams.push(limit);

  const { results: messages } = await env.DB.prepare(msgQuery).bind(...msgParams).all();

  // Marquer comme lu (reset unread)
  await env.DB.prepare(
    'UPDATE conversations SET unread_count = 0, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(conversationId).run();

  return json({
    data: {
      ...conv,
      messages: (messages || []).reverse(), // Chronologique
    },
  });
}

// ── Créer une conversation ──────────────────────────────────

export async function handleCreateConversation(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const leadId = sanitizeInput(body.lead_id as string, 100);
  const channel = sanitizeInput(body.channel as string, 30) || 'email';
  const subject = sanitizeInput(body.subject as string, 500);

  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  const allowedChannels = ['email', 'sms', 'webchat', 'facebook_messenger', 'instagram_dm', 'internal_note'];
  if (!allowedChannels.includes(channel)) return json({ error: 'Canal invalide' }, 400);

  // Récupérer le lead
  const lead = await env.DB.prepare('SELECT id, client_id FROM leads WHERE id = ?').bind(leadId).first() as { id: string; client_id: string } | null;
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  // Vérifier s'il existe déjà une conversation ouverte pour ce lead + canal
  const existing = await env.DB.prepare(
    "SELECT id FROM conversations WHERE lead_id = ? AND channel = ? AND status = 'open'"
  ).bind(leadId, channel).first() as { id: string } | null;

  if (existing) {
    return json({ data: { id: existing.id, existing: true } });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO conversations (id, lead_id, client_id, channel, status, assigned_to, subject, last_message_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?, datetime('now'))`
  ).bind(id, leadId, lead.client_id, channel, auth.userId, subject || '').run();

  return json({ data: { id, existing: false } });
}

// ── Envoyer un message dans une conversation ────────────────

export async function handleSendConversationMessage(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  conversationId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const messageBody = sanitizeInput(body.body as string, 10000);
  const subject = sanitizeInput(body.subject as string, 500);

  if (!messageBody) return json({ error: 'Contenu requis' }, 400);

  // Récupérer la conversation
  const conv = await env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ?'
  ).bind(conversationId).first() as Record<string, unknown> | null;

  if (!conv) return json({ error: 'Conversation introuvable' }, 404);

  const messageId = crypto.randomUUID();
  const channel = conv.channel as string;
  let status = 'sent';

  // Envoi réel selon le canal (email via Resend, SMS via Twilio)
  // Pour l'instant, on enregistre le message — l'envoi réel est délégué au module messages existant
  if (channel === 'internal_note') {
    status = 'delivered';
  } else if (channel === 'facebook' || channel === 'instagram') {
    const { sendMetaMessage } = await import('./meta');
    try {
      const metaRes = await sendMetaMessage(env, conv.lead_id as string, conv.client_id as string, messageBody, channel, auth.userId);
      return json({ data: { id: metaRes.message_id, success: true, status: 'delivered' } });
    } catch (e: any) {
      return json({ error: 'Meta error: ' + e.message }, 500);
    }
  }

  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, subject, body, status, sent_by)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?)`
  ).bind(
    messageId, conv.lead_id as string, conv.client_id as string,
    conversationId, channel, subject || '', messageBody, status, auth.userId
  ).run();

  // Mettre à jour la conversation
  const preview = messageBody.substring(0, 120);
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(preview, conversationId).run();

  // Log d'activité
  const actionType = channel === 'email' ? 'email_sent' : channel === 'sms' ? 'sms_sent' : 'note_added';
  await env.DB.prepare(
    'INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    conv.lead_id as string, conv.client_id as string, auth.userId, actionType,
    JSON.stringify({ channel, conversation_id: conversationId, message_id: messageId })
  ).run();

  // Rouvrir si la conversation était fermée
  if (conv.status === 'closed') {
    await env.DB.prepare(
      "UPDATE conversations SET status = 'open', updated_at = datetime('now') WHERE id = ?"
    ).bind(conversationId).run();
  }

  return json({ data: { id: messageId, success: true, status } });
}

// ── Mettre à jour une conversation ──────────────────────────

export async function handleUpdateConversation(
  request: Request,
  env: Env,
  _auth: { userId: string; role: string },
  conversationId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.status !== undefined) {
    const allowed = ['open', 'closed', 'snoozed'];
    if (!allowed.includes(body.status as string)) return json({ error: 'Statut invalide' }, 400);
    updates.push('status = ?');
    params.push(body.status as string);
  }

  if (body.assigned_to !== undefined) {
    updates.push('assigned_to = ?');
    params.push(body.assigned_to as string);
  }

  if (body.is_starred !== undefined) {
    updates.push('is_starred = ?');
    params.push(body.is_starred as number);
  }

  if (body.snoozed_until !== undefined) {
    updates.push('snoozed_until = ?');
    params.push(body.snoozed_until as string);
  }

  if (updates.length === 0) return json({ error: 'Aucune mise à jour' }, 400);

  updates.push("updated_at = datetime('now')");
  params.push(conversationId);

  await env.DB.prepare(
    `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ data: { success: true } });
}

// ── Helper : trouver ou créer une conversation (pour inbound) ──

export async function findOrCreateConversation(
  env: Env,
  leadId: string,
  clientId: string,
  channel: string
): Promise<string> {
  // Chercher une conversation ouverte existante
  const existing = await env.DB.prepare(
    "SELECT id FROM conversations WHERE lead_id = ? AND channel = ? AND status != 'closed' ORDER BY last_message_at DESC LIMIT 1"
  ).bind(leadId, channel).first() as { id: string } | null;

  if (existing) return existing.id;

  // Créer une nouvelle conversation
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO conversations (id, lead_id, client_id, channel, status, last_message_at, unread_count)
     VALUES (?, ?, ?, ?, 'open', datetime('now'), 1)`
  ).bind(id, leadId, clientId, channel).run();

  return id;
}
