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
  ALLOWED_ORIGINS: string;
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

// ── Password hashing (PBKDF2-SHA256, 210k iterations OWASP 2023) ─────

const PBKDF2_ITERATIONS = 210_000;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltB64, hashB64] = stored.split('$');
  if (!iterStr || !saltB64 || !hashB64) return false;
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: parseInt(iterStr), hash: 'SHA-256' },
    key, 256
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  // Comparaison à temps constant
  if (computed.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i);
  }
  return diff === 0;
}

// ── Request context (stocké au début de fetch, utilisé partout) ─────
let _currentRequest: Request | null = null;
let _currentEnv: Env | null = null;

function corsHeaders(): Record<string, string> {
  if (_currentRequest && _currentEnv) {
    const origin = _currentRequest.headers.get('Origin') || '';
    const allowed = (_currentEnv.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // Dev local : si ALLOWED_ORIGINS vide ou contient localhost, on autorise localhost
    if (allowed.length === 0) allowed.push('http://localhost:5176', 'http://localhost:5173');
    const allowOrigin = allowed.includes(origin) ? origin : '';
    return {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Client-Id',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    };
  }
  // Fallback sécurisé — empty origin bloque les requêtes cross-origin
  return {
    'Access-Control-Allow-Origin': '',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Client-Id',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── Audit log helper (best-effort) ──────────────────────────

async function audit(
  env: Env,
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ip = _currentRequest?.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = _currentRequest?.headers.get('User-Agent') || '';
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, action, resourceType, resourceId, JSON.stringify(details), ip, ua).run();
  } catch { /* non critique — ne jamais bloquer l'action principale */ }
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
    // Stocker le contexte pour corsHeaders()/json() automatiques
    _currentRequest = request;
    _currentEnv = env;

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

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processWorkflowQueue(env));
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
  if (path === '/api/auth/change-password' && method === 'POST') {
    return handleChangePassword(request, env);
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

  // Export CSV
  if (path === '/api/leads/export' && method === 'GET') {
    return handleExportCsv(env, auth, url);
  }

  // Détail d'un lead
  const leadGetMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadGetMatch && method === 'GET') {
    return handleGetLeadDetail(env, auth, leadGetMatch[1] as string);
  }

  // Modifier un lead
  const leadPatchMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadPatchMatch && method === 'PATCH') {
    return handlePatchLead(request, env, auth, leadPatchMatch[1] as string);
  }

  // Tags d'un lead
  const tagsMatch = path.match(/^\/api\/leads\/([^/]+)\/tags$/);
  if (tagsMatch && method === 'POST') {
    return handleAddTag(request, env, auth, tagsMatch[1] as string);
  }
  if (tagsMatch && method === 'DELETE') {
    return handleRemoveTag(request, env, auth, tagsMatch[1] as string);
  }

  // Tous les tags existants
  if (path === '/api/tags' && method === 'GET') {
    return handleGetAllTags(env, auth);
  }

  // Activité récente
  if (path === '/api/activity' && method === 'GET') {
    return handleGetActivity(env, auth, url);
  }

  // Pipeline
  if (path === '/api/pipeline' && method === 'GET') {
    return handleGetPipeline(env, auth);
  }

  // ── Phase 2 : Messages & Conversations ──────────────────
  const leadMsgMatch = path.match(/^\/api\/leads\/([^/]+)\/messages$/);
  if (leadMsgMatch && method === 'GET') {
    return handleGetLeadMessages(env, auth, leadMsgMatch[1] as string);
  }
  if (leadMsgMatch && method === 'POST') {
    return handleSendMessage(request, env, auth, leadMsgMatch[1] as string);
  }

  // Inbox — tous les messages récents
  if (path === '/api/messages' && method === 'GET') {
    return handleGetInboxMessages(env, auth, url);
  }

  // ── Phase 2 : Templates d'emails ────────────────────────
  if (path === '/api/templates' && method === 'GET') {
    return handleGetTemplates(env, auth, url);
  }
  if (path === '/api/templates' && method === 'POST') {
    return handleCreateTemplate(request, env, auth);
  }
  const tplMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (tplMatch && method === 'PATCH') {
    return handleUpdateTemplate(request, env, auth, tplMatch[1] as string);
  }
  if (tplMatch && method === 'DELETE') {
    return handleDeleteTemplate(env, auth, tplMatch[1] as string);
  }

  // ── Phase 3 : Workflows & Automations ───────────────────
  if (path === '/api/workflows' && method === 'GET') {
    return handleGetWorkflows(env, auth);
  }
  if (path === '/api/workflows' && method === 'POST') {
    return handleCreateWorkflow(request, env, auth);
  }
  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch && method === 'GET') {
    return handleGetWorkflowDetail(env, auth, wfMatch[1] as string);
  }
  if (wfMatch && method === 'PATCH') {
    return handleUpdateWorkflow(request, env, auth, wfMatch[1] as string);
  }
  if (wfMatch && method === 'DELETE') {
    return handleDeleteWorkflow(env, auth, wfMatch[1] as string);
  }
  const wfToggleMatch = path.match(/^\/api\/workflows\/([^/]+)\/toggle$/);
  if (wfToggleMatch && method === 'POST') {
    return handleToggleWorkflow(request, env, auth, wfToggleMatch[1] as string);
  }
  const wfEnrollMatch = path.match(/^\/api\/workflows\/([^/]+)\/enroll$/);
  if (wfEnrollMatch && method === 'POST') {
    return handleEnrollLead(request, env, auth, wfEnrollMatch[1] as string);
  }

  // ── Phase 4 : Calendrier & RDV ──────────────────────────
  if (path === '/api/appointments' && method === 'GET') {
    return handleGetAppointments(env, auth, url);
  }
  if (path === '/api/appointments' && method === 'POST') {
    return handleCreateAppointment(request, env, auth);
  }
  const apptMatch = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (apptMatch && method === 'PATCH') {
    return handleUpdateAppointment(request, env, auth, apptMatch[1] as string);
  }
  if (apptMatch && method === 'DELETE') {
    return handleDeleteAppointment(env, auth, apptMatch[1] as string);
  }

  // ── Phase 5 : Tasks ─────────────────────────────────────
  if (path === '/api/tasks' && method === 'GET') return handleGetTasks(env, auth, url);
  if (path === '/api/tasks' && method === 'POST') return handleCreateTask(request, env, auth);
  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') return handlePatchTask(request, env, auth, taskMatch[1] as string);
  if (taskMatch && method === 'DELETE') return handleDeleteTask(env, auth, taskMatch[1] as string);

  // ── Notifications ───────────────────────────────────────
  if (path === '/api/notifications' && method === 'GET') return handleGetNotifications(env, auth, url);
  if (path === '/api/notifications/read-all' && method === 'POST') return handleReadAllNotifications(env, auth);
  const notifMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notifMatch && method === 'PATCH') return handleReadNotification(env, auth, notifMatch[1] as string);

  // ── Debug (à retirer avant prod) ────────────────────────
  if (path === '/api/debug/run-cron' && method === 'GET') {
    if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
    await processWorkflowQueue(env);
    return json({ data: { executed: true, timestamp: new Date().toISOString() } });
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

  // Auto-enroll dans les workflows actifs avec trigger 'lead_created'
  try {
    const { results: triggers } = await env.DB.prepare(
      "SELECT id FROM workflows WHERE is_active = 1 AND trigger_type = 'lead_created' AND (client_id IS NULL OR client_id = ?)"
    ).bind(clientId).all();
    for (const wf of (triggers || []) as Array<{ id: string }>) {
      await autoEnroll(env, wf.id, id);
    }
  } catch { /* non critique */ }

  // Créer notification pour les admins
  try {
    const { results: admins } = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
    ).all();
    const typeLabel = type === 'buy' ? 'Acheteur' : 'Vendeur';
    for (const admin of (admins || []) as Array<{ id: string }>) {
      await createNotification(env, admin.id, `Nouveau lead ${typeLabel}`, `${name} — ${client.name}`, '🆕', `/leads/${id}`, clientId);
    }
  } catch { /* non critique */ }

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
  const email = sanitizeInput(body.email, 200).toLowerCase();
  const password = body.password || '';

  // Enregistrer la tentative
  await env.DB.prepare(
    "INSERT INTO login_attempts (ip, attempted_at) VALUES (?, datetime('now'))"
  ).bind(ip).run();

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400);
  }

  // Chercher l'utilisateur par email
  const user = await env.DB.prepare(
    'SELECT id, name, role, client_id, password_hash, is_active, must_change_password FROM users WHERE email = ?'
  ).bind(email).first() as { id: string; name: string; role: string; client_id: string | null; password_hash: string; is_active: number; must_change_password: number } | null;

  // Bootstrap : premier login crée le compte admin avec ADMIN_PASSWORD comme seed
  if (!user) {
    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: 'Identifiants incorrects' }, 401);
    }
    const userId = crypto.randomUUID();
    const hash = await hashPassword(password);
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'Rochdi', 'admin', 1)"
    ).bind(userId, email, hash).run();
    return finishLogin(env, userId, 'admin', 'Rochdi', email, true);
  }

  if (!user.is_active) return json({ error: 'Compte désactivé' }, 401);

  // Vérification PBKDF2 si le hash est présent, sinon fallback ADMIN_PASSWORD (migration)
  let passwordOk = false;
  if (user.password_hash && user.password_hash.startsWith('pbkdf2$')) {
    passwordOk = await verifyPassword(password, user.password_hash);
  } else {
    // Fallback pour les comptes créés avant la migration — vérifie ADMIN_PASSWORD
    passwordOk = password === env.ADMIN_PASSWORD;
    if (passwordOk) {
      // Migrer le hash en PBKDF2
      const hash = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, user.id).run();
    }
  }

  if (!passwordOk) return json({ error: 'Identifiants incorrects' }, 401);

  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return finishLogin(env, user.id, user.role, user.name, email, !!user.must_change_password);
}

