// ── Module Broadcast — Intralys CRM (refactoré Sprint Consolidation Queue) ──
import type { Env } from './types';
import { json, audit } from './helpers';
import { isUnsubscribed } from './compliance';

export async function handleEmailBroadcast(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as {
    subject?: string; body_html?: string; body_text?: string; text_content?: string;
    template_id?: string; client_id?: string;
    filters?: { status?: string[]; type?: string[]; source?: string[]; tags?: string[] }
  };
  if (!body.subject) return json({ error: 'Sujet requis' }, 400);

  let htmlContent = body.body_html || '';
  let textContent = body.body_text || body.text_content || '';

  if (body.template_id) {
    const tpl = await env.DB.prepare('SELECT subject, body_html, body_text FROM email_templates WHERE id = ?').bind(body.template_id).first() as { subject: string; body_html: string; body_text: string } | null;
    if (tpl) { htmlContent = htmlContent || tpl.body_html; textContent = textContent || tpl.body_text; }
  }
  if (!htmlContent && !textContent) return json({ error: 'Contenu email requis (body_html, body_text ou text_content)' }, 400);

  // Fix smell #10 : client_id OBLIGATOIRE si filters.tags présent (garde cross-tenant)
  if (body.filters?.tags?.length && !body.client_id) {
    return json({ error: 'client_id requis quand des tags sont utilisés comme filtre (protection cross-tenant)' }, 400);
  }

  let query = "SELECT id, name, email FROM leads WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)";
  const params: string[] = [];
  if (body.client_id) { query += ' AND client_id = ?'; params.push(body.client_id); }
  if (body.filters?.status?.length) { const ph = body.filters.status.map(() => '?').join(','); query += ` AND status IN (${ph})`; params.push(...body.filters.status); }
  if (body.filters?.type?.length) { const ph = body.filters.type.map(() => '?').join(','); query += ` AND type IN (${ph})`; params.push(...body.filters.type); }
  
  const stmt = env.DB.prepare(query);
  const { results: leads } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  if (!leads || leads.length === 0) return json({ error: 'Aucun lead correspondant' }, 400);

  const broadcastId = crypto.randomUUID();

  // Fix smell #13 : filtrer unsubscribe AVANT le count
  const eligibleLeads: Array<{ id: string; name: string; email: string }> = [];
  for (const lead of leads as Array<{ id: string; name: string; email: string }>) {
    const unsub = await isUnsubscribed(env, lead.email, '', 'email');
    if (!unsub) eligibleLeads.push(lead);
  }

  if (eligibleLeads.length === 0) return json({ error: 'Aucun lead éligible (tous désabonnés)' }, 400);

  // Insérer dans la table broadcasts
  await env.DB.prepare(
    `INSERT INTO broadcasts (id, client_id, user_id, subject, template_id, body_html, body_text, filters_json, total, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`
  ).bind(
    broadcastId, body.client_id || null, auth.userId, body.subject, body.template_id || null, htmlContent, textContent, JSON.stringify(body.filters || {}), eligibleLeads.length
  ).run();

  await audit(env, auth.userId, 'broadcast.queued', 'broadcast', broadcastId, {
    subject: body.subject, recipient_count: eligibleLeads.length,
    filters: body.filters || {}, client_id: body.client_id || 'all'
  });

  // Batch par 50 pour la Queue Cloudflare
  const batchSize = 50;
  let jobsEnqueued = 0;
  for (let i = 0; i < eligibleLeads.length; i += batchSize) {
    const batch = eligibleLeads.slice(i, i + batchSize);
    
    await env.BROADCAST_QUEUE.send({
      broadcastId,
      subject: body.subject,
      htmlContent,
      textContent,
      clientId: body.client_id,
      authUserId: auth.userId,
      leads: batch,
      origin: new URL(request.url).origin
    });
    jobsEnqueued++;
  }

  return json({ 
    data: { 
      broadcast_id: broadcastId, 
      total_recipients: eligibleLeads.length, 
      jobs_enqueued: jobsEnqueued,
      status: 'queued'
    } 
  });
}

