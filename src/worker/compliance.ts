// ── Module Compliance (CASL + Loi 25 + AMF) — Intralys CRM ─
import type { Env } from './types';
import { sanitizeHtml, json, audit, corsHeaders } from './helpers';

// ── Helpers CASL ────────────────────────────────────────────

export function generateUnsubscribeToken(email: string, secret: string): string {
  const data = `unsub:${email}:${secret}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + '-' + btoa(email).replace(/=/g, '');
}

export function extractEmailFromToken(token: string): string | null {
  const parts = token.split('-');
  if (parts.length < 2) return null;
  try {
    return atob(parts.slice(1).join('-'));
  } catch {
    return null;
  }
}

export function generateCaslFooter(unsubscribeUrl: string): string {
  return `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;">
      <p>Vous recevez cet email car vous avez consenti à recevoir des communications d'Intralys.</p>
      <p><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Se désabonner</a> | Conformément à la Loi canadienne anti-pourriel (LCAP/CASL)</p>
    </div>
  `;
}

export function generateAmfDisclaimer(certificate: string): string {
  return `
    <div style="margin-top:24px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:10px;color:#6b7280;text-align:center;">
      <p style="margin:0;">Mentions légales : ${sanitizeHtml(certificate)}</p>
      <p style="margin:4px 0 0;">Les rendements passés ne garantissent pas les rendements futurs. Consultez un conseiller qualifié avant toute décision.</p>
    </div>
  `;
}

export async function isUnsubscribed(env: Env, email: string, phone: string, channel: string): Promise<boolean> {
  if (channel === 'email' && email) {
    const result = await env.DB.prepare(
      "SELECT id FROM unsubscribes WHERE email = ? AND (channel = 'email' OR channel = 'all')"
    ).bind(email.toLowerCase()).first();
    if (result) return true;
  }
  if (channel === 'sms' && phone) {
    const result = await env.DB.prepare(
      "SELECT id FROM unsubscribes WHERE phone = ? AND (channel = 'sms' OR channel = 'all')"
    ).bind(phone).first();
    if (result) return true;
  }
  return false;
}

// ── Handlers ────────────────────────────────────────────────

export async function handlePublicUnsubscribe(env: Env, token: string): Promise<Response> {
  const email = extractEmailFromToken(token);
  if (!email) {
    return new Response('<html><body><h1>Lien invalide</h1><p>Ce lien de désabonnement est invalide ou expiré.</p></body></html>', {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
    });
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM unsubscribes WHERE email = ?'
  ).bind(email.toLowerCase()).first();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO unsubscribes (id, email, channel, reason) VALUES (?, ?, 'all', 'lien désabonnement')"
    ).bind(crypto.randomUUID(), email.toLowerCase()).run();
  }

  return new Response(`
    <html>
    <head><meta charset="utf-8"><title>Désabonné</title></head>
    <body style="font-family:system-ui;max-width:500px;margin:60px auto;text-align:center;color:#374151;">
      <h1 style="color:#10b981;">✅ Désabonnement confirmé</h1>
      <p>L'adresse <strong>${sanitizeHtml(email)}</strong> a été retirée de nos listes d'envoi.</p>
      <p style="color:#9ca3af;font-size:13px;">Conformément à la Loi canadienne anti-pourriel (LCAP/CASL), vous ne recevrez plus de communications marketing de notre part.</p>
    </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function handleGetUnsubscribes(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const { results } = await env.DB.prepare(
    'SELECT * FROM unsubscribes ORDER BY unsubscribed_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM unsubscribes').first() as { total: number };

  return json({ data: results || [], total: countResult?.total || 0 });
}

export async function handleLogConsent(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as {
    lead_id: string; consent_type: string; granted: boolean;
  };

  if (!body.lead_id || !body.consent_type) {
    return json({ error: 'lead_id et consent_type requis' }, 400);
  }

  const allowedTypes = ['marketing_email', 'marketing_sms', 'data_processing', 'cookies', 'third_party_sharing'];
  if (!allowedTypes.includes(body.consent_type)) {
    return json({ error: `consent_type invalide. Valeurs possibles : ${allowedTypes.join(', ')}` }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || '';

  await env.DB.prepare(
    "INSERT INTO consent_log (id, lead_id, consent_type, granted, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), body.lead_id, body.consent_type, body.granted ? 1 : 0, ip, ua).run();

  await audit(env, auth.userId, 'consent.log', 'lead', body.lead_id, {
    consent_type: body.consent_type, granted: body.granted,
  });

  return json({ data: { success: true } });
}

export async function handleGetConsent(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const leadId = url.searchParams.get('lead_id');
  if (!leadId) return json({ error: 'lead_id requis en paramètre' }, 400);

  const { results } = await env.DB.prepare(
    'SELECT * FROM consent_log WHERE lead_id = ? ORDER BY granted_at DESC'
  ).bind(leadId).all();

  return json({ data: results || [] });
}

export async function handleForgetLead(
  env: Env, auth: { userId: string; role: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const lead = await env.DB.prepare('SELECT id, email FROM leads WHERE id = ?').bind(leadId).first() as { id: string; email: string } | null;
  if (!lead) return json({ error: 'Lead non trouvé' }, 404);

  await env.DB.prepare(
    "UPDATE leads SET name = '[SUPPRIMÉ]', email = '[SUPPRIMÉ]', phone = '[SUPPRIMÉ]', message = '[SUPPRIMÉ]', address = '', budget = '', timeline = '', updated_at = datetime('now') WHERE id = ?"
  ).bind(leadId).run();

  await env.DB.prepare('DELETE FROM messages WHERE lead_id = ?').bind(leadId).run();
  await env.DB.prepare('DELETE FROM consent_log WHERE lead_id = ?').bind(leadId).run();

  await audit(env, auth.userId, 'lead.forget', 'lead', leadId, {
    original_email: lead.email, reason: 'Droit à l\'oubli Loi 25',
  });

  return json({ data: { success: true, anonymized: true } });
}

export async function handleExportPii(
  env: Env, auth: { userId: string; role: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return json({ error: 'Lead non trouvé' }, 404);

  const { results: messages } = await env.DB.prepare(
    'SELECT * FROM messages WHERE lead_id = ? ORDER BY sent_at DESC'
  ).bind(leadId).all();

  const { results: consents } = await env.DB.prepare(
    'SELECT * FROM consent_log WHERE lead_id = ? ORDER BY granted_at DESC'
  ).bind(leadId).all();

  const { results: activities } = await env.DB.prepare(
    'SELECT * FROM activity_log WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(leadId).all();

  await audit(env, auth.userId, 'lead.export_pii', 'lead', leadId);

  return json({
    data: {
      lead,
      messages: messages || [],
      consents: consents || [],
      activities: activities || [],
      exported_at: new Date().toISOString(),
      purpose: 'Export de données personnelles — Loi 25 sur la protection des renseignements personnels (Québec)',
    },
  });
}
