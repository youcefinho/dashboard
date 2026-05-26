// ── Module Dashboard — Intralys CRM ─────────────────────────
import type { Env } from './types';
import { sanitizeInput, json, audit, sendSms, corsHeaders } from './helpers';
import { verifyPassword, base32Encode, verifyTotp } from './crypto';
import { isUnsubscribed } from './compliance';
// Renforcement P3 (2026-05-26) — helpers PURS pour widgets/layouts/periodes.
// Additif strict — réutilisable par dashboards.ts (builder) et tout endpoint
// futur de validation de layout/widget côté worker.
import {
  validateWidgetConfig as _validateWidgetConfig,
  validateDashboardLayout as _validateDashboardLayout,
  validateWidgetPosition as _validateWidgetPosition,
  computePeriod as _computePeriod,
  VALID_WIDGET_TYPES as _VALID_WIDGET_TYPES,
  VALID_PERIOD_SELECTORS as _VALID_PERIOD_SELECTORS,
} from './lib/dashboard-engine';
void _validateWidgetConfig;
void _validateDashboardLayout;
void _validateWidgetPosition;
void _computePeriod;
void _VALID_WIDGET_TYPES;
void _VALID_PERIOD_SELECTORS;

// ── Dashboard Stats ─────────────────────────────────────────

export async function handleDashboardStats(env: Env, auth: { role: string; userId: string }): Promise<Response> {
  let condition = '';
  const params: string[] = [];
  
  if (auth.role !== 'admin') {
    const user = await env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(auth.userId).first() as { client_id: string } | null;
    if (user?.client_id) {
      condition = 'WHERE client_id = ?';
      params.push(user.client_id);
    } else {
      condition = 'WHERE 1=0'; // No client_id, no data
    }
  }

  const totalResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM leads ${condition}`).bind(...params).all();
  const totalLeads = (totalResult.results?.[0] as { count: number } | undefined)?.count || 0;
  
  const newResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM leads ${condition ? condition + ' AND' : 'WHERE'} created_at > datetime('now', '-7 days')`).bind(...params).all();
  const newLeads7d = (newResult.results?.[0] as { count: number } | undefined)?.count || 0;
  
  const pendingResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM leads ${condition ? condition + ' AND' : 'WHERE'} status IN ('new', 'contacted', 'meeting')`).bind(...params).all();
  const pendingLeads = (pendingResult.results?.[0] as { count: number } | undefined)?.count || 0;
  
  const signedResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM leads ${condition ? condition + ' AND' : 'WHERE'} status = 'won'`).bind(...params).all();
  const signedLeads = (signedResult.results?.[0] as { count: number } | undefined)?.count || 0;
  const conversionRate = totalLeads > 0 ? Math.round((signedLeads / totalLeads) * 100) : 0;
  
  // Pipeline Value (deals that are not won or lost)
  const pipelineResult = await env.DB.prepare(`SELECT SUM(deal_value) as value FROM leads ${condition ? condition + ' AND' : 'WHERE'} status NOT IN ('won', 'lost')`).bind(...params).all();
  const pipelineValue = (pipelineResult.results?.[0] as { value: number } | undefined)?.value || 0;

  // Revenue (won deals)
  const revenueResult = await env.DB.prepare(`SELECT SUM(deal_value) as value FROM leads ${condition ? condition + ' AND' : 'WHERE'} status = 'won'`).bind(...params).all();
  const revenueValue = (revenueResult.results?.[0] as { value: number } | undefined)?.value || 0;

  const byClientResult = await env.DB.prepare(`SELECT c.name as client_name, COUNT(l.id) as count FROM clients c LEFT JOIN leads l ON c.id = l.client_id WHERE c.is_active = 1 GROUP BY c.id ORDER BY count DESC`).all();
  
  const byStatusResult = await env.DB.prepare(`SELECT status, COUNT(*) as count FROM leads ${condition} GROUP BY status`).bind(...params).all();
  
  const byDayResult = await env.DB.prepare(`SELECT date(created_at) as date, COUNT(*) as count FROM leads ${condition ? condition + ' AND' : 'WHERE'} created_at > datetime('now', '-30 days') GROUP BY date(created_at) ORDER BY date ASC`).bind(...params).all();
  
  const bySourceResult = await env.DB.prepare(`SELECT source, COUNT(*) as count, SUM(deal_value) as value FROM leads ${condition} GROUP BY source ORDER BY count DESC LIMIT 5`).bind(...params).all();

  // Activity Feed
  let activityQuery = `SELECT a.*, u.name as user_name FROM activity_log a LEFT JOIN users u ON a.user_id = u.id`;
  if (condition) activityQuery += ` ${condition.replace('client_id', 'a.client_id')}`;
  activityQuery += ` ORDER BY a.created_at DESC LIMIT 15`;
  const activityResult = await env.DB.prepare(activityQuery).bind(...params).all();

  return json({ 
    data: { 
      total_leads: totalLeads, 
      new_leads_7d: newLeads7d, 
      pending_leads: pendingLeads, 
      conversion_rate: conversionRate, 
      total_deal_value: pipelineValue,
      revenue_value: revenueValue,
      avg_conversion_days: 0, 
      leads_by_client: byClientResult.results || [], 
      leads_by_status: byStatusResult.results || [], 
      leads_by_day: byDayResult.results || [], 
      leads_by_source: bySourceResult.results || [], 
      conversion_by_status: [],
      activity_feed: activityResult.results || []
    } 
  });
}

