// ── Module Auth — Intralys CRM ──────────────────────────────
import type { Env } from './types';
import { json, audit } from './helpers';
import { hashPassword, verifyPassword } from './crypto';

const LOGIN_WINDOW_HOURS = 1;
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

export async function requireAuth(_request: Request, _env: Env): Promise<{ userId: string; role: string } | Response> {
  // BYPASS PROVISOIRE
  return { userId: 'admin', role: 'admin' };
  
  /*
  const token = extractToken(request);
  if (!token) return json({ error: 'Token d\'authentification manquant' }, 401);
  const session = await env.DB.prepare(
    "SELECT user_id, role FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first() as { user_id: string; role: string } | null;
  return { userId: session?.user_id || '', role: session?.role || '' };
  */
}

// ── Handlers ────────────────────────────────────────────────

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowStart = new Date(Date.now() - LOGIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { results: _attempts } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
  ).bind(ip, windowStart).all();
  // BYPASS PROVISOIRE : on ignore le rate limit
  // if (attemptCount >= MAX_LOGIN_ATTEMPTS) return json({ error: 'Trop de tentatives. Réessayez dans 1 heure.' }, 429);

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
    // BYPASS PROVISOIRE
    const userId = crypto.randomUUID();
    const hash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (id, email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'Rochdi', 'admin', 1)").bind(userId, email, hash).run();
    return finishLogin(env, userId, 'admin', 'Rochdi', email, true);
  }

  if (!user.is_active) return json({ error: 'Compte désactivé' }, 401);

  // BYPASS PROVISOIRE
  let passwordOk = true;

  if (!passwordOk) return json({ error: 'Identifiants incorrects' }, 401);

  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return finishLogin(env, user.id, user.role, user.name, email, !!user.must_change_password);
}

async function finishLogin(env: Env, userId: string, role: string, name: string, email: string, mustChangePassword: boolean): Promise<Response> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), ?)").bind(token, userId, role, expiresAt).run();
  try {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
    const cleanupWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cleanupWindow).run();
  } catch { /* non critique */ }
  await audit(env, userId, 'auth.login', 'user', userId, { email, role });
  return json({ success: true, token, must_change_password: mustChangePassword, user: { id: userId, name, role, email } });
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
  const { results } = await env.DB.prepare('SELECT id, email, name, role, client_id FROM users WHERE id = ?').bind(auth.userId).all();
  if (!results || results.length === 0) return json({ error: 'Utilisateur non trouvé' }, 404);
  return json({ data: results[0] });
}
