// ── Module Messages — Intralys CRM ──────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, audit, sendSms, createNotification, isLeadDnd } from './helpers';
import { findOrCreateConversation } from './conversations';
import { analyzeSentimentAndIntent } from './lib/sentiment-intent-engine';
import { isUnsubscribed, generateCaslFooter, generateAmfDisclaimer, generateUnsubscribeToken } from './compliance';
import {
  sanitizeBody as engineSanitizeBody,
  computeMessageBodyCapForChannel,
  MESSAGE_ERROR_CODES,
} from './lib/messaging-engine';
import { detectStopKeyword } from './twilio-verify';
import { tLead } from './i18n-server';
import type { DndChannel } from './helpers';

export function wrapEmailWithTracking(html: string, messageId: string, domain: string): string {
  const trackedHtml = html.replace(/href=["'](https?:\/\/[^"']+)["']/g, (match, url) => {
    if (url.includes('/api/unsubscribe/') || url.includes('/api/t/c/')) return match;
    const trackingUrl = `${domain}/api/t/c/${messageId}?url=${encodeURIComponent(url)}`;
    return `href="${trackingUrl}"`;
  });
  const pixel = `<img src="${domain}/api/t/o/${messageId}" width="1" height="1" style="display:none;" />`;
  if (trackedHtml.includes('</body>')) {
    return trackedHtml.replace('</body>', `${pixel}</body>`);
  }
  return trackedHtml + pixel;
}

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
  // Sanitize via engine (XSS strip) puis cap selon channel (SMS 1600, autre 5000).
  // engineSanitizeBody est ADDITIF : il strip script/iframe/event handlers en plus
  // du sanitizeInput existant. cap_legacy=5000 préservé (max au-dessus du SMS cap).
  const rawBody = sanitizeInput(body.body as string, 5000);
  const messageBody = engineSanitizeBody(rawBody).trim();

  if (!channel || !messageBody) {
    return json({ error: 'Canal et contenu requis', error_code: MESSAGE_ERROR_CODES.EMPTY_BODY }, 400);
  }

  const allowedChannels = ['email', 'sms', 'internal_note'];
  if (!allowedChannels.includes(channel)) {
    return json({ error: 'Canal invalide', error_code: MESSAGE_ERROR_CODES.INVALID_CHANNEL }, 400);
  }

  // Cap channel-aware (SMS = 1600). Cap legacy 5000 déjà appliqué en amont via
  // sanitizeInput pour les autres channels — ici on rejette explicitement SMS > 1600.
  const cap = computeMessageBodyCapForChannel(channel);
  if (messageBody.length > cap) {
    return json({ error: `Message trop long pour ${channel}`, error_code: MESSAGE_ERROR_CODES.BODY_TOO_LONG }, 400);
  }

  // Récupérer le lead
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) {
    return json({ error: 'Lead introuvable' }, 404);
  }

  // Vérification DND avant envoi (sauf notes internes)
  if (channel !== 'internal_note') {
    const dndBlocked = await isLeadDnd(env, leadId, channel as DndChannel);
    if (dndBlocked) {
      return json({ error: `Envoi bloqué : le lead a activé DND pour le canal ${channel}` }, 403);
    }

    const emailValue = String(lead.email || '');
    const phoneValue = String(lead.phone || '');
    const isUnsub = await isUnsubscribed(env, emailValue, phoneValue, channel);
    if (isUnsub) {
      return json({ error: `Envoi bloqué (CASL) : contact désabonné pour ${channel}` }, 403);
    }
  }

  // Récupérer les options du client pour l'AMF
  const clientData = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(lead.client_id).first() as { amf_certificate?: string; amf_disclaimer_required?: number } | null;

  let finalMessageBody = messageBody;
  if (channel === 'email' && typeof env.WEBHOOK_SECRET === 'string') {
    const unsubToken = generateUnsubscribeToken(String(lead.email), env.WEBHOOK_SECRET);
    const domain = env.ALLOWED_ORIGINS.split(',')[0] || 'http://localhost:5173';
    const unsubUrl = `${domain}/unsubscribe/${unsubToken}`;
    finalMessageBody += generateCaslFooter(unsubUrl);

    if (clientData?.amf_disclaimer_required && clientData?.amf_certificate) {
      finalMessageBody += generateAmfDisclaimer(clientData.amf_certificate);
    }
  }

  const messageId = crypto.randomUUID();
  let status = 'sent';
  let externalId = '';

  if (channel === 'email') {
    const domain = env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
    finalMessageBody = wrapEmailWithTracking(finalMessageBody, messageId, domain);
  }

  // Envoi réel via Resend (email) ou Twilio (SMS) — ou mocks en dev
  if (channel === 'email') {
    if (env.USE_MOCKS === 'true') {
      const { mockSendEmail } = await import('./mocks/mock-resend');
      const mockResult = await mockSendEmail(env, leadId, lead.client_id as string, {
        to: [lead.email as string], subject: subject || 'Nouveau message', html: finalMessageBody,
      });
      externalId = mockResult.data.id;
      status = 'mock-sent';
    } else if (env.RESEND_API_KEY) {
      try {
        const resend = new Resend(env.RESEND_API_KEY);
        const emailResult = await resend.emails.send({
          from: 'Intralys CRM <noreply@intralys.com>',
          to: [lead.email as string],
          subject: subject || 'Nouveau message',
          html: finalMessageBody,
        });
        if (emailResult.data) {
          externalId = emailResult.data.id;
          status = 'delivered';
        }
      } catch (err) {
        console.error('Erreur envoi email:', err);
        status = 'failed';
      }
    }
  } else if (channel === 'sms') {
    if (env.USE_MOCKS === 'true') {
      const { mockSendSms } = await import('./mocks/mock-twilio');
      const mockResult = await mockSendSms(env, leadId, lead.client_id as string, {
        to: lead.phone as string, body: messageBody,
      });
      externalId = mockResult.sid;
      status = 'mock-sent';
    } else {
      const smsTo = String(lead.phone || '');
      if (!smsTo) {
        status = 'failed';
      } else {
        const r = await sendSms(env, smsTo, messageBody);
        status = r.success ? 'sent' : 'failed';
        externalId = r.sid || '';
      }
    }
  } else if (channel === 'internal_note') {
    status = 'delivered';
  }

  // Trouver ou créer la conversation
  const convId = await findOrCreateConversation(env, leadId, lead.client_id as string, channel);

  // Enregistrer le message en DB
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, subject, body, status, sent_by, external_id)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?)`
  ).bind(
    messageId, leadId, lead.client_id as string, convId,
    channel, subject, messageBody, status,
    auth.userId, externalId
  ).run();

  // Mettre à jour la conversation
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(messageBody.substring(0, 120), convId).run();

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

  // Si compte standard, filtrer par client_id
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

  // LOT SMS/WHATSAPP §6.H — refus AVANT envoi si le contact a fait STOP/opt-out
  // CASL (lookup par téléphone, channel 'sms'). best-effort : table absente ⇒
  // isUnsubscribed renvoie false ⇒ envoi normal (rétro-compat).
  const smsUnsub = await isUnsubscribed(env, '', to, 'sms');
  if (smsUnsub) return json({ error: 'Envoi bloqué (CASL) : contact désabonné pour sms' }, 403);

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
    "SELECT id, client_id, name, preferred_language FROM leads WHERE REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') LIKE ?"
  ).bind(`%${cleanPhone}`).first() as { id: string; client_id: string; name: string; preferred_language?: string | null } | null;

  // ── STOP / opt-out CASL (LOT SMS/WHATSAPP seq 104, §6.H) ────────────────────
  // detectStopKeyword (posé Phase A, ./twilio-verify) : si le body est un
  // mot-clé STOP/désabonnement → on enregistre l'opt-out (BLOQUANT LÉGAL CASL),
  // on journalise le consentement retiré, puis on renvoie un auto-reply TwiML de
  // confirmation. On COURT-CIRCUITE ici : un STOP ne crée PAS de message/
  // conversation inbound « normal ». best-effort : aucune écriture ne doit jamais
  // faire échouer la réponse 200 vers Twilio.
  if (detectStopKeyword(body)) {
    try {
      // INSERT unsubscribes (colonnes RÉELLES migration-phase8.sql :
      //   id, email, phone, channel CHECK('email','sms','all'), reason,
      //   client_id, unsubscribed_at). On pose channel='sms' (valeur autorisée
      //   par le CHECK). Idempotent : on n'insère pas un doublon sms/all déjà
      //   présent pour ce téléphone.
      const already = await env.DB.prepare(
        "SELECT id FROM unsubscribes WHERE phone = ? AND (channel = 'sms' OR channel = 'all')"
      ).bind(from).first();
      if (!already) {
        await env.DB.prepare(
          "INSERT INTO unsubscribes (id, email, phone, channel, reason, client_id) VALUES (?, '', ?, 'sms', 'STOP SMS entrant', ?)"
        ).bind(crypto.randomUUID(), from, lead?.client_id || '').run();
      }
      // Journal de consentement retiré (calque compliance.handleLogConsent :
      //   consent_type='marketing_sms', granted=0). consent_log.lead_id est NOT
      //   NULL → on ne journalise QUE si on a retrouvé le lead par téléphone.
      if (lead) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const ua = request.headers.get('User-Agent') || '';
        await env.DB.prepare(
          "INSERT INTO consent_log (id, lead_id, consent_type, granted, ip, user_agent) VALUES (?, ?, 'marketing_sms', 0, ?, ?)"
        ).bind(crypto.randomUUID(), lead.id, ip, ua).run();
      }
    } catch (e) {
      console.error('Inbound SMS STOP opt-out error:', e);
    }
    // Auto-reply TwiML de confirmation, localisé selon la langue du lead
    // (preferred_language NULL/absent ⇒ tLead retombe sur fr-CA par défaut).
    const confirm = tLead(lead?.preferred_language ?? null, 'system.sms_unsubscribe_confirm');
    return new Response(
      `<Response><Message>${sanitizeInput(confirm, 1600)}</Message></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }

  if (lead) {
    // Trouver ou créer la conversation
    const convId = await findOrCreateConversation(env, lead.id, lead.client_id, 'sms');
    const sanitizedBody = sanitizeInput(body, 1600);

    // Analyser le sentiment et l'intention de vente
    const { sentiment, intent } = await analyzeSentimentAndIntent(env, sanitizedBody);

    // Sauvegarder le message inbound
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, external_id, sentiment, detected_intent)
       VALUES (?, ?, ?, ?, 'inbound', 'sms', ?, 'delivered', ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), lead.id, lead.client_id, convId,
      sanitizedBody, from, sid, sentiment, intent
    ).run();

    // Mettre à jour la conversation
    await env.DB.prepare(
      `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(sanitizedBody.substring(0, 120), convId).run();

    // Webhook event
    try {
      const { publishEvent } = await import('./webhooks-dispatch');
      publishEvent(env, lead.client_id, 'message.received', { lead_id: lead.id, channel: 'sms', body: sanitizedBody });
    } catch (e) {
      console.error('Webhook error:', e);
    }

    // Stop on reply (Workflows)
    const activeEnrollments = await env.DB.prepare(
      `SELECT we.id, w.trigger_config FROM workflow_enrollments we
       JOIN workflows w ON we.workflow_id = w.id
       WHERE we.lead_id = ? AND we.status = 'active'`
    ).bind(lead.id).all();
    if (activeEnrollments.results) {
      for (const enr of activeEnrollments.results as any[]) {
         let config: any = {};
         try { config = JSON.parse(enr.trigger_config || '{}'); } catch {}
         if (config.stop_on_reply) {
            await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enr.id).run();
         }
      }
    }

    // Notifier les admins
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(env, admin.id, '📱 SMS reçu', `${lead.name}: "${body.substring(0, 80)}"`, '📱', `/conversations`, lead.client_id);
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
    // Trouver ou créer la conversation
    const convId = await findOrCreateConversation(env, lead.id, lead.client_id, 'email');

    // Analyser le sentiment et l'intention de vente
    const { sentiment, intent } = await analyzeSentimentAndIntent(env, bodyText);

    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, subject, body, status, sent_by, sentiment, detected_intent)
       VALUES (?, ?, ?, ?, 'inbound', 'email', ?, ?, 'delivered', ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), lead.id, lead.client_id, convId,
      subject, bodyText, fromEmail, sentiment, intent
    ).run();

    // Mettre à jour la conversation
    await env.DB.prepare(
      `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(bodyText.substring(0, 120), convId).run();

    // Webhook event
    try {
      const { publishEvent } = await import('./webhooks-dispatch');
      publishEvent(env, lead.client_id, 'message.received', { lead_id: lead.id, channel: 'email', subject, body: bodyText });
    } catch (e) {
      console.error('Webhook error:', e);
    }

    // Stop on reply (Workflows)
    const activeEnrollments = await env.DB.prepare(
      `SELECT we.id, w.trigger_config FROM workflow_enrollments we
       JOIN workflows w ON we.workflow_id = w.id
       WHERE we.lead_id = ? AND we.status = 'active'`
    ).bind(lead.id).all();
    if (activeEnrollments.results) {
      for (const enr of activeEnrollments.results as any[]) {
         let config: any = {};
         try { config = JSON.parse(enr.trigger_config || '{}'); } catch {}
         if (config.stop_on_reply) {
            await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enr.id).run();
         }
      }
    }

    // Notifier les admins
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(env, admin.id, '📧 Email reçu', `${lead.name}: ${subject.substring(0, 80)}`, '📧', `/conversations`, lead.client_id);
    }
  }

  return json({ received: true });
}