// ── Clients CRUD ────────────────────────────────────────────

export async function handleGetClients(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const { results } = await env.DB.prepare(`SELECT c.*, COUNT(l.id) as lead_count, SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) as new_lead_count FROM clients c LEFT JOIN leads l ON c.id = l.client_id GROUP BY c.id ORDER BY c.created_at DESC`).all();
  return json({ data: results || [] });
}

export async function handleCreateClient(request: Request, env: Env, auth: { role: string; userId: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const email = sanitizeInput(body.email as string, 200);
  const phone = sanitizeInput(body.phone as string, 30);
  const siteUrl = sanitizeInput(body.site_url as string, 300);
  const city = sanitizeInput(body.city as string, 100);
  const banner = sanitizeInput(body.banner as string, 100);
  if (!name || !email) return json({ error: 'Nom et email requis' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO clients (id, name, email, phone, site_url, city, banner) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, name, email, phone, siteUrl, city, banner).run();
  await audit(env, auth.userId, 'client.create', 'client', id, { name, email });
  return json({ success: true, id }, 201);
}

// ── 2FA TOTP ────────────────────────────────────────────────

export async function handleTotpSetup(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const secretBytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(secretBytes);
  await env.DB.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").bind(secret, auth.userId).run();
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(auth.userId).first() as { email: string } | null;
  const email = user?.email || 'admin';
  const otpauthUrl = `otpauth://totp/Intralys:${encodeURIComponent(email)}?secret=${secret}&issuer=Intralys&algorithm=SHA1&digits=6&period=30`;
  await audit(env, auth.userId, 'totp.setup', 'user', auth.userId);
  return json({ data: { secret, otpauth_url: otpauthUrl } });
}

export async function handleTotpVerify(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as { token?: string };
  if (!body.token || body.token.length !== 6) return json({ error: 'Code TOTP à 6 chiffres requis' }, 400);
  const user = await env.DB.prepare('SELECT totp_secret FROM users WHERE id = ?').bind(auth.userId).first() as { totp_secret: string } | null;
  if (!user?.totp_secret) return json({ error: 'TOTP non configuré' }, 400);
  const valid = await verifyTotp(user.totp_secret, body.token);
  if (!valid) return json({ error: 'Code invalide' }, 401);
  await env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").bind(auth.userId).run();
  await audit(env, auth.userId, 'totp.enable', 'user', auth.userId);
  return json({ data: { enabled: true } });
}

export async function handleTotpDisable(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as { token?: string; password?: string };
  const user = await env.DB.prepare('SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = ?').bind(auth.userId).first() as { password_hash: string; totp_secret: string; totp_enabled: number } | null;
  if (!user || !user.totp_enabled) return json({ error: '2FA non activé' }, 400);
  if (body.password) { const ok = await verifyPassword(body.password, user.password_hash); if (!ok) return json({ error: 'Mot de passe incorrect' }, 401); }
  else if (body.token) { const ok = await verifyTotp(user.totp_secret, body.token); if (!ok) return json({ error: 'Code TOTP invalide' }, 401); }
  else return json({ error: 'Mot de passe ou code TOTP requis' }, 400);
  await env.DB.prepare("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?").bind(auth.userId).run();
  await audit(env, auth.userId, 'totp.disable', 'user', auth.userId);
  return json({ data: { enabled: false } });
}

// ── SMS envoi direct ────────────────────────────────────────

export async function handleSendSmsRoute(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { lead_id?: string; to?: string; message?: string };
  if (!body.message || body.message.length < 1) return json({ error: 'Message requis' }, 400);
  let to = body.to || ''; let leadId = body.lead_id || ''; let clientId = '';
  if (leadId) {
    const lead = await env.DB.prepare('SELECT phone, client_id FROM leads WHERE id = ?').bind(leadId).first() as { phone: string; client_id: string } | null;
    if (!lead || !lead.phone) return json({ error: 'Lead introuvable ou sans téléphone' }, 404);
    to = lead.phone; clientId = lead.client_id;
  }
  if (!to) return json({ error: 'Numéro requis' }, 400);
  // Conformité CASL/Loi 25 — refuser l'envoi à un numéro désabonné SMS (opt-out STOP).
  if (await isUnsubscribed(env, '', to, 'sms')) return json({ error: 'Numéro désabonné (SMS)' }, 403);
  const result = await sendSms(env, to, sanitizeInput(body.message, 1600));
  if (!result.success) return json({ error: result.error || 'Échec envoi SMS' }, 500);
  const msgId = crypto.randomUUID();
  if (leadId) { await env.DB.prepare(`INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id) VALUES (?, ?, ?, 'outbound', 'sms', ?, 'sent', ?, ?)`).bind(msgId, leadId, clientId, sanitizeInput(body.message, 1600), auth.userId, result.sid || '').run(); }
  await audit(env, auth.userId, 'sms.send', 'message', msgId, { to, lead_id: leadId });
  return json({ data: { success: true, sid: result.sid } });
}

// ── Bulk CSV Import ─────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inQuotes) { if (char === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (char === '"') { inQuotes = false; } else { current += char; } }
    else { if (char === '"') { inQuotes = true; } else if (char === ',' || char === ';') { result.push(current.trim()); current = ''; } else { current += char; } }
  }
  result.push(current.trim()); return result;
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const n = ['name', 'nom', 'full_name']; const e = ['email', 'courriel', 'mail']; const p = ['phone', 'telephone', 'tel', 'cell', 'mobile']; const t = ['type', 'projet']; const s = ['source', 'origine']; const m = ['message', 'note', 'notes'];
  for (const h of headers) { if (n.includes(h)) mapping.name = h; if (e.includes(h)) mapping.email = h; if (p.includes(h)) mapping.phone = h; if (t.includes(h)) mapping.type = h; if (s.includes(h)) mapping.source = h; if (m.includes(h)) mapping.message = h; }
  return mapping;
}