export async function handleGetBroadcasts(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const { results } = await env.DB.prepare(`SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return json({ data: results || [] });
}

export async function handleGetBroadcastDetail(env: Env, auth: { role: string }, broadcastId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const broadcast = await env.DB.prepare(`SELECT * FROM broadcasts WHERE id = ?`).bind(broadcastId).first();
  if (!broadcast) return json({ error: 'Broadcast introuvable' }, 404);
  return json({ data: broadcast });
}

export async function processBroadcastQueueJob(batch: MessageBatch<any>, env: Env): Promise<void> {
  // Optionnel: importer Resend statiquement en haut
  const { Resend } = await import('resend');
  const { generateUnsubscribeToken, generateCaslFooter, generateAmfDisclaimer } = await import('./compliance');

  for (const message of batch.messages) {
    const job = message.body;
    const { broadcastId, subject, htmlContent, textContent, clientId, authUserId, leads, origin } = job;

    let sent = 0;
    let failed = 0;

    // Update status to processing
    await env.DB.prepare(`UPDATE broadcasts SET status = 'processing' WHERE id = ?`).bind(broadcastId).run();

    if (env.USE_MOCKS === 'true') {
      for (const lead of leads) {
        try {
          const personalizedHtml = htmlContent.replace(/\{\{nom\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{email\}\}/g, lead.email || '');
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id)
             VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'mock-sent', ?, ?)`
          ).bind(crypto.randomUUID(), lead.id, clientId || '', subject!.replace(/\{\{nom\}\}/g, lead.name || ''), personalizedHtml, authUserId, 'mock-broadcast-' + broadcastId).run();
          sent++;
        } catch (err) {
          failed++;
        }
      }
    } else if (env.RESEND_API_KEY) {
      const resend = new Resend(env.RESEND_API_KEY);
      
      const promises = leads.map(async (lead: any) => {
        try {
          const personalizedHtml = htmlContent.replace(/\{\{nom\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{email\}\}/g, lead.email || '');
          const unsubToken = generateUnsubscribeToken(lead.email, env.WEBHOOK_SECRET || 'intralys');
          const unsubUrl = `${origin}/api/unsubscribe/${unsubToken}`;
          const caslFooter = generateCaslFooter(unsubUrl);
          let amfFooter = '';
          if (clientId) {
            const client = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(clientId).first() as { amf_certificate?: string; amf_disclaimer_required?: number } | null;
            if (client?.amf_disclaimer_required && client.amf_certificate) amfFooter = generateAmfDisclaimer(client.amf_certificate);
          }
          await resend.emails.send({
            from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
            to: [lead.email],
            subject: subject!.replace(/\{\{nom\}\}/g, lead.name || ''),
            html: personalizedHtml + amfFooter + caslFooter,
            text: textContent.replace(/\{\{nom\}\}/g, lead.name || ''),
          });
          sent++;
        } catch (err) {
          failed++;
        }
      });
      await Promise.all(promises);
    }

    // Update broadcast stats
    await env.DB.prepare(`UPDATE broadcasts SET sent = sent + ?, failed = failed + ? WHERE id = ?`).bind(sent, failed, broadcastId).run();

    // Check if fully completed
    const b = await env.DB.prepare(`SELECT total, sent, failed FROM broadcasts WHERE id = ?`).bind(broadcastId).first() as { total: number; sent: number; failed: number } | null;
    if (b && (b.sent + b.failed) >= b.total) {
      await env.DB.prepare(`UPDATE broadcasts SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).bind(broadcastId).run();
      await audit(env, authUserId, 'broadcast.complete', 'broadcast', broadcastId, { sent: b.sent, failed: b.failed, total: b.total });
    }

    message.ack();
  }
}