async function finishLogin(env: Env, userId: string, role: string, name: string, email: string, mustChangePassword: boolean): Promise<Response> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), ?)"
  ).bind(token, userId, role, expiresAt).run();

  // Nettoyage best-effort
  try {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
    const cleanupWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cleanupWindow).run();
  } catch { /* non critique */ }

  await audit(env, userId, 'auth.login', 'user', userId, { email, role });
  return json({ success: true, token, must_change_password: mustChangePassword, user: { id: userId, name, role, email } });
}

// ── POST /api/auth/change-password ──────────────────────────

async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const body = await request.json() as { current?: string; next?: string };
  if (!body.current || !body.next || body.next.length < 8) {
    return json({ error: 'Mot de passe actuel + nouveau (min 8 chars) requis' }, 400);
  }
  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(auth.userId).first() as { password_hash: string } | null;
  if (!user) return json({ error: 'Utilisateur non trouvé' }, 404);

  // Vérifier l'ancien mot de passe
  let currentOk = false;
  if (user.password_hash && user.password_hash.startsWith('pbkdf2$')) {
    currentOk = await verifyPassword(body.current, user.password_hash);
  } else {
    currentOk = body.current === env.ADMIN_PASSWORD;
  }
  if (!currentOk) return json({ error: 'Mot de passe actuel incorrect' }, 401);

  const hash = await hashPassword(body.next);
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?").bind(hash, auth.userId).run();
  await audit(env, auth.userId, 'auth.change_password', 'user', auth.userId);
  return json({ success: true });
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
      total_deal_value: 0,
      avg_conversion_days: 0,
      leads_by_client: byClientResult.results || [],
      leads_by_status: byStatusResult.results || [],
      leads_by_day: byDayResult.results || [],
      leads_by_source: [],
      conversion_by_status: [],
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

  await audit(env, auth.userId, 'client.create', 'client', id, { name, email });
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
  const source = url.searchParams.get('source');
  const clientId = url.searchParams.get('client_id');
  const sort = url.searchParams.get('sort') || 'newest';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: (string | number)[] = [];

  if (status && ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(status)) {
    query += ' AND l.status = ?';
    params.push(status);
  }
  if (source) {
    query += ' AND l.source = ?';
    params.push(sanitizeInput(source, 50));
  }
  if (clientId) {
    query += ' AND l.client_id = ?';
    params.push(sanitizeInput(clientId, 100));
  }
  if (search) {
    const cleanSearch = sanitizeInput(search, 100);
    query += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
    params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
  }

  // Cursor-based pagination
  if (cursor) {
    if (sort === 'oldest') {
      query += ' AND l.created_at > ?';
    } else {
      query += ' AND l.created_at < ?';
    }
    params.push(cursor);
  }

  if (sort === 'oldest') {
    query += ' ORDER BY l.created_at ASC';
  } else if (sort === 'name') {
    query += ' ORDER BY l.name ASC';
  } else {
    query += ' ORDER BY l.created_at DESC';
  }
  query += ' LIMIT ?';
  params.push(limit + 1); // +1 pour détecter s'il y a une page suivante

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const items = (results || []) as Array<Record<string, unknown>>;

  // Déterminer le next_cursor
  let nextCursor: string | null = null;
  if (items.length > limit) {
    items.pop(); // Retirer l'élément supplémentaire
    const lastItem = items[items.length - 1];
    if (lastItem) nextCursor = lastItem.created_at as string;
  }

  return json({ data: items, next_cursor: nextCursor });
}