export async function handleCsvImport(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as { client_id?: string; csv_data?: string; field_mapping?: Record<string, string> };
  if (!body.client_id || !body.csv_data) return json({ error: 'client_id et csv_data requis' }, 400);
  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ? AND is_active = 1').bind(body.client_id).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);
  const lines = body.csv_data.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return json({ error: 'CSV: au moins un en-tête + une ligne' }, 400);
  const headers = parseCsvLine(lines[0]!).map(h => h.toLowerCase().trim());
  const mapping = body.field_mapping || autoDetectMapping(headers);
  const results = { total: 0, imported: 0, skipped: 0, errors: [] as Array<{ line: number; error: string }> };
  for (let i = 1; i < lines.length; i++) {
    results.total++;
    try {
      const values = parseCsvLine(lines[i]!);
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => { if (values[idx] !== undefined) record[h] = values[idx]!; });
      const name = sanitizeInput(record[mapping.name || 'name'] || record[mapping.nom || 'nom'] || '', 100);
      const email = sanitizeInput(record[mapping.email || 'email'] || '', 200).toLowerCase();
      const phone = sanitizeInput(record[mapping.phone || 'phone'] || '', 30);
      if (!name && !email) { results.skipped++; results.errors.push({ line: i + 1, error: 'Nom et email vides' }); continue; }
      if (email) { const existing = await env.DB.prepare('SELECT id FROM leads WHERE LOWER(email) = ? AND client_id = ?').bind(email, body.client_id).first(); if (existing) { results.skipped++; results.errors.push({ line: i + 1, error: `Email "${email}" déjà existant` }); continue; } }
      const id = crypto.randomUUID();
      const type = sanitizeInput(record[mapping.type || 'type'] || '', 10);
      const source = sanitizeInput(record[mapping.source || 'source'] || 'csv_import', 50);
      const message = sanitizeInput(record[mapping.message || 'message'] || '', 2000);
      await env.DB.prepare(`INSERT INTO leads (id, client_id, name, email, phone, type, source, message, status, pipeline_id, stage_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'pipeline-default', 'stage-new')`).bind(id, body.client_id, name, email, phone, ['inbound', 'customer'].includes(type) ? type : 'inbound', source, message).run();
      results.imported++;
    } catch (err) { results.errors.push({ line: i + 1, error: String(err) }); }
  }
  await audit(env, auth.userId, 'leads.csv_import', 'client', body.client_id, { total: results.total, imported: results.imported, skipped: results.skipped });
  return json({ data: results });
}

// ── Export CSV ───────────────────────────────────────────────

export async function handleExportCsv(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const status = url.searchParams.get('status'); const clientId = url.searchParams.get('client_id');
  let query = `SELECT l.*, c.name as client_name FROM leads l LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: string[] = [];
  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (clientId) { query += ' AND l.client_id = ?'; params.push(clientId); }
  query += ' ORDER BY l.created_at DESC';
  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const leads = (results || []) as Record<string, unknown>[];
  const hdrs = ['Nom', 'Email', 'Téléphone', 'Type', 'Statut', 'Client', 'Source', 'Budget', 'Valeur', 'Message', 'Date'];
  const rows = leads.map(l => [l.name, l.email, l.phone, l.type, l.status, l.client_name || l.client_id, l.source, l.budget, l.deal_value ?? 0, l.message, l.created_at].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [hdrs.join(','), ...rows].join('\n');
  return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-intralys-${new Date().toISOString().slice(0, 10)}.csv"`, ...corsHeaders() } });
}