// ── LOT SMS/WHATSAPP seq 104 — STUB Phase A (corps réel = Manager-B) ─────────
//
// ⚠ RÈGLE DE NON-COLLISION (docs/LOT-SMS-WHATSAPP.md §6.H) : messages.ts est
//   OWNED par Manager-B en Phase B. Phase A (Manager-A) N'A AJOUTÉ QUE ce stub
//   `handleSmsStatusCallback` EN FIN DE FICHIER + un commentaire repère dans
//   handleInboundSms ; tout le reste (durcissement handleInboundSms : STOP →
//   INSERT unsubscribes + auto-reply TwiML + log consent ; corps réel du
//   status-callback ; check isUnsubscribed dans handleSendSmsRoute) = Manager-B.
//   Cela évite une double-écriture sur ce fichier partagé.
//
// handleSmsStatusCallback — delivery receipt SMS (Twilio status-callback,
// POST /api/webhook/sms/status, PUBLIC). Twilio envoie MessageSid +
// MessageStatus (queued|sent|delivered|undelivered|failed). PUBLIC : pas d'auth
// applicative (corrélation par MessageSid → messages.external_id du tenant).
// Réponse 200 TOUJOURS (jamais de 500 vers Twilio).
export async function handleSmsStatusCallback(request: Request, env: Env): Promise<Response> {
  // Corps réel — Twilio envoie en application/x-www-form-urlencoded :
  //   MessageSid + MessageStatus (queued|sent|delivered|undelivered|failed).
  // Corrélation par MessageSid → messages.external_id : le SID Twilio sortant
  // est stocké dans messages.external_id (cf. handleSendSms l.251-253 +
  // handleSendMessage l.158-165). delivery_status = colonne seq 104 (DISTINCT
  // de status). Best-effort : jamais de throw, réponse 200 TOUJOURS (Twilio).
  try {
    const formData = await request.formData();
    const sid = formData.get('MessageSid') as string || '';
    const status = formData.get('MessageStatus') as string || '';
    if (sid && status) {
      await env.DB.prepare(
        'UPDATE messages SET delivery_status = ? WHERE external_id = ?'
      ).bind(status, sid).run();
    }
  } catch (e) {
    console.error('SMS status callback error:', e);
  }
  return new Response('', { status: 200 });
}
