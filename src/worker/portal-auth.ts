// ── portal-auth.ts — LOT PORTAL-E (Sprint E) ────────────────────────────────
//
// Auth du PORTAIL CLIENT 100% SÉPARÉE du CRM ET de l'espace membre.
// `requirePortalUser` lit `portal_sessions` UNIQUEMENT — JAMAIS `admin_sessions`
// / `users` / `requireAuth`, JAMAIS `member_sessions` / `members`. Calque EXACT
// member-auth.ts (lui-même calque auth.ts:finishLogin + api-public-auth.ts:
// requireApiKey) : token crypto.randomUUID(), INSERT portal_sessions, password
// via crypto.ts:hashPassword/verifyPassword (pbkdf2 EXISTANT RÉUTILISÉ). Le
// tenant est résolu via `portal_sites.slug` (calque membership_sites). Fichier
// NEUF et ISOLÉ — n'étend NI auth.ts NI member-auth.ts.
//
// ⚠ ISOLATION DOUBLE (§6.A/§6.C) : le contexte PortalContext injecte LE lead_id
//   ET le client_id de la session. Les 5 agrégateurs (Phase B) bornent CHAQUE
//   SELECT `WHERE lead_id = ctx.leadId AND client_id = ctx.clientId` — JAMAIS
//   depuis le body/query. Isolation cross-lead ET cross-tenant.
//
// ⚠ AUCUN PAIEMENT (E4) — la facture est LECTURE SEULE côté portail.
//
// ⚠ DÉCOUPAGE (§6.G) : Phase A SOLO pose les CORPS RÉELS de l'auth (login /
//   set-password / logout + requirePortalUser — c'est de l'auth standard,
//   calque member). Les 5 agrégateurs (portal.ts) + handlePortalCreateTicket +
//   la config PRO sont IMPLÉMENTÉS (corps réels présents). Les
//   signatures (ordre/typage des params, forme de la Response, contrat du
//   contexte) NE CHANGENT PAS : worker.ts (GELÉ Phase A) câble déjà ces
//   handlers ; src/lib/api.ts (GELÉ Phase A) appelle les endpoints. Contrat
//   §6 verbatim dans docs/LOT-PORTAL-E.md.
//
// Conventions imposées (docs/LOT-PORTAL-E.md §6.A/§6.C/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - Login succès : json({ data: { token, portalUser: { id, email, name } } }).
//   - `requirePortalUser` : Bearer header (→ ?token=) → lookup portal_sessions
//     (token + expires_at > now) JOIN portal_users → PortalContext typé, sinon
//     Response 401. NE LIT JAMAIS admin_sessions / users / members.
//   - Tenant : résolu via portal_sites.slug (slug → client_id/agency_id).
//   - best-effort : table seq 101 absente → réponse propre (401/{error}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json } from './helpers';
import { hashPassword, verifyPassword } from './crypto';

// Durée d'une session portail — calque member-auth.ts:35 (72h).
const PORTAL_SESSION_HOURS = 72;

// Contexte d'auth portail injecté par `requirePortalUser`. ISOLATION DOUBLE :
// leadId (agrégation) + clientId (tenant) bornent chaque lecture côté handler.
export interface PortalContext {
  portalUserId: string;
  leadId: string;
  clientId: string;
  agencyId: string;
}

// Extrait le token portail : header `Authorization: Bearer <token>` en priorité,
// sinon `?token=` en query (calque EXACT member-auth.ts:extractMemberToken — la
// signature de document via balise/lien peut ne pas envoyer de header).
function extractPortalToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.replace('Bearer ', '').trim();
    if (t) return t;
  }
  try {
    const q = new URL(request.url).searchParams.get('token');
    if (q && q.trim()) return q.trim();
  } catch {
    /* URL invalide : best-effort, pas de token */
  }
  return null;
}

// Résout le tenant d'un portail via son slug (calque EXACT member-auth.ts:
// resolveSiteTenant — SELECT slug actif → tenant). Retourne { clientId, agencyId }
// ou null (site absent/inactif/table seq 101 absente).
async function resolvePortalSiteTenant(
  env: Env,
  slug: string,
): Promise<{ clientId: string; agencyId: string | null } | null> {
  if (!slug) return null;
  try {
    const site = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM portal_sites WHERE slug = ? AND is_active = 1 LIMIT 1',
    )
      .bind(slug)
      .first()) as { client_id: string | null; agency_id: string | null } | null;
    if (!site || site.client_id == null) return null;
    return { clientId: site.client_id, agencyId: site.agency_id ?? null };
  } catch {
    // Table seq 101 absente : best-effort → tenant introuvable.
    return null;
  }
}

