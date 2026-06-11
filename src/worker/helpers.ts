// ── Helpers partagés Worker ──────────────────────────────────

import type { Env } from './types';
import { auditRedact } from './lib/audit-redact';

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

// ── Sprint 24 — Observabilité : request_id corrélation ──────────────
// `_currentRequestId` est positionné au chokepoint worker.ts:339 (juste après
// `setRequestContext`). Lu par :
//   - `json()` ci-dessous (header `X-Request-Id` en réponse).
//   - `audit()` ci-dessous (colonne audit_log.request_id seq121).
//   - `createCorrelatedLogger(env, requestId)` (logger.ts).
// Convention : UUID v4 (ou reprise du header entrant si présent).
let _currentRequestId: string | null = null;

export function setRequestId(id: string): void {
  _currentRequestId = id;
}

export function getRequestId(): string | null {
  return _currentRequestId;
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
  // Sprint 24 — Observabilité : injection header `X-Request-Id` si présent.
  // Signature publique INCHANGÉE (pas de nouveau param). Best-effort : si
  // _currentRequestId est null (hors fetch), aucun header n'est ajouté.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  };
  if (_currentRequestId) headers['X-Request-Id'] = _currentRequestId;
  return new Response(JSON.stringify(data), { status, headers });
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
    // ── Sprint 23 — redaction PII (whitelist stricte) ─────────────────
    // SENSITIVE_KEYS_REGEX dans lib/audit-redact.ts. La signature publique
    // de audit() reste INCHANGÉE — les callers existants ne se rendent
    // compte de rien. `redacted` = 1 si ≥1 clé sensible a été remplacée.
    const { sanitized, redacted } = auditRedact(details);
    const payload = JSON.stringify(sanitized);
    // ── Sprint 24 — Observabilité : propagation `request_id` (seq121 colonne
    // ajoutée, jamais écrite avant Sprint 24). Triple fallback rétro-compat :
    //   9 cols (seq122+ : request_id + redacted) → nominal,
    //   8 cols (seq121 only : redacted, pas de request_id écrit)              → fallback A,
    //   7 cols (pré-seq121 : forme historique)                                → fallback B.
    // Détection via /no such column/i.test(e.message). La signature publique
    // de audit() reste INCHANGÉE.
    const requestId = _currentRequestId;
    try {
      // Chemin nominal : colonnes `request_id` ET `redacted` présentes (seq121 jouée).
      await env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip, user_agent, request_id, redacted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, action, resourceType, resourceId, payload, ip, ua, requestId, redacted ? 1 : 0).run();
    } catch (e9) {
      const msg9 = String(e9 ?? '');
      if (/no such column/i.test(msg9) || /has no column/i.test(msg9)) {
        try {
          // Fallback A : colonne `request_id` absente (seq121 partielle ou DB
          // hors-séquence) mais `redacted` présente → forme Sprint 23.
          await env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip, user_agent, redacted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(userId, action, resourceType, resourceId, payload, ip, ua, redacted ? 1 : 0).run();
        } catch (e8) {
          const msg8 = String(e8 ?? '');
          if (/no such column/i.test(msg8) || /has no column/i.test(msg8)) {
            // Fallback B : forme historique pré-seq121 (sans redacted, sans
            // request_id). Compat dev/test où aucune migration sécurité n'a tourné.
            await env.DB.prepare(
              `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip, user_agent)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(userId, action, resourceType, resourceId, payload, ip, ua).run();
          } else {
            throw e8;
          }
        }
      } else {
        throw e9;
      }
    }
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
  // ── DEV BYPASS ──
  // Active UNIQUEMENT si env.DEV_BYPASS_AUTH === 'true' (via .dev.vars en local).
  // En prod (Cloudflare Pages), la variable n'est pas définie → vrai check token.
  if (env.DEV_BYPASS_AUTH === 'true') {
    return { userId: 'admin', role: 'admin' };
  }

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
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, client_id, icon, title, description, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, userId, clientId, icon, title, description, link).run();

    // Push notification mobile (best-effort, ne bloque jamais)
    if (userId) {
      try {
        const { sendPushToUser } = await import('./push');
        await sendPushToUser(env, userId, `${icon} ${title}`, description, { url: link });
      } catch { /* push non critique */ }
    }

    // Sprint 46 M3.4 — broadcast WebSocket realtime (best-effort)
    if (userId && env.NOTIFICATION_ROOMS) {
      try {
        const { broadcastNotificationToUser } = await import('./notifications-ws');
        await broadcastNotificationToUser(env, userId, {
          id,
          icon,
          title,
          description,
          link,
          is_read: 0,
          created_at: createdAt,
        });
      } catch { /* WS broadcast non critique */ }
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

// ── Sprint 92 — Chiffrement PII at rest ─────────────────────
// Cache per-request de la CryptoKey importée (évite N imports par requête).
let _cachedCryptoKey: CryptoKey | null = null;
let _cachedCryptoKeyHex: string | null = null;

export async function getCryptoKey(env: Env): Promise<CryptoKey | null> {
  if (!env.ENCRYPTION_KEY) return null;
  if (_cachedCryptoKey && _cachedCryptoKeyHex === env.ENCRYPTION_KEY) return _cachedCryptoKey;
  const { importAesKeyHex } = await import('./lib/crypto-engine');
  _cachedCryptoKey = await importAesKeyHex(env.ENCRYPTION_KEY);
  _cachedCryptoKeyHex = env.ENCRYPTION_KEY;
  return _cachedCryptoKey;
}

export function getEncryptionKeyHex(env: Env): string | null {
  return env.ENCRYPTION_KEY || null;
}
