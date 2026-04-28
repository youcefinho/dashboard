// ── Worker API — Intralys CRM Central ───────────────────────
// Routes API + assets statiques servis par Cloudflare

import { Resend } from 'resend';

// ── Types Worker ────────────────────────────────────────────

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  RESEND_API_KEY: string;
  WEBHOOK_SECRET: string;
  NOTIFICATION_EMAIL: string;
}

// ── Constantes ──────────────────────────────────────────────

const SESSION_DURATION_HOURS = 24;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_HOURS = 1;

// ── Sanitisation ────────────────────────────────────────────

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeInput(str: string | undefined | null, maxLen = 500): string {
  if (!str) return '';
  return str.trim().slice(0, maxLen);
}

// ── CORS Headers ────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Client-Id',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── Auth helpers ────────────────────────────────────────────

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  return token.length >= 10 ? token : null;
}

async function validateSession(token: string, env: Env): Promise<{ valid: boolean; userId?: string; role?: string }> {
  const { results } = await env.DB.prepare(
    "SELECT user_id, role FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).all();
  if (!results || results.length === 0) return { valid: false };
  const session = results[0] as { user_id: string; role: string };
  return { valid: true, userId: session.user_id, role: session.role };
}

async function requireAuth(request: Request, env: Env): Promise<Response | { userId: string; role: string }> {
  const token = extractToken(request);
  if (!token) return json({ error: 'Non autorisé' }, 401);

  const session = await validateSession(token, env);
  if (!session.valid || !session.userId || !session.role) {
    return json({ error: 'Session expirée ou invalide' }, 401);
  }
  return { userId: session.userId, role: session.role };
}

// ── Router principal ────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Routage API
    if (url.pathname.startsWith('/api/')) {
      try {
        return await routeApi(request, env, url);
      } catch (err) {
        console.error('Erreur API non gérée:', err);
        return json({ error: 'Erreur serveur interne' }, 500);
      }
    }

    // Assets statiques servis automatiquement par Cloudflare
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ── Routeur API ─────────────────────────────────────────────

async function routeApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ── Webhook (pas d'auth token, mais secret webhook) ─────
  if (path === '/api/webhook/lead' && method === 'POST') {
    return handleWebhookLead(request, env);
  }

  // ── Auth ────────────────────────────────────────────────
  if (path === '/api/auth/login' && method === 'POST') {
    return handleLogin(request, env);
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    return handleLogout(request, env);
  }
  if (path === '/api/auth/me' && method === 'GET') {
    return handleMe(request, env);
  }

  // ── Routes protégées ───────────────────────────────────
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  // Dashboard
  if (path === '/api/dashboard/stats' && method === 'GET') {
    return handleDashboardStats(env, auth);
  }

  // Clients
  if (path === '/api/clients' && method === 'GET') {
    return handleGetClients(env, auth);
  }
  if (path === '/api/clients' && method === 'POST') {
    return handleCreateClient(request, env, auth);
  }

  // Leads d'un client
  const clientLeadsMatch = path.match(/^\/api\/clients\/([^/]+)\/leads$/);
  if (clientLeadsMatch && method === 'GET') {
    return handleGetClientLeads(env, auth, clientLeadsMatch[1] as string, url);
  }

  // Tous les leads
  if (path === '/api/leads' && method === 'GET') {
    return handleGetLeads(env, auth, url);
  }

  // Modifier un lead
  const leadPatchMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadPatchMatch && method === 'PATCH') {
    return handlePatchLead(request, env, auth, leadPatchMatch[1] as string);
  }

  // Pipeline
  if (path === '/api/pipeline' && method === 'GET') {
    return handleGetPipeline(env, auth);
  }

  return json({ error: 'Route non trouvée' }, 404);
}

// ── POST /api/webhook/lead ──────────────────────────────────