// ── requirePortalUser ─────────────────────────────────────────────────────────
// Contrat (FIGÉ §6.C) : lit le header Authorization: Bearer <token> (OU ?token=),
// résout le token dans `portal_sessions` (token = ? AND expires_at > now), joint
// `portal_users` pour lead_id/client_id/agency_id, retourne PortalContext
// { portalUserId, leadId, clientId, agencyId } ou une Response 401 si token
// manquant/invalide/expiré ou compte non actif. NE LIT JAMAIS admin_sessions /
// users / members / member_sessions. Calque EXACT member-auth.ts:requireMember.
export async function requirePortalUser(
  request: Request,
  env: Env,
): Promise<Response | PortalContext> {
  const token = extractPortalToken(request);
  if (!token) {
    return json({ error: 'Session portail invalide ou expirée' }, 401);
  }

  try {
    // Lookup portal_sessions UNIQUEMENT — jointure applicative portal_users pour
    // lead_id/client_id/agency_id (zéro FK, calque member-auth.ts:105).
    const row = (await env.DB.prepare(
      `SELECT s.portal_user_id AS portal_user_id, p.lead_id AS lead_id,
              p.client_id AS client_id, p.agency_id AS agency_id, p.status AS status
         FROM portal_sessions s
         JOIN portal_users p ON p.id = s.portal_user_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
        LIMIT 1`,
    )
      .bind(token)
      .first()) as {
      portal_user_id: string;
      lead_id: string | null;
      client_id: string | null;
      agency_id: string | null;
      status: string | null;
    } | null;

    if (!row || !row.portal_user_id) {
      return json({ error: 'Session portail invalide ou expirée' }, 401);
    }
    if (row.status && row.status !== 'active') {
      return json({ error: 'Compte désactivé' }, 401);
    }

    return {
      portalUserId: row.portal_user_id,
      leadId: row.lead_id ?? '',
      clientId: row.client_id ?? '',
      agencyId: row.agency_id ?? '',
    };
  } catch {
    // Table seq 101 absente / panne D1 : best-effort → 401 propre, JAMAIS 500.
    return json({ error: 'Session portail invalide ou expirée' }, 401);
  }
}