// ── PATCH /api/leads/:id ────────────────────────────────────

async function handlePatchLead(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number)[] = [];
  const activities: Array<{ action: string; details: string }> = [];

  if (body.status !== undefined) {
    const status = body.status as string;
    if (!['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(status)) {
      return json({ error: 'Statut invalide' }, 400);
    }
    updates.push('status = ?');
    params.push(status);
    activities.push({ action: 'status_change', details: JSON.stringify({ to: status }) });
  }

  if (body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(sanitizeInput(body.notes as string, 2000));
    activities.push({ action: 'note_added', details: '' });
  }

  if (body.deal_value !== undefined) {
    const dv = Number(body.deal_value);
    if (!isNaN(dv) && dv >= 0) {
      updates.push('deal_value = ?');
      params.push(dv);
      activities.push({ action: 'deal_value_changed', details: JSON.stringify({ value: dv }) });
    }
  }

  if (body.assigned_to !== undefined) {
    updates.push('assigned_to = ?');
    params.push(sanitizeInput(body.assigned_to as string, 100));
    activities.push({ action: 'assigned', details: JSON.stringify({ to: body.assigned_to }) });
  }

  if (body.score !== undefined) {
    const s = Number(body.score);
    if (!isNaN(s) && s >= 0 && s <= 100) {
      updates.push('score = ?');
      params.push(s);
    }
  }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(leadId);

  await env.DB.prepare(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // Logger les activités (best-effort)
  for (const act of activities) {
    try {
      await env.DB.prepare(
        "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, ?, ?)"
      ).bind(leadId, auth.userId, act.action, act.details).run();
    } catch { /* non-critique */ }
  }

  // Trigger workflows sur changement de statut
  if (body.status !== undefined) {
    try {
      const { results: wfs } = await env.DB.prepare(
        "SELECT id, trigger_config FROM workflows WHERE is_active = 1 AND trigger_type = 'status_changed'"
      ).all();
      for (const wf of (wfs || []) as Array<{ id: string; trigger_config: string }>) {
        let cfg: { to_status?: string } = {};
        try { cfg = JSON.parse(wf.trigger_config); } catch { /* */ }
        if (!cfg.to_status || cfg.to_status === body.status) {
          await autoEnroll(env, wf.id, leadId);
        }
      }
    } catch { /* non critique */ }

    // Notification pour les admins si statut important
    const importantStatuses = ['signed', 'closed'];
    if (importantStatuses.includes(body.status as string)) {
      try {
        const lead = await env.DB.prepare('SELECT name, client_id FROM leads WHERE id = ?').bind(leadId).first() as { name: string; client_id: string } | null;
        if (lead) {
          const { results: admins } = await env.DB.prepare(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
          ).all();
          const statusLabel = body.status === 'signed' ? '✍️ Signé' : '🏁 Fermé';
          for (const admin of (admins || []) as Array<{ id: string }>) {
            await createNotification(env, admin.id, `Lead ${statusLabel}`, `${lead.name} est passé à "${body.status}"`, body.status === 'signed' ? '✍️' : '🏁', `/leads/${leadId}`, lead.client_id);
          }
        }
      } catch { /* non critique */ }
    }
  }

  await audit(env, auth.userId, 'lead.update', 'lead', leadId, body as Record<string, unknown>);
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

// ── GET /api/leads/:id — Détail d'un lead ───────────────────

async function handleGetLeadDetail(env: Env, auth: { role: string }, leadId: string): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results: leadRows } = await env.DB.prepare(
    `SELECT l.*, c.name as client_name FROM leads l
     LEFT JOIN clients c ON l.client_id = c.id WHERE l.id = ?`
  ).bind(leadId).all();

  if (!leadRows || leadRows.length === 0) {
    return json({ error: 'Lead non trouvé' }, 404);
  }

  const lead = leadRows[0] as Record<string, unknown>;

  // Tags
  const { results: tagRows } = await env.DB.prepare(
    'SELECT tag FROM lead_tags WHERE lead_id = ? ORDER BY created_at DESC'
  ).bind(leadId).all();
  const tags = (tagRows || []).map((r: Record<string, unknown>) => r.tag as string);

  // Activité
  const { results: actRows } = await env.DB.prepare(
    `SELECT a.*, u.name as user_name FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.lead_id = ? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(leadId).all();

  return json({ data: { ...lead, tags, activity: actRows || [] } });
}

// ── POST /api/leads/:id/tags — Ajouter un tag ──────────────

async function handleAddTag(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { tag?: string };
  const tag = sanitizeInput(body.tag, 50);
  if (!tag) return json({ error: 'Tag requis' }, 400);

  try {
    await env.DB.prepare(
      'INSERT INTO lead_tags (lead_id, tag) VALUES (?, ?)'
    ).bind(leadId, tag.toLowerCase()).run();

    await env.DB.prepare(
      "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'tag_added', ?)"
    ).bind(leadId, auth.userId, JSON.stringify({ tag })).run();
  } catch {
    // Tag déjà existant (UNIQUE constraint) — pas grave
  }

  return json({ success: true });
}

// ── DELETE /api/leads/:id/tags — Retirer un tag ─────────────

async function handleRemoveTag(
  request: Request, env: Env, auth: { role: string; userId: string }, leadId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { tag?: string };
  const tag = sanitizeInput(body.tag, 50);
  if (!tag) return json({ error: 'Tag requis' }, 400);

  await env.DB.prepare(
    'DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?'
  ).bind(leadId, tag.toLowerCase()).run();

  await env.DB.prepare(
    "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'tag_removed', ?)"
  ).bind(leadId, auth.userId, JSON.stringify({ tag })).run();

  return json({ success: true });
}

// ── GET /api/tags — Tous les tags existants ─────────────────

async function handleGetAllTags(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { results } = await env.DB.prepare(
    'SELECT DISTINCT tag FROM lead_tags ORDER BY tag ASC'
  ).all();

  const tags = (results || []).map((r: Record<string, unknown>) => r.tag as string);
  return json({ data: tags });
}

// ── GET /api/activity — Activité récente ────────────────────

async function handleGetActivity(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);

  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name as user_name, l.name as lead_name
     FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     LEFT JOIN leads l ON a.lead_id = l.id
     ORDER BY a.created_at DESC LIMIT ?`
  ).bind(limit).all();

  return json({ data: results || [] });
}

