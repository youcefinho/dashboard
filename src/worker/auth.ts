// ── Module Auth — Intralys CRM ──────────────────────────────
import type { Env } from './types';
import { json, audit } from './helpers';
import { hashPassword, verifyPassword } from './crypto';
// Sprint 23 — retrofit zod sur forgot/reset password (validation cohérente
// avec le reste du codebase + bornes max longueur). On utilise safeParse
// directement pour ne pas entrer en collision avec `validate()` local.
import { forgotPasswordSchema, resetPasswordSchema } from '../lib/schemas';
import { checkRateLimit } from './lib/rate-limit';

const LOGIN_WINDOW_HOURS = 1;
const MAX_LOGIN_ATTEMPTS = 5;
const SESSION_DURATION_HOURS = 72;

// ── Schemas de validation ───────────────────────────────────

type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };
function validate<T>(schema: { parse: (d: unknown) => T; }, data: unknown): ValidationResult<T> {
  try { return { success: true, data: schema.parse(data) }; }
  catch (e) { return { success: false, error: String(e) }; }
}

const loginSchema = {
  parse(data: unknown) {
    const d = data as { email?: string; password?: string };
    if (!d.email || typeof d.email !== 'string') throw 'Email requis';
    if (!d.password || typeof d.password !== 'string') throw 'Mot de passe requis';
    if (d.password.length < 6) throw 'Mot de passe trop court (min 6 caractères)';
    return { email: d.email.trim(), password: d.password };
  },
};

const changePasswordSchema = {
  parse(data: unknown) {
    const d = data as { current?: string; next?: string };
    if (!d.current || !d.next) throw 'Mot de passe actuel et nouveau requis';
    if (d.next.length < 8) throw 'Nouveau mot de passe trop court (min 8 caractères)';
    return { current: d.current, next: d.next };
  },
};

// ── Helpers ─────────────────────────────────────────────────

function extractToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function requireAuth(request: Request, env: Env): Promise<{ userId: string; role: string } | Response> {
  // ── DEV BYPASS ──
  // Active UNIQUEMENT si env.DEV_BYPASS_AUTH === 'true' (via .dev.vars en local).
  // En prod (Cloudflare Pages), la variable n'est pas définie → vrai check token.
  if (env.DEV_BYPASS_AUTH === 'true') {
    return { userId: 'admin', role: 'admin' };
  }

  const token = extractToken(request);
  if (!token) return json({ error: "Token d'authentification manquant" }, 401);
  const session = await env.DB.prepare(
    "SELECT user_id, role FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first() as { user_id: string; role: string } | null;
  if (!session) return json({ error: 'Session invalide ou expirée' }, 401);
  return { userId: session.user_id, role: session.role };
}

// ── Handlers ────────────────────────────────────────────────

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const ua = request.headers.get('User-Agent') || 'Unknown Browser';
  const devBypass = env.DEV_BYPASS_AUTH === 'true';

  // Rate limit (skip en dev bypass)
  if (!devBypass) {
    const windowStart = new Date(Date.now() - LOGIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const attempts = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
    ).bind(ip, windowStart).first() as { count: number } | null;
    if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS) {
      return json({ error: 'Trop de tentatives. Réessayez dans 1 heure.' }, 429);
    }
  }

  const raw = await request.json();
  const parsed = validate(loginSchema, raw);
  if (!parsed.success) return json({ error: parsed.error }, 400);
  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;

  await env.DB.prepare("INSERT INTO login_attempts (ip, attempted_at) VALUES (?, datetime('now'))").bind(ip).run();

  const user = await env.DB.prepare(
    'SELECT id, name, role, client_id, password_hash, is_active, must_change_password FROM users WHERE email = ?'
  ).bind(email).first() as { id: string; name: string; role: string; client_id: string | null; password_hash: string; is_active: number; must_change_password: number } | null;

  if (!user) {
    // En dev bypass : auto-créer le user. En prod : refuser.
    if (!devBypass) return json({ error: 'Identifiants incorrects' }, 401);
    const userId = crypto.randomUUID();
    const hash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'Rochdi', 'admin', 1)").bind(userId, email, hash).run();
    return finishLogin(env, userId, 'admin', 'Rochdi', email, true, ip, ua);
  }

  if (!user.is_active) return json({ error: 'Compte désactivé' }, 401);

  // Vérification password (skip en dev bypass)
  let passwordOk = devBypass;
  if (!devBypass) {
    if (user.password_hash && user.password_hash.startsWith('pbkdf2$')) {
      passwordOk = await verifyPassword(password, user.password_hash);
    } else {
      passwordOk = password === env.ADMIN_PASSWORD;
    }
  }

  if (!passwordOk) return json({ error: 'Identifiants incorrects' }, 401);

  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return finishLogin(env, user.id, user.role, user.name, email, !!user.must_change_password, ip, ua);
}