// Crée une session portail (calque EXACT member-auth.ts:finishMemberLogin —
// token crypto.randomUUID(), INSERT portal_sessions ; SANS toucher auth.ts /
// member-auth.ts). Renvoie la Response succès format §6.C.
async function finishPortalLogin(
  request: Request,
  env: Env,
  portalUser: { id: string; email: string; name: string | null },
): Promise<Response> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + PORTAL_SESSION_HOURS * 3600_000,
  ).toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';

  await env.DB.prepare(
    `INSERT INTO portal_sessions (portal_user_id, token, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(portalUser.id, token, expiresAt, ip, ua)
    .run();

  // Cleanup best-effort des sessions expirées (non critique, jamais bloquant).
  try {
    await env.DB.prepare(
      "DELETE FROM portal_sessions WHERE expires_at < datetime('now')",
    ).run();
  } catch {
    /* non critique */
  }

  return json({
    data: {
      token,
      portalUser: { id: portalUser.id, email: portalUser.email, name: portalUser.name },
    },
  });
}

// ── handlePortalLogin ─────────────────────────────────────────────────────────
// POST /api/portal/:slug/login — body { email, password }.
// Contrat (FIGÉ §6.C) : résout le tenant via portal_sites.slug, charge
// `portal_users` (client_id du tenant + email), vérifie le mot de passe via
// crypto.ts:verifyPassword (pbkdf2), crée une session portail (token
// crypto.randomUUID(), INSERT portal_sessions). NE LIT JAMAIS users /
// admin_sessions / members.
// Succès : json({ data: { token, portalUser: { id, email, name } } }).
export async function handlePortalLogin(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = ((await request.json()) as typeof body) || {};
  } catch {
    body = {};
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400);
  }

  const tenant = await resolvePortalSiteTenant(env, slug);
  if (!tenant) {
    return json({ error: 'Portail introuvable' }, 404);
  }

  try {
    const portalUser = (await env.DB.prepare(
      `SELECT id, email, name, password_hash, status
         FROM portal_users WHERE client_id = ? AND email = ? LIMIT 1`,
    )
      .bind(tenant.clientId, email)
      .first()) as {
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
      status: string;
    } | null;

    if (!portalUser) {
      return json({ error: 'Identifiants incorrects' }, 401);
    }
    if (portalUser.status && portalUser.status !== 'active') {
      return json({ error: 'Compte désactivé' }, 401);
    }

    // verifyPassword RÉUTILISÉ depuis crypto.ts (pbkdf2 — JAMAIS dupliqué).
    const ok =
      !!portalUser.password_hash &&
      portalUser.password_hash.startsWith('pbkdf2$') &&
      (await verifyPassword(password, portalUser.password_hash));
    if (!ok) {
      return json({ error: 'Identifiants incorrects' }, 401);
    }

    return await finishPortalLogin(request, env, {
      id: portalUser.id,
      email: portalUser.email,
      name: portalUser.name,
    });
  } catch {
    // Table seq 101 absente / panne D1 : best-effort → réponse propre.
    return json({ error: 'Connexion portail indisponible' }, 503);
  }
}

// ── handlePortalSetPassword ───────────────────────────────────────────────────
// POST /api/portal/:slug/set-password — body { email, password }.
// Contrat (FIGÉ §6.C) : flux d'activation après invitation admin (provisioning
// §6.A/Q5). Résout le tenant via portal_sites.slug, charge `portal_users`
// (client_id du tenant + email), pose le password_hash (crypto.ts:hashPassword,
// pbkdf2 RÉUTILISÉ), réactive le compte ('active'), puis crée une session
// (calque finishPortalLogin). Pas d'auto-création : si l'email n'a pas été
// provisionné par l'admin, refus propre. NE TOUCHE JAMAIS users / members.
// Succès : json({ data: { token, portalUser: { id, email, name } } }).
export async function handlePortalSetPassword(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = ((await request.json()) as typeof body) || {};
  } catch {
    body = {};
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Mot de passe trop court (min 6 caractères)' }, 400);
  }

  const tenant = await resolvePortalSiteTenant(env, slug);
  if (!tenant) {
    return json({ error: 'Portail introuvable' }, 404);
  }

  try {
    // Le compte DOIT avoir été provisionné par l'admin (§6.A/Q5 — pas d'auto-
    // création). Borné client_id du tenant (isolation cross-tenant).
    const portalUser = (await env.DB.prepare(
      'SELECT id, email, name FROM portal_users WHERE client_id = ? AND email = ? LIMIT 1',
    )
      .bind(tenant.clientId, email)
      .first()) as { id: string; email: string; name: string | null } | null;

    if (!portalUser) {
      return json({ error: 'Aucune invitation pour cet email' }, 404);
    }

    // hashPassword RÉUTILISÉ depuis crypto.ts (pbkdf2 — JAMAIS dupliqué).
    const passwordHash = await hashPassword(password);
    await env.DB.prepare(
      "UPDATE portal_users SET password_hash = ?, status = 'active' WHERE id = ?",
    )
      .bind(passwordHash, portalUser.id)
      .run();

    return await finishPortalLogin(request, env, {
      id: portalUser.id,
      email: portalUser.email,
      name: portalUser.name,
    });
  } catch {
    // Table seq 101 absente / panne D1 : best-effort → réponse propre.
    return json({ error: 'Activation portail indisponible' }, 503);
  }
}

// ── handlePortalLogout ────────────────────────────────────────────────────────
// POST /api/portal/:slug/logout — supprime la session courante
// (DELETE FROM portal_sessions WHERE token = ? — calque member-auth.ts:
// handleMemberLogout). Best-effort, toujours { data: { success: true } }.
export async function handlePortalLogout(
  request: Request,
  env: Env,
  _slug: string,
): Promise<Response> {
  const token = extractPortalToken(request);
  if (token) {
    try {
      await env.DB.prepare('DELETE FROM portal_sessions WHERE token = ?')
        .bind(token)
        .run();
    } catch {
      // best-effort : table absente / panne → on renvoie quand même succès.
    }
  }
  return json({ data: { success: true } });
}