// ── GET /api/leads/export — Export CSV ──────────────────────

async function handleExportCsv(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const status = url.searchParams.get('status');
  const clientId = url.searchParams.get('client_id');

  let query = `SELECT l.*, c.name as client_name FROM leads l
               LEFT JOIN clients c ON l.client_id = c.id WHERE 1=1`;
  const params: string[] = [];

  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (clientId) { query += ' AND l.client_id = ?'; params.push(clientId); }
  query += ' ORDER BY l.created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const leads = (results || []) as Record<string, unknown>[];

  // Construire le CSV
  const headers = ['Nom', 'Email', 'Téléphone', 'Type', 'Statut', 'Client', 'Source', 'Budget', 'Valeur', 'Message', 'Date'];
  const rows = leads.map(l => [
    l.name, l.email, l.phone, l.type, l.status, l.client_name || l.client_id,
    l.source, l.budget, l.deal_value ?? 0, l.message,
    l.created_at,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-intralys-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...corsHeaders(),
    },
  });
}

// ── Phase 2 : Messages & Conversations ──────────────────────

async function handleGetLeadMessages(
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

async function handleSendMessage(
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
    // Twilio sera intégré plus tard — pour l'instant on enregistre comme 'sent'
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

async function handleGetInboxMessages(
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

// ── Phase 2 : Templates d'emails ────────────────────────────

async function handleGetTemplates(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const category = url.searchParams.get('category');

  let query = 'SELECT * FROM email_templates WHERE is_active = 1';
  const params: string[] = [];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY created_at DESC';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

async function handleCreateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const subject = sanitizeInput(body.subject as string, 200);
  const bodyHtml = sanitizeInput(body.body_html as string, 10000);
  const category = sanitizeInput(body.category as string, 20) || 'general';

  if (!name || !subject || !bodyHtml) {
    return json({ error: 'Nom, sujet et contenu requis' }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO email_templates (id, name, subject, body_html, category)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, subject, bodyHtml, category).run();

  return json({ data: { id } }, 201);
}

async function handleUpdateTemplate(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: string[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.subject) { updates.push('subject = ?'); params.push(sanitizeInput(body.subject as string, 200)); }
  if (body.body_html) { updates.push('body_html = ?'); params.push(sanitizeInput(body.body_html as string, 10000)); }
  if (body.category) { updates.push('category = ?'); params.push(sanitizeInput(body.category as string, 20)); }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(templateId);

  await env.DB.prepare(
    `UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return json({ data: { success: true } });
}

async function handleDeleteTemplate(
  env: Env,
  auth: { userId: string; role: string },
  templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  await env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(templateId).run();

  return json({ data: { success: true } });
}

// ── Phase 3 : Workflows & Automations ───────────────────────

async function handleGetWorkflows(
  env: Env,
  _auth: { userId: string; role: string }
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.*,
       (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as steps_count,
       (SELECT COUNT(*) FROM workflow_enrollments WHERE workflow_id = w.id AND status = 'active') as active_enrollments,
       (SELECT COUNT(*) FROM workflow_execution_log el
        JOIN workflow_enrollments we ON el.enrollment_id = we.id
        WHERE we.workflow_id = w.id) as total_executions
     FROM workflows w
     ORDER BY w.created_at DESC`
  ).all();

  return json({ data: results || [] });
}

async function handleGetWorkflowDetail(
  env: Env,
  _auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  const workflow = await env.DB.prepare('SELECT * FROM workflows WHERE id = ?').bind(workflowId).first();
  if (!workflow) {
    return json({ error: 'Workflow introuvable' }, 404);
  }

  const { results: steps } = await env.DB.prepare(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC'
  ).bind(workflowId).all();

  const { results: enrollments } = await env.DB.prepare(
    `SELECT we.*, l.name as lead_name
     FROM workflow_enrollments we
     LEFT JOIN leads l ON we.lead_id = l.id
     WHERE we.workflow_id = ?
     ORDER BY we.enrolled_at DESC
     LIMIT 50`
  ).bind(workflowId).all();

  return json({
    data: {
      ...workflow,
      steps: steps || [],
      enrollments: enrollments || [],
    },
  });
}

async function handleCreateWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 100);
  const description = sanitizeInput(body.description as string, 500);
  const triggerType = sanitizeInput(body.trigger_type as string, 30);
  const triggerConfig = sanitizeInput(body.trigger_config as string, 1000) || '{}';

  if (!name || !triggerType) {
    return json({ error: 'Nom et type de déclencheur requis' }, 400);
  }

  const workflowId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO workflows (id, client_id, name, description, trigger_type, trigger_config)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(workflowId, body.client_id as string || null, name, description, triggerType, triggerConfig).run();

  // Créer les steps si fournis
  const steps = body.steps as Array<{ step_order: number; step_type: string; config: string }> | undefined;
  if (steps && Array.isArray(steps)) {
    for (const step of steps) {
      const stepId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, config)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(stepId, workflowId, step.step_order, step.step_type, step.config || '{}').run();
    }
  }

  return json({ data: { id: workflowId } }, 201);
}

async function handleUpdateWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 100)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 500)); }
  if (body.trigger_type) { updates.push('trigger_type = ?'); params.push(sanitizeInput(body.trigger_type as string, 30)); }
  if (body.trigger_config) { updates.push('trigger_config = ?'); params.push(sanitizeInput(body.trigger_config as string, 1000)); }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(workflowId);

  await env.DB.prepare(
    `UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // Mettre à jour les steps si fournis
  const steps = body.steps as Array<{ step_order: number; step_type: string; config: string }> | undefined;
  if (steps && Array.isArray(steps)) {
    await env.DB.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').bind(workflowId).run();
    for (const step of steps) {
      const stepId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, config)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(stepId, workflowId, step.step_order, step.step_type, step.config || '{}').run();
    }
  }

  return json({ data: { success: true } });
}

async function handleDeleteWorkflow(
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  // Supprimer en cascade : enrollments → steps → workflow
  await env.DB.prepare('DELETE FROM workflow_enrollments WHERE workflow_id = ?').bind(workflowId).run();
  await env.DB.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').bind(workflowId).run();
  await env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(workflowId).run();

  return json({ data: { success: true } });
}

async function handleToggleWorkflow(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const body = await request.json() as { is_active: number };
  const isActive = body.is_active ? 1 : 0;

  await env.DB.prepare(
    "UPDATE workflows SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(isActive, workflowId).run();

  return json({ data: { success: true, is_active: isActive } });
}

async function handleEnrollLead(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  workflowId: string
): Promise<Response> {
  const body = await request.json() as { lead_id: string };
  const leadId = sanitizeInput(body.lead_id, 100);

  if (!leadId) {
    return json({ error: 'lead_id requis' }, 400);
  }

  // Vérifier que le workflow existe et est actif
  const workflow = await env.DB.prepare(
    'SELECT id FROM workflows WHERE id = ? AND is_active = 1'
  ).bind(workflowId).first();
  if (!workflow) {
    return json({ error: 'Workflow introuvable ou inactif' }, 404);
  }

  // Vérifier que le lead n'est pas déjà inscrit (actif)
  const existing = await env.DB.prepare(
    "SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
  ).bind(workflowId, leadId).first();
  if (existing) {
    return json({ error: 'Ce lead est déjà inscrit dans ce workflow' }, 409);
  }

  // Trouver le premier step
  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;

  const enrollmentId = crypto.randomUUID();
  let nextActionAt: string | null = null;

  // Si le premier step est un 'wait', calculer le next_action_at
  if (firstStep?.step_type === 'wait') {
    try {
      const config = JSON.parse(firstStep.config) as { delay_minutes?: number };
      const delay = config.delay_minutes || 0;
      nextActionAt = new Date(Date.now() + delay * 60 * 1000).toISOString();
    } catch { /* config invalide */ }
  }

  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(enrollmentId, workflowId, leadId, firstStep?.id || null, nextActionAt).run();

  // Log l'activité
  const lead = await env.DB.prepare('SELECT client_id FROM leads WHERE id = ?').bind(leadId).first() as { client_id: string } | null;
  await env.DB.prepare(
    `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
     VALUES (?, ?, ?, 'workflow_enrolled', ?)`
  ).bind(leadId, lead?.client_id || '', auth.userId, JSON.stringify({ workflow_id: workflowId, enrollment_id: enrollmentId })).run();

  return json({ data: { id: enrollmentId } }, 201);
}

// ── Phase 4 : Calendrier & RDV ──────────────────────────────

async function handleGetAppointments(
  env: Env,
  _auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const clientId = url.searchParams.get('client_id');

  let query = `SELECT a.*, l.name as lead_name, c.name as client_name
    FROM appointments a
    LEFT JOIN leads l ON a.lead_id = l.id
    LEFT JOIN clients c ON a.client_id = c.id
    WHERE 1=1`;
  const params: string[] = [];

  if (start) { query += ' AND a.start_time >= ?'; params.push(start); }
  if (end) { query += ' AND a.start_time <= ?'; params.push(end); }
  if (clientId) { query += ' AND a.client_id = ?'; params.push(clientId); }

  query += ' ORDER BY a.start_time ASC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({ data: results || [] });
}

async function handleCreateAppointment(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  const description = sanitizeInput(body.description as string, 1000) || '';
  const startTime = sanitizeInput(body.start_time as string, 30);
  const endTime = sanitizeInput(body.end_time as string, 30);
  const location = sanitizeInput(body.location as string, 300) || '';
  const type = sanitizeInput(body.type as string, 20) || 'meeting';
  const clientId = sanitizeInput(body.client_id as string, 100);

  if (!title || !startTime || !endTime) {
    return json({ error: 'Titre, heure de début et de fin requis' }, 400);
  }

  const VALID_TYPES = ['meeting', 'call', 'visit', 'signing', 'other'];
  if (!VALID_TYPES.includes(type)) {
    return json({ error: 'Type de RDV invalide' }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO appointments (id, lead_id, client_id, title, description, start_time, end_time, location, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.lead_id as string || null, clientId || '', title, description, startTime, endTime, location, type).run();

  // Log d'activité si lié à un lead
  if (body.lead_id) {
    await env.DB.prepare(
      `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
       VALUES (?, ?, ?, 'appointment_created', ?)`
    ).bind(body.lead_id as string, clientId || '', auth.userId, JSON.stringify({ appointment_id: id, title })).run();
  }

  return json({ data: { id } }, 201);
}

async function handleUpdateAppointment(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  appointmentId: string
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.start_time) { updates.push('start_time = ?'); params.push(sanitizeInput(body.start_time as string, 30)); }
  if (body.end_time) { updates.push('end_time = ?'); params.push(sanitizeInput(body.end_time as string, 30)); }
  if (body.location !== undefined) { updates.push('location = ?'); params.push(sanitizeInput(body.location as string, 300)); }
  if (body.type) { updates.push('type = ?'); params.push(sanitizeInput(body.type as string, 20)); }
  if (body.status) {
    const VALID_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'];
    const status = sanitizeInput(body.status as string, 20);
    if (status && VALID_STATUSES.includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }
  }
  if (body.notes !== undefined) { updates.push('notes = ?'); params.push(sanitizeInput(body.notes as string, 2000)); }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(appointmentId);

  await env.DB.prepare(
    `UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // Log si changement de statut
  if (body.status) {
    const appt = await env.DB.prepare('SELECT lead_id, client_id, title FROM appointments WHERE id = ?').bind(appointmentId).first() as { lead_id: string | null; client_id: string; title: string } | null;
    if (appt?.lead_id) {
      await env.DB.prepare(
        `INSERT INTO activity_log (lead_id, client_id, user_id, action, details)
         VALUES (?, ?, ?, 'appointment_updated', ?)`
      ).bind(appt.lead_id, appt.client_id, auth.userId, JSON.stringify({ appointment_id: appointmentId, status: body.status, title: appt.title })).run();
    }
  }

  return json({ data: { success: true } });
}