export async function finishLogin(env: Env, userId: string, role: string, name: string, email: string, mustChangePassword: boolean, ip: string, ua: string): Promise<Response> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at, ip, user_agent, last_active_at) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, datetime('now'))").bind(token, userId, role, expiresAt, ip, ua).run();
  try {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
    const cleanupWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cleanupWindow).run();
  } catch { /* non critique */ }
  await audit(env, userId, 'auth.login', 'user', userId, { email, role, ip });
  return json({ success: true, token, must_change_password: mustChangePassword, user: { id: userId, name, role, email } });
}

// ── Register (public — provisionne une agence-tenant) ───────────
// CONTRAT §6.5 (figé). Succès = format IDENTIQUE à finishLogin.
// `provisionAgencyTenant` est implémenté par Manager 2 (./provisioning) —
// signature contractuelle §6.4 : Promise<{userId,agencyId,clientId}>.

const registerSchema = {
  parse(data: unknown) {
    const d = data as { email?: string; password?: string; name?: string; company?: string };
    if (!d.email || typeof d.email !== 'string') throw 'Email requis';
    if (!d.password || typeof d.password !== 'string') throw 'Mot de passe requis';
    if (d.password.length < 8) throw 'Mot de passe trop court (min 8 caractères)';
    if (!d.name || typeof d.name !== 'string') throw 'Nom requis';
    return {
      email: d.email.trim().toLowerCase(),
      password: d.password,
      name: d.name.trim(),
      company:
        typeof d.company === 'string' && d.company.trim() ? d.company.trim() : undefined,
    };
  },
};

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const ua = request.headers.get('User-Agent') || 'Unknown Browser';

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Requête invalide', code: 'INVALID_INPUT' }, 400);
  }
  const parsed = validate(registerSchema, raw);
  if (!parsed.success) return json({ error: parsed.error, code: 'INVALID_INPUT' }, 400);
  const { email, password, name, company } = parsed.data;

  // Email déjà pris ?
  const existing = (await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first()) as { id: string } | null;
  if (existing) {
    return json({ error: 'Cet email est déjà utilisé', code: 'EMAIL_TAKEN' }, 409);
  }

  const passwordHash = await hashPassword(password);

  let provisioned: { userId: string; agencyId: string; clientId: string };
  try {
    const { provisionAgencyTenant } = await import('./provisioning');
    provisioned = await provisionAgencyTenant(env, {
      email,
      name: company || name,
      passwordHash,
    });
  } catch {
    return json({ error: 'Création du compte impossible', code: 'PROVISION_FAILED' }, 500);
  }

  await audit(env, provisioned.userId, 'auth.register', 'user', provisioned.userId, { email });

  // Succès : format IDENTIQUE à finishLogin (token + session).
  return finishLogin(env, provisioned.userId, 'admin', name, email, false, ip, ua);
}

export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const raw = await request.json();
  const parsed = validate(changePasswordSchema, raw);
  if (!parsed.success) return json({ error: parsed.error }, 400);
  const body = parsed.data;
  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(auth.userId).first() as { password_hash: string } | null;
  if (!user) return json({ error: 'Utilisateur non trouvé' }, 404);
  let currentOk = false;
  if (user.password_hash && user.password_hash.startsWith('pbkdf2$')) { currentOk = await verifyPassword(body.current, user.password_hash); }
  else { currentOk = body.current === env.ADMIN_PASSWORD; }
  if (!currentOk) return json({ error: 'Mot de passe actuel incorrect' }, 401);
  const hash = await hashPassword(body.next);
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?").bind(hash, auth.userId).run();
  await audit(env, auth.userId, 'auth.change_password', 'user', auth.userId);
  return json({ success: true });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
  return json({ success: true });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const { results } = await env.DB.prepare('SELECT id, email, name, role, client_id, email_signature FROM users WHERE id = ?').bind(auth.userId).all();
  if (!results || results.length === 0) return json({ error: 'Utilisateur non trouvé' }, 404);
  return json({ data: results[0] });
}

export async function handleUpdateProfile(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const body = await request.json() as { name?: string; email_signature?: string };
  
  const updates: string[] = [];
  const params: string[] = [];
  
  if (body.name !== undefined) {
    updates.push('name = ?');
    params.push(body.name);
  }
  if (body.email_signature !== undefined) {
    updates.push('email_signature = ?');
    params.push(body.email_signature);
  }
  
  if (updates.length > 0) {
    params.push(auth.userId);
    await env.DB.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...params).run();
    await audit(env, auth.userId, 'user.profile_updated', 'user', auth.userId);
  }
  
  return json({ success: true });
}

export async function handleNotificationPreferences(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT channel, event_type, enabled FROM notification_preferences WHERE user_id = ?').bind(auth.userId).all();
    return json({ data: results || [] });
  }

  if (request.method === 'PATCH') {
    const body = await request.json() as { channel: string; event_type: string; enabled: boolean };
    if (!body.channel || !body.event_type) return json({ error: 'Paramètres manquants' }, 400);

    // Upsert preference
    await env.DB.prepare(`
      INSERT INTO notification_preferences (user_id, channel, event_type, enabled)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, channel, event_type) DO UPDATE SET enabled = excluded.enabled
    `).bind(auth.userId, body.channel, body.event_type, body.enabled ? 1 : 0).run();

    return json({ success: true });
  }

  return json({ error: 'Méthode non supportée' }, 405);
}

