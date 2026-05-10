// ── Module Messages — Intralys CRM ──────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, audit, sendSms, createNotification } from './helpers';

export async function handleGetLeadMessages(
  env: Env,
  _auth: { userId: string; role: string },
  leadId: string
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT m.*, l.name as lead_name, u.name as sender_name
     FROM messages m
     LEFT JOIN leads l ON m.lead_id = l.id
     LEFT JOIN users u ON m.sent_by = u.id
     WHERE m.lead_id = ?
     ORDER BY m.created_at DESC
     LIMIT 100`
  ).bind(leadId).all();

  return json({ data: results || [] });
}

export async function handleSendMessage(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  leadId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const channel = sanitizeInput(body.channel as string, 20);
  const subject = sanitizeInput(body.subject as string, 200);
  const messageBody = sanitizeInput(body.body as string, 5000);

  if (!channel || !messageBody) {
    return json({ error: 'Canal et contenu requis' }, 400);
  }

  const allowedChannels = ['email', 'sms', 'internal_note'];
  if (!allowedChannels.includes(channel)) {
    return json({ error: 'Canal invalide' }, 400);
  }

  // Récupérer le lead
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) {
    return json({ error: 'Lead introuvable' }, 404);
  }

  const messageId = crypto.randomUUID();
  let status = 'sent';
  let externalId = '';

  // Envoi réel via Resend (email) ou Twilio (SMS)
  if (channel === 'email' && env.RESEND_API_KEY) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      const emailResult = await resend.emails.send({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [lead.email as string],
        subject: subject || 'Message de votre courtier',
        html: messageBody,
      });
      if (emailResult.data) {
        externalId = emailResult.data.id;
        status = 'delivered';
      }
    } catch (err) {
      console.error('Erreur envoi email:', err);
      status = 'failed';
    }
  } else if (channel === 'sms') {
    status = 'sent';
  } else if (channel === 'internal_note') {
    status = 'delivered';
  }

  // Enregistrer le message en DB
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id)
     VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?)`
  ).bind(
    messageId, leadId, lead.client_id as string,
    channel, subject, messageBody, status,
    auth.userId, externalId
  ).run();

  // Log d'activité
  const actionType = channel === 'email' ? 'email_sent' : channel === 'sms' ? 'sms_sent' : 'note_added';
  await env.DB.prepare(
    `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    leadId, lead.client_id as string, auth.userId, actionType,
    JSON.stringify({ channel, subject, status, message_id: messageId })
  ).run();

  return json({ data: { id: messageId, success: true, status } });
}

export async function handleGetInboxMessages(
  env: Env,
  auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const channel = url.searchParams.get('channel');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT m.*, l.name as lead_name, u.name as sender_name
               FROM messages m
               LEFT JOIN leads l ON m.lead_id = l.id
               LEFT JOIN users u ON m.sent_by = u.id
               WHERE 1=1`;
  const params: (string | number)[] = [];

  // Si courtier, filtrer par client_id
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as Record<string, unknown> | null;
    if (user?.client_id) {
      query += ' AND m.client_id = ?';
      params.push(user.client_id as string);
    }
  }

  if (channel) {
    query += ' AND m.channel = ?';
    params.push(channel);
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

export async function handleSendSms(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { lead_id?: string; to?: string; message?: string };
  if (!body.message || body.message.length < 1) return json({ error: 'Message requis' }, 400);

  let to = body.to || '';
  let leadId = body.lead_id || '';
  let clientId = '';

  if (leadId) {
    const lead = await env.DB.prepare('SELECT phone, client_id FROM leads WHERE id = ?').bind(leadId).first() as { phone: string; client_id: string } | null;
    if (!lead || !lead.phone) return json({ error: 'Lead introuvable ou sans téléphone' }, 404);
    to = lead.phone;
    clientId = lead.client_id;
  }

  if (!to) return json({ error: 'Numéro de téléphone requis' }, 400);

  const result = await sendSms(env, to, sanitizeInput(body.message, 1600));
  if (!result.success) return json({ error: result.error || 'Échec envoi SMS' }, 500);

  // Logger le message
  const msgId = crypto.randomUUID();
  if (leadId) {
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id)
       VALUES (?, ?, ?, 'outbound', 'sms', ?, 'sent', ?, ?)`
    ).bind(msgId, leadId, clientId, sanitizeInput(body.message, 1600), auth.userId, result.sid || '').run();
  }

  await audit(env, auth.userId, 'sms.send', 'message', msgId, { to, lead_id: leadId });
  return json({ data: { success: true, sid: result.sid } });
}

export async function handleInboundSms(request: Request, env: Env): Promise<Response> {
  // Twilio envoie en application/x-www-form-urlencoded
  const formData = await request.formData();
  const from = formData.get('From') as string || '';
  const body = formData.get('Body') as string || '';
  const sid = formData.get('MessageSid') as string || '';

  if (!from || !body) {
    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  }

  // Chercher le lead par téléphone
  const cleanPhone = from.replace(/\D/g, '').slice(-10);
  const lead = await env.DB.prepare(
    "SELECT id, client_id, name FROM leads WHERE REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') LIKE ?"
  ).bind(`%${cleanPhone}`).first() as { id: string; client_id: string; name: string } | null;

  if (lead) {
    // Sauvegarder le message inbound
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id)
       VALUES (?, ?, ?, 'inbound', 'sms', ?, 'delivered', ?, ?)`
    ).bind(crypto.randomUUID(), lead.id, lead.client_id, sanitizeInput(body, 1600), from, sid).run();

    // Notifier les admins
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(env, admin.id, '📱 SMS reçu', `${lead.name}: "${body.substring(0, 80)}"`, '📱', `/leads/${lead.id}`, lead.client_id);
    }
  }

  // Réponse TwiML vide (pas de réponse auto)
  return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
}

export async function handleInboundEmail(request: Request, env: Env): Promise<Response> {
  // Resend envoie le webhook en JSON
  const payload = await request.json() as {
    type?: string;
    data?: {
      from?: string;
      to?: string[];
      subject?: string;
      text?: string;
      html?: string;
      headers?: Array<{ name: string; value: string }>;
    };
  };

  if (payload.type !== 'email.received' || !payload.data) {
    return json({ received: true });
  }

  const data = payload.data;
  const fromEmail = (data.from || '').toLowerCase();
  const subject = sanitizeInput(data.subject || '(sans sujet)', 500);
  const bodyText = sanitizeInput(data.text || data.html || '', 10000);

  if (!fromEmail) return json({ received: true });

  // Chercher le lead par email
  const lead = await env.DB.prepare(
    'SELECT id, client_id, name FROM leads WHERE LOWER(email) = ?'
  ).bind(fromEmail).first() as { id: string; client_id: string; name: string } | null;

  if (lead) {
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by)
       VALUES (?, ?, ?, 'inbound', 'email', ?, ?, 'delivered', ?)`
    ).bind(crypto.randomUUID(), lead.id, lead.client_id, subject, bodyText, fromEmail).run();

    // Notifier les admins
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(env, admin.id, '📧 Email reçu', `${lead.name}: ${subject.substring(0, 80)}`, '📧', `/leads/${lead.id}`, lead.client_id);
    }
  }

  return json({ received: true });
}