async function handleDeleteAppointment(
  env: Env,
  auth: { userId: string; role: string },
  appointmentId: string
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(appointmentId).run();

  return json({ data: { success: true } });
}

// ── Phase 5 : Tasks CRUD ────────────────────────────────────

async function handleGetTasks(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const leadId = url.searchParams.get('lead_id');

  let query = `SELECT t.*, l.name as lead_name FROM tasks t
               LEFT JOIN leads l ON t.lead_id = l.id WHERE 1=1`;
  const params: string[] = [];

  if (auth.role !== 'admin') {
    query += ' AND (t.assigned_to = ? OR t.created_by = ?)';
    params.push(auth.userId, auth.userId);
  }
  if (status && ['todo', 'in_progress', 'done'].includes(status)) { query += ' AND t.status = ?'; params.push(status); }
  if (priority && ['high', 'medium', 'low'].includes(priority)) { query += ' AND t.priority = ?'; params.push(priority); }
  if (leadId) { query += ' AND t.lead_id = ?'; params.push(sanitizeInput(leadId, 100)); }

  query += " ORDER BY (CASE t.status WHEN 'done' THEN 1 ELSE 0 END), t.due_date ASC LIMIT 200";

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

async function handleCreateTask(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  if (!title) return json({ error: 'Titre requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, title,
    sanitizeInput(body.description as string, 1000),
    sanitizeInput(body.due_date as string, 30) || null,
    sanitizeInput(body.priority as string, 10) || 'medium',
    sanitizeInput(body.status as string, 20) || 'todo',
    (body.lead_id as string) || null,
    (body.client_id as string) || null,
    sanitizeInput(body.assigned_to as string, 100) || auth.userId,
    auth.userId,
  ).run();

  return json({ data: { id } }, 201);
}

async function handlePatchTask(request: Request, env: Env, _auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];
  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.due_date !== undefined) { updates.push('due_date = ?'); params.push(sanitizeInput(body.due_date as string, 30) || null); }
  if (body.priority) { updates.push('priority = ?'); params.push(sanitizeInput(body.priority as string, 10)); }
  if (body.status) { updates.push('status = ?'); params.push(sanitizeInput(body.status as string, 20)); }
  if (body.assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(sanitizeInput(body.assigned_to as string, 100)); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(taskId);
  await env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

async function handleDeleteTask(env: Env, auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  // Vérifier que l'utilisateur est admin ou owner de la tâche
  if (auth.role !== 'admin') {
    const task = await env.DB.prepare('SELECT assigned_to, created_by FROM tasks WHERE id = ?').bind(taskId).first() as { assigned_to: string | null; created_by: string | null } | null;
    if (!task || (task.assigned_to !== auth.userId && task.created_by !== auth.userId)) {
      return json({ error: 'Non autorisé' }, 403);
    }
  }
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
  await audit(env, auth.userId, 'task.delete', 'task', taskId);
  return json({ data: { success: true } });
}

// ── Notifications réelles ───────────────────────────────────

async function handleGetNotifications(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);

  let query = 'SELECT * FROM notifications WHERE user_id = ?';
  const params: (string | number)[] = [auth.userId];

  if (unreadOnly) {
    query += ' AND is_read = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all();

  // Compter les non-lues
  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(auth.userId).all();
  const unreadCount = (countResult.results?.[0] as { count: number } | undefined)?.count || 0;

  return json({ data: results || [], unread_count: unreadCount });
}

async function handleReadNotification(env: Env, auth: { userId: string; role: string }, notifId: string): Promise<Response> {
  await env.DB.prepare(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?"
  ).bind(notifId, auth.userId).run();
  return json({ data: { success: true } });
}

async function handleReadAllNotifications(env: Env, auth: { userId: string; role: string }): Promise<Response> {
  await env.DB.prepare(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0"
  ).bind(auth.userId).run();
  return json({ data: { success: true } });
}

// Helper pour créer une notification
async function createNotification(env: Env, userId: string, title: string, description: string, icon = '🔔', link = '', clientId = ''): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, client_id, icon, title, description, link)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), userId, clientId, icon, title, description, link).run();
}