export async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  // Sprint 23 — rate-limit IP best-effort (5 / 10min). Anti-énumeration +
  // anti-spam Resend. Fail-open si seq121 absente (calque handlers Sprint 23).
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rl = await checkRateLimit(env, `forgot-password:ip:${ip}`, 5, 600);
  if (!rl.allowed) {
    return json({ error: 'Trop de tentatives — réessayez plus tard', code: 'RATE_LIMITED' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  // Sprint 23 — retrofit zod (email format + max 200 chars). Avant : check
  // manuel `if (!body.email)` — insuffisant face à payloads malformés.
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Email invalide', code: 'INVALID_INPUT' }, 400);
  }
  const email = parsed.data.email.toLowerCase().trim();
  const user = await env.DB.prepare('SELECT id, name FROM users WHERE email = ? AND is_active = 1').bind(email).first() as { id: string; name: string } | null;

  if (user) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h

    await env.DB.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), user.id, token, expiresAt).run();

    try {
      const resetUrl = `${new URL(request.url).origin}/reset-password/${token}`;
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Intralys <noreply@intralys.com>',
          to: email,
          subject: 'Réinitialisation de votre mot de passe',
          html: `<p>Bonjour ${user.name},</p><p>Cliquez sur ce lien pour réinitialiser votre mot de passe :</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Ce lien expire dans 1 heure.</p>`
        })
      });
      if (!resendRes.ok) {
        console.error('Erreur envoi email reset', await resendRes.text());
      }
    } catch (e) {
      console.error('Erreur fetch Resend:', e);
    }
  }

  // On renvoie un succès même si l'email n'existe pas (anti-enumeration)
  return json({ success: true, message: 'Si l\'email existe, un lien vous a été envoyé.' });
}

export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  // Sprint 23 — retrofit zod : token min 10 / max 200, password min 8 / max 500.
  // Avant : check manuel `if (!body.token || !body.password)`. Bornes max
  // ajoutées pour éviter payloads abusifs.
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Token ou mot de passe invalide', code: 'INVALID_INPUT' }, 400);
  }
  const { token: resetToken, password: newPassword } = parsed.data;

  const resetReq = await env.DB.prepare(
    "SELECT id, user_id, used, expires_at FROM password_reset_tokens WHERE token = ?"
  ).bind(resetToken).first() as { id: string; user_id: string; used: number; expires_at: string } | null;

  if (!resetReq) return json({ error: 'Lien invalide' }, 400);
  if (resetReq.used === 1) return json({ error: 'Lien déjà utilisé' }, 400);
  if (new Date(resetReq.expires_at) < new Date()) return json({ error: 'Lien expiré' }, 400);

  const hash = await hashPassword(newPassword);
  
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(hash, resetReq.user_id).run();

  await env.DB.prepare(
    "UPDATE password_reset_tokens SET used = 1 WHERE id = ?"
  ).bind(resetReq.id).run();

  await audit(env, resetReq.user_id, 'auth.reset_password', 'user', resetReq.user_id);

  return json({ success: true });
}

// ── D.1 Session Management ────────────────────────────────────

export async function handleGetSessions(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const { results } = await env.DB.prepare(
    "SELECT token, ip, user_agent, created_at, last_active_at, expires_at FROM admin_sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY last_active_at DESC"
  ).bind(auth.userId).all();

  const currentToken = extractToken(request);
  const sessions = (results || []).map(r => ({
    ...r,
    is_current: r.token === currentToken
  }));

  return json({ data: sessions });
}

export async function handleDeleteSession(request: Request, env: Env, tokenToDelete: string): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  // Protect against deleting a session that belongs to someone else
  await env.DB.prepare(
    "DELETE FROM admin_sessions WHERE token = ? AND user_id = ?"
  ).bind(tokenToDelete, auth.userId).run();

  return json({ success: true });
}

export async function handleDeleteOtherSessions(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const currentToken = extractToken(request);
  if (!currentToken) return json({ error: 'Token manquant' }, 401);

  await env.DB.prepare(
    "DELETE FROM admin_sessions WHERE user_id = ? AND token != ?"
  ).bind(auth.userId, currentToken).run();

  return json({ success: true });
}

// ── D.2 2FA Backup Codes ──────────────────────────────────────

export async function handleGenerateBackupCodes(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  // Generate 10 codes of 8 hex chars
  const codes = Array.from({ length: 10 }, () => {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  });

  // Delete old unused backup codes for this user
  await env.DB.prepare("DELETE FROM backup_codes WHERE user_id = ? AND used_at IS NULL").bind(auth.userId).run();

  // Insert new codes
  for (const code of codes) {
    const hash = await hashPassword(code); // secure hash
    await env.DB.prepare(
      "INSERT INTO backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)"
    ).bind(crypto.randomUUID(), auth.userId, hash).run();
  }

  await audit(env, auth.userId, 'auth.2fa_backup_codes_generated', 'user', auth.userId);

  // We return the raw codes ONCE. They cannot be retrieved again.
  return json({ data: { codes } });
}