async function handleWebhookLead(request: Request, env: Env): Promise<Response> {
  // Vérifier le secret webhook
  const secret = request.headers.get('X-Webhook-Secret');
  if (!secret || secret !== env.WEBHOOK_SECRET) {
    return json({ error: 'Secret webhook invalide' }, 403);
  }

  const clientId = request.headers.get('X-Client-Id');
  if (!clientId) {
    return json({ error: 'X-Client-Id manquant' }, 400);
  }

  // Vérifier que le client existe
  const { results: clientCheck } = await env.DB.prepare(
    'SELECT id, email, name FROM clients WHERE id = ? AND is_active = 1'
  ).bind(clientId).all();

  if (!clientCheck || clientCheck.length === 0) {
    return json({ error: 'Client non trouvé ou inactif' }, 404);
  }

  const client = clientCheck[0] as { id: string; email: string; name: string };

  const body = await request.json() as Record<string, unknown>;

  const externalId = sanitizeInput(body.external_id as string, 100);
  const name = sanitizeInput(body.name as string, 100);
  const email = sanitizeInput(body.email as string, 200);
  const phone = sanitizeInput(body.phone as string, 30);
  const message = sanitizeInput(body.message as string, 1000);
  const rawType = body.type as string;
  const type = rawType === 'sell' ? 'sell' : 'buy';
  const budget = sanitizeInput(body.budget as string, 100);
  const timeline = sanitizeInput(body.timeline as string, 100);
  const address = sanitizeInput(body.address as string, 300);
  const propertyType = sanitizeInput(body.property_type as string, 100);

  if (!name || !email) {
    return json({ error: 'Nom et email requis' }, 400);
  }

  // Dédoublonnage par external_id
  if (externalId) {
    const { results: existing } = await env.DB.prepare(
      'SELECT id FROM leads WHERE external_id = ? AND client_id = ?'
    ).bind(externalId, clientId).all();

    if (existing && existing.length > 0) {
      return json({ success: true, id: (existing[0] as { id: string }).id, deduplicated: true });
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads (id, client_id, external_id, name, email, phone, message, type, status, budget, timeline, address, property_type, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 'website')`
  ).bind(id, clientId, externalId, name, email, phone, message, type, budget, timeline, address, propertyType).run();

  // Notification email (best-effort)
  try {
    if (env.RESEND_API_KEY && env.NOTIFICATION_EMAIL) {
      const resend = new Resend(env.RESEND_API_KEY);
      const typeLabel = type === 'buy' ? 'Acheteur' : 'Vendeur';

      // Envoyer au courtier + Rochdi
      const recipients = [env.NOTIFICATION_EMAIL];
      if (client.email && client.email !== env.NOTIFICATION_EMAIL) {
        recipients.push(client.email);
      }

      await resend.emails.send({
        from: 'Intralys CRM <notifications@intralys.com>',
        to: recipients,
        subject: `🔔 Nouveau lead ${typeLabel} — ${sanitizeHtml(name)} (${sanitizeHtml(client.name)})`,
        html: `
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;border:1px solid #e0e0e0;border-radius:12px;">
            <h2 style="color:#10b981;margin:0 0 16px;">Nouveau lead ${typeLabel}</h2>
            <p style="color:#666;margin:0 0 16px;">Client : <strong>${sanitizeHtml(client.name)}</strong></p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#666;width:100px;">Nom</td><td style="padding:8px 0;font-weight:bold;">${sanitizeHtml(name)}</td></tr>
              <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}" style="color:#10b981;">${sanitizeHtml(email)}</a></td></tr>
              ${phone ? `<tr><td style="padding:8px 0;color:#666;">Tél</td><td style="padding:8px 0;"><a href="tel:${phone}" style="color:#10b981;">${sanitizeHtml(phone)}</a></td></tr>` : ''}
              ${message ? `<tr><td style="padding:8px 0;color:#666;">Message</td><td style="padding:8px 0;">${sanitizeHtml(message)}</td></tr>` : ''}
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#999;">Reçu le ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}</p>
          </div>
        `,
      });
    }
  } catch (emailErr) {
    console.warn('Échec notification email:', emailErr);
  }

  return json({ success: true, id });
}

// ── POST /api/auth/login ────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limiting
  const windowStart = new Date(Date.now() - LOGIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { results: attempts } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
  ).bind(ip, windowStart).all();

  const attemptCount = (attempts?.[0] as { count: number } | undefined)?.count || 0;
  if (attemptCount >= MAX_LOGIN_ATTEMPTS) {
    return json({ error: 'Trop de tentatives. Réessayez dans 1 heure.' }, 429);
  }

  const body = await request.json() as { email?: string; password?: string };
  const email = sanitizeInput(body.email, 200);
  const password = body.password || '';

  // Enregistrer la tentative
  await env.DB.prepare(
    "INSERT INTO login_attempts (ip, attempted_at) VALUES (?, datetime('now'))"
  ).bind(ip).run();

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400);
  }

  // Vérifier l'admin par mot de passe global (MVP)
  // En Phase 3, on passera au hash par utilisateur
  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Identifiants incorrects' }, 401);
  }

  // Chercher l'utilisateur par email
  const { results: users } = await env.DB.prepare(
    'SELECT id, name, role, client_id FROM users WHERE email = ? AND is_active = 1'
  ).bind(email).all();

  let userId: string;
  let role: string;
  let userName: string;

  if (users && users.length > 0) {
    const user = users[0] as { id: string; name: string; role: string; client_id: string | null };
    userId = user.id;
    role = user.role;
    userName = user.name;
  } else {
    // Créer un utilisateur admin par défaut si aucun n'existe
    userId = crypto.randomUUID();
    role = 'admin';
    userName = 'Rochdi';
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, 'managed', ?, 'admin')"
    ).bind(userId, email, userName).run();
  }

  // Générer le token de session
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), ?)"
  ).bind(token, userId, role, expiresAt).run();

  // Nettoyage sessions/tentatives expirées (best-effort)
  try {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
    const cleanupWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cleanupWindow).run();
  } catch {
    // Nettoyage non critique
  }

  return json({ success: true, token, user: { id: userId, name: userName, role, email } });
}

// ── POST /api/auth/logout ───────────────────────────────────

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
  }
  return json({ success: true });
}

// ── GET /api/auth/me ────────────────────────────────────────

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    'SELECT id, email, name, role, client_id FROM users WHERE id = ?'
  ).bind(auth.userId).all();

  if (!results || results.length === 0) {
    return json({ error: 'Utilisateur non trouvé' }, 404);
  }

  return json({ data: results[0] });
}

// ── GET /api/dashboard/stats ────────────────────────────────

async function handleDashboardStats(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  // Total leads
  const totalResult = await env.DB.prepare('SELECT COUNT(*) as count FROM leads').all();
  const totalLeads = (totalResult.results?.[0] as { count: number } | undefined)?.count || 0;

  // Nouveaux (7 jours)
  const newResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE created_at > datetime('now', '-7 days')"
  ).all();
  const newLeads7d = (newResult.results?.[0] as { count: number } | undefined)?.count || 0;

  // En attente (new + contacted)
  const pendingResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE status IN ('new', 'contacted')"
  ).all();
  const pendingLeads = (pendingResult.results?.[0] as { count: number } | undefined)?.count || 0;

  // Taux de conversion (signés / total)
  const signedResult = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM leads WHERE status = 'signed'"
  ).all();
  const signedLeads = (signedResult.results?.[0] as { count: number } | undefined)?.count || 0;
  const conversionRate = totalLeads > 0 ? Math.round((signedLeads / totalLeads) * 100) : 0;

  // Leads par client
  const byClientResult = await env.DB.prepare(
    `SELECT c.name as client_name, COUNT(l.id) as count
     FROM clients c LEFT JOIN leads l ON c.id = l.client_id
     WHERE c.is_active = 1
     GROUP BY c.id ORDER BY count DESC`
  ).all();

  // Leads par statut
  const byStatusResult = await env.DB.prepare(
    'SELECT status, COUNT(*) as count FROM leads GROUP BY status'
  ).all();

  // Leads par jour (30 derniers jours)
  const byDayResult = await env.DB.prepare(
    `SELECT date(created_at) as date, COUNT(*) as count
     FROM leads WHERE created_at > datetime('now', '-30 days')
     GROUP BY date(created_at) ORDER BY date ASC`
  ).all();

  return json({
    data: {
      total_leads: totalLeads,
      new_leads_7d: newLeads7d,
      pending_leads: pendingLeads,
      conversion_rate: conversionRate,
      leads_by_client: byClientResult.results || [],
      leads_by_status: byStatusResult.results || [],
      leads_by_day: byDayResult.results || [],
    },
  });
}

// ── GET /api/clients ────────────────────────────────────────

async function handleGetClients(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT c.*, COUNT(l.id) as lead_count,
     SUM(CASE WHEN l.status = 'new' THEN 1 ELSE 0 END) as new_lead_count
     FROM clients c LEFT JOIN leads l ON c.id = l.client_id
     GROUP BY c.id ORDER BY c.created_at DESC`
  ).all();

  return json({ data: results || [] });
}