async function processWorkflowQueue(env: Env): Promise<void> {
  const now = new Date().toISOString();

  const { results: due } = await env.DB.prepare(
    `SELECT * FROM workflow_enrollments
     WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= ?
     ORDER BY next_action_at ASC LIMIT 50`
  ).bind(now).all();

  for (const e of (due || []) as Array<Record<string, unknown>>) {
    try {
      await advanceEnrollment(env, e);
    } catch (err) {
      console.error('Workflow step failed', e.id, err);
      await env.DB.prepare(
        `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
         VALUES (?, ?, 'failed', ?)`
      ).bind(e.id as string, (e.current_step_id as string) || '', JSON.stringify({ error: String(err) })).run();
    }
  }
}

async function advanceEnrollment(env: Env, enrollment: Record<string, unknown>): Promise<void> {
  const enrollmentId = enrollment.id as string;
  const workflowId = enrollment.workflow_id as string;
  const leadId = enrollment.lead_id as string;
  const currentStepId = enrollment.current_step_id as string | null;

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) {
    await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enrollmentId).run();
    return;
  }

  const step = currentStepId
    ? await env.DB.prepare('SELECT * FROM workflow_steps WHERE id = ?').bind(currentStepId).first() as Record<string, unknown> | null
    : null;

  if (step) {
    await executeStep(env, step, lead, enrollmentId);
    await env.DB.prepare(
      `INSERT INTO workflow_execution_log (enrollment_id, step_id, status) VALUES (?, ?, 'executed')`
    ).bind(enrollmentId, step.id as string).run();
  }

  // Step suivant
  const currentOrder = (step?.step_order as number) || 0;
  const nextStep = await env.DB.prepare(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId, currentOrder).first() as Record<string, unknown> | null;

  if (!nextStep) {
    await env.DB.prepare(
      "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now'), next_action_at = NULL WHERE id = ?"
    ).bind(enrollmentId).run();
    return;
  }

  let nextAt: string;
  if (nextStep.step_type === 'wait') {
    let delay = 0;
    try { delay = (JSON.parse(nextStep.config as string) as { delay_minutes?: number }).delay_minutes || 0; } catch { /* */ }
    nextAt = new Date(Date.now() + delay * 60_000).toISOString();
  } else {
    nextAt = new Date().toISOString();
  }

  await env.DB.prepare(
    "UPDATE workflow_enrollments SET current_step_id = ?, next_action_at = ? WHERE id = ?"
  ).bind(nextStep.id as string, nextAt, enrollmentId).run();
}

