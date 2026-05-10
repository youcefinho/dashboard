// ── Module Broadcast — Intralys CRM ─────────────────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { json, audit } from './helpers';
import { isUnsubscribed, generateUnsubscribeToken, generateCaslFooter, generateAmfDisclaimer } from './compliance';

export async function handleEmailBroadcast(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { subject?: string; body_html?: string; body_text?: string; template_id?: string; client_id?: string; filters?: { status?: string[]; type?: string[]; source?: string[]; tags?: string[] } };
  if (!body.subject) return json({ error: 'Sujet requis' }, 400);
  let htmlContent = body.body_html || '';
  let textContent = body.body_text || '';
  if (body.template_id) {
    const tpl = await env.DB.prepare('SELECT subject, body_html, body_text FROM email_templates WHERE id = ?').bind(body.template_id).first() as { subject: string; body_html: string; body_text: string } | null;
    if (tpl) { htmlContent = htmlContent || tpl.body_html; textContent = textContent || tpl.body_text; }
  }
  if (!htmlContent && !textContent) return json({ error: 'Contenu email requis' }, 400);
  let query = "SELECT id, name, email FROM leads WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)";
  const params: string[] = [];
  if (body.client_id) { query += ' AND client_id = ?'; params.push(body.client_id); }
  if (body.filters?.status?.length) { const ph = body.filters.status.map(() => '?').join(','); query += ` AND status IN (${ph})`; params.push(...body.filters.status); }
  if (body.filters?.type?.length) { const ph = body.filters.type.map(() => '?').join(','); query += ` AND type IN (${ph})`; params.push(...body.filters.type); }
  query += ' LIMIT 500';
  const stmt = env.DB.prepare(query);
  const { results: leads } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  if (!leads || leads.length === 0) return json({ error: 'Aucun lead correspondant' }, 400);
  const broadcastId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES (?, 'broadcast.send', 'broadcast', ?, ?)").bind(auth.userId, broadcastId, JSON.stringify({ subject: body.subject, recipient_count: leads.length, filters: body.filters || {}, client_id: body.client_id || 'all' })).run();
  let sent = 0; let failed = 0; const errors: Array<{ email: string; error: string }> = [];
  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    for (const lead of leads as Array<{ id: string; name: string; email: string }>) {
      try {
        const unsub = await isUnsubscribed(env, lead.email, '', 'email');
        if (unsub) continue;
        const personalizedHtml = htmlContent.replace(/\{\{nom\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{email\}\}/g, lead.email || '');
        const unsubToken = generateUnsubscribeToken(lead.email, env.WEBHOOK_SECRET || 'intralys');
        const unsubUrl = `${new URL(request.url).origin}/api/unsubscribe/${unsubToken}`;
        const caslFooter = generateCaslFooter(unsubUrl);
        let amfFooter = '';
        if (body.client_id) {
          const client = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(body.client_id).first() as { amf_certificate?: string; amf_disclaimer_required?: number } | null;
          if (client?.amf_disclaimer_required && client.amf_certificate) amfFooter = generateAmfDisclaimer(client.amf_certificate);
        }
        await resend.emails.send({ from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com', to: [lead.email], subject: body.subject!.replace(/\{\{nom\}\}/g, lead.name || ''), html: personalizedHtml + amfFooter + caslFooter, text: textContent.replace(/\{\{nom\}\}/g, lead.name || '') });
        sent++;
      } catch (err) { failed++; errors.push({ email: lead.email, error: String(err) }); }
    }
  } else { return json({ error: 'RESEND_API_KEY non configurée' }, 500); }
  await audit(env, auth.userId, 'broadcast.complete', 'broadcast', broadcastId, { sent, failed, total: leads.length });
  return json({ data: { broadcast_id: broadcastId, total_recipients: leads.length, sent, failed, errors: errors.slice(0, 10) } });
}

export async function handleBroadcastHistory(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const { results } = await env.DB.prepare(`SELECT resource_id as broadcast_id, details, created_at, user_id FROM audit_log WHERE action IN ('broadcast.send', 'broadcast.complete') ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  const history = ((results || []) as Array<Record<string, unknown>>).map(row => { let details: Record<string, unknown> = {}; try { details = JSON.parse(row.details as string); } catch { /* */ } return { ...row, details }; });
  return json({ data: history });
}