// ── POST /api/clients ───────────────────────────────────────

async function handleCreateClient(request: Request, env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const email = sanitizeInput(body.email as string, 200);
  const phone = sanitizeInput(body.phone as string, 30);
  const siteUrl = sanitizeInput(body.site_url as string, 300);
  const city = sanitizeInput(body.city as string, 100);
  const banner = sanitizeInput(body.banner as string, 100);

  if (!name || !email) {
    return json({ error: 'Nom et email requis' }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO clients (id, name, email, phone, site_url, city, banner)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, phone, siteUrl, city, banner).run();

  return json({ success: true, id }, 201);
}

// ── GET /api/clients/:id/leads ──────────────────────────────

async function handleGetClientLeads(
  env: Env, auth: { role: string; userId: string }, clientId: string, url: URL
): Promise<Response> {
  // Les courtiers ne voient que leurs propres leads
  if (auth.role === 'broker') {
    const { results: userCheck } = await env.DB.prepare(
      'SELECT client_id FROM users WHERE id = ?'
    ).bind(auth.userId).all();
    const userClientId = (userCheck?.[0] as { client_id: string } | undefined)?.client_id;
    if (userClientId !== clientId) {
      return json({ error: 'Accès non autorisé' }, 403);
    }
  }

  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const search = url.searchParams.get('search');

  let query = 'SELECT * FROM leads WHERE client_id = ?';
  const params: string[] = [clientId];

  if (status && ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (type && ['buy', 'sell'].includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all();

  return json({ data: results || [] });
}

// ── GET /api/leads ──────────────────────────────────────────

async function handleGetLeads(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: string[] = [];

  if (status && ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(status)) {
    query += ' AND l.status = ?';
    params.push(status);
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  query += ' ORDER BY l.created_at DESC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

// ── PATCH /api/leads/:id ────────────────────────────────────

async function handlePatchLead(
  request: Request, env: Env, auth: { role: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;

  const updates: string[] = [];
  const params: string[] = [];

  // Seuls certains champs sont modifiables
  if (body.status !== undefined) {
    const status = body.status as string;
    if (!['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(status)) {
      return json({ error: 'Statut invalide' }, 400);
    }
    updates.push('status = ?');
    params.push(status);
  }

  if (body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(sanitizeInput(body.notes as string, 2000));
  }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(leadId);

  await env.DB.prepare(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ success: true });
}

// ── GET /api/pipeline ───────────────────────────────────────

async function handleGetPipeline(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT l.*, c.name as client_name FROM leads l
     LEFT JOIN clients c ON l.client_id = c.id
     WHERE l.status NOT IN ('closed', 'lost')
     ORDER BY l.created_at DESC`
  ).all();

  return json({ data: results || [] });
}