async function executeStep(env: Env, step: Record<string, unknown>, lead: Record<string, unknown>, _enrollmentId: string): Promise<void> {
  const stepType = step.step_type as string;
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(step.config as string); } catch { /* */ }

  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(lead[key] ?? ''));

  switch (stepType) {
    case 'wait':
      return;

    case 'send_email': {
      if (!env.RESEND_API_KEY) return;
      const tplId = config.template_id as string;
      const tpl = tplId
        ? await env.DB.prepare('SELECT subject, body_html FROM email_templates WHERE id = ?').bind(tplId).first() as { subject: string; body_html: string } | null
        : null;
      if (!tpl) return;
      try {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Intralys CRM <noreply@intralys.com>',
          to: [lead.email as string],
          subject: interpolate(tpl.subject),
          html: interpolate(tpl.body_html),
        });
        await env.DB.prepare(
          `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by)
           VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', 'workflow')`
        ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, interpolate(tpl.subject), interpolate(tpl.body_html)).run();
      } catch (err) {
        console.error('Workflow send_email failed:', err);
        await env.DB.prepare(
          `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
           VALUES (?, ?, 'failed', ?)`
        ).bind(_enrollmentId, step.id as string, JSON.stringify({ error: String(err) })).run();
      }
      return;
    }

    case 'send_sms':
      // TODO P1 quand Twilio sera branché
      return;

    case 'add_tag':
      if (config.tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'remove_tag':
      if (config.tag) {
        await env.DB.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'change_status':
      if (config.status && ['new', 'contacted', 'meeting', 'signed', 'closed', 'lost'].includes(config.status as string)) {
        await env.DB.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(config.status as string, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to: config.status, by: 'workflow' })).run();
      }
      return;

    case 'notify':
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, client_id, icon, title, description, link)
         SELECT id, ?, '🔔', 'Workflow', ?, ?
         FROM users WHERE (client_id = ? OR role = 'admin') AND is_active = 1`
      ).bind(
        lead.client_id as string,
        interpolate(String(config.message || 'Action requise')),
        `/leads/${lead.id}`,
        lead.client_id as string,
      ).run();
      return;

    case 'webhook': {
      const url = String(config.url || '');
      if (!url || !url.startsWith('https://')) return;
      try {
        await fetch(url, {
          method: String(config.method || 'POST'),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead }),
        });
      } catch (err) {
        console.warn('Webhook step failed', err);
      }
      return;
    }

    default:
      return;
  }
}

// Helper pour auto-enroll dans les workflows
async function autoEnroll(env: Env, workflowId: string, leadId: string): Promise<void> {
  const exists = await env.DB.prepare(
    "SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
  ).bind(workflowId, leadId).first();
  if (exists) return;
  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;
  if (!firstStep) return;
  let nextAt = new Date().toISOString();
  if (firstStep.step_type === 'wait') {
    try { nextAt = new Date(Date.now() + ((JSON.parse(firstStep.config) as { delay_minutes?: number }).delay_minutes || 0) * 60_000).toISOString(); } catch { /* */ }
  }
  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(crypto.randomUUID(), workflowId, leadId, firstStep.id, nextAt).run();
}
