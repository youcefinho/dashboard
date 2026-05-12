// ── Helpers partagés Worker ──────────────────────────────────

import type { Env } from './types';

// ── Request context (stocké au début de fetch, utilisé partout) ─────
let _currentRequest: Request | null = null;
let _currentEnv: Env | null = null;

export function setRequestContext(request: Request, env: Env): void {
  _currentRequest = request;
  _currentEnv = env;
}

export function getRequestContext(): { request: Request | null; env: Env | null } {
  return { request: _currentRequest, env: _currentEnv };
}

// ── Sanitisation ────────────────────────────────────────────

export function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeInput(str: string | undefined | null, maxLen = 500): string {
  if (!str) return '';
  return str.trim().slice(0, maxLen);
}

// ── CORS ────────────────────────────────────────────────────

export function corsHeaders(): Record<string, string> {
  if (_currentRequest && _currentEnv) {
    const origin = _currentRequest.headers.get('Origin') || '';
    const allowed = (_currentEnv.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // Dev local + Capacitor natif : origines par défaut
    if (allowed.length === 0) allowed.push('http://localhost:5176', 'http://localhost:5173', 'capacitor://localhost', 'http://localhost');
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

// ── JSON Response ───────────────────────────────────────────

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── Audit log helper (best-effort) ──────────────────────────

export async function audit(
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

// ── Twilio SMS helper ───────────────────────────────────────

export async function sendSms(
  env: Env, to: string, body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    return { success: false, error: 'Twilio non configuré' };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams({
      To: to,
      From: env.TWILIO_PHONE_NUMBER,
      Body: body,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json() as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      return { success: false, error: data.message || `Twilio ${res.status}` };
    }
    return { success: true, sid: data.sid };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Auth helpers ────────────────────────────────────────────

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  return token.length >= 10 ? token : null;
}

export async function validateSession(token: string, env: Env): Promise<{ valid: boolean; userId?: string; role?: string }> {
  const { results } = await env.DB.prepare(
    "SELECT user_id, role FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).all();
  if (!results || results.length === 0) return { valid: false };
  const session = results[0] as { user_id: string; role: string };
  return { valid: true, userId: session.user_id, role: session.role };
}

export async function requireAuth(request: Request, env: Env): Promise<Response | { userId: string; role: string }> {
  const token = extractToken(request);
  if (!token) return json({ error: 'Non autorisé' }, 401);

  const session = await validateSession(token, env);
  if (!session.valid || !session.userId || !session.role) {
    return json({ error: 'Session expirée ou invalide' }, 401);
  }
  return { userId: session.userId, role: session.role };
}

// ── Notification helper ─────────────────────────────────────

export async function createNotification(
  env: Env,
  userId: string,
  title: string,
  description: string,
  icon = '🔔',
  link = '',
  clientId = ''
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, client_id, icon, title, description, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), userId, clientId, icon, title, description, link).run();

    // Push notification mobile (best-effort, ne bloque jamais)
    if (userId) {
      try {
        const { sendPushToUser } = await import('./push');
        await sendPushToUser(env, userId, `${icon} ${title}`, description, { url: link });
      } catch { /* push non critique */ }
    }
  } catch { /* best-effort */ }
}

// ── DND (Do Not Disturb) helper ─────────────────────────────

export type DndChannel = 'email' | 'sms' | 'call' | 'webchat';

/**
 * Vérifie si un lead a activé DND pour un canal donné.
 * Retourne true si l'envoi est BLOQUÉ.
 */
export async function isLeadDnd(env: Env, leadId: string, channel: DndChannel): Promise<boolean> {
  const lead = await env.DB.prepare(
    'SELECT dnd, dnd_settings FROM leads WHERE id = ?'
  ).bind(leadId).first() as { dnd: number; dnd_settings: string } | null;
  if (!lead || !lead.dnd) return false;
  try {
    const settings = JSON.parse(lead.dnd_settings || '{}') as Record<string, boolean>;
    // Si le canal spécifique est désactivé dans les settings, pas de blocage
    if (settings[channel] === false) return false;
    // Si DND global activé et le canal n'est pas explicitement exclu → bloqué
    return true;
  } catch {
    // Si dnd_settings invalide mais dnd = 1 → bloquer par défaut
    return true;
  }
}

