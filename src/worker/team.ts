import type { Env } from './types';
import type { TenantContext } from './tenant-context';
import { json, sanitizeInput, audit } from './helpers';
import { Resend } from 'resend';
import { hashPassword } from './crypto';
import { finishLogin } from './auth';
import { requireCapability, type Capability } from './capabilities';

// ── LOT TEAM B-bis — garde de capability CONDITIONNELLE (mode-agence-only) ───
// Enforce UNIQUEMENT si l'auth porte un contexte agence (tenant.agencyId !=
// null) ET un set capabilities (injecté choke-point worker.ts:607). Legacy/
// mono-tenant, suites teamA-* (auth construit sans .capabilities) ⇒ condition
// FALSE ⇒ skip ⇒ comportement BYTE-IDENTIQUE. N'ALTÈRE AUCUNE logique LOT A
// (figée) : ajout du SEUL bloc early-return en tête de handler.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> } | undefined,
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

// ── LOT TEAM A (2026-05-18) — fix fuite isolation + cycle invitation ─────────
// CONTRAT §6 figé : voir docs/LOT-TEAM-A.md (recopié verbatim).
//
// Invariant DUR de rétro-compatibilité (CONTRAT §6.A) :
//   Un appel SANS contexte agence (auth.tenant absent OU auth.tenant.agencyId
//   == null = legacy/mono-tenant) doit produire un comportement
//   BYTE-IDENTIQUE à l'ancien code (SELECT plein scope LIMIT 50, UPDATE/DELETE
//   sans garde tenant). L'isolation n'est ACTIVE que pour un tenant agence
//   (agencyId != null) — par construction inexistant avant le LOT 1.
//
// S4 M3 — acteur de l'audit dérivé du header X-User-Id (convention historique
// de ce fichier), conservé en fallback si `auth` non fourni (route publique).
function auditActor(request: Request, auth?: TeamAuth): string {
  return auth?.userId || request.headers.get('X-User-Id') || 'system';
}

// Auth enrichi tel que produit au choke-point worker.ts:589
// (authCtx = { ...auth, clientId?, tenant }). `tenant` best-effort : absent =
// legacy strict (jamais de throw côté resolveTenantContext).
export interface TeamAuth {
  userId: string;
  role: string;
  clientId?: string;
  tenant?: TenantContext;
}

// SHA-256 hex (Web Crypto, runtime Workers) — sert au hash du token
// d'invitation. Le token CLAIR n'est JAMAIS persisté ni loggé.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mapping rôle PME générique -> rôle technique users.role (CHECK seq 59 :
// role IN ('admin','broker','store_manager')). On n'insère JAMAIS un rôle
// générique dans users.role. viewer (lecture seule, géré par permissions
// LOT B) retombe sur le rôle technique le plus restreint disponible.
function genericToLegacyRole(generic: string): string {
  switch (generic) {
    case 'owner':
      return 'admin';
    case 'manager':
      return 'broker';
    case 'member':
    case 'viewer':
    default:
      return 'store_manager';
  }
}

const VALID_GENERIC_ROLES = ['owner', 'manager', 'member', 'viewer'] as const;

// Vrai si l'appel est en mode legacy/mono-tenant (CONTRAT §6.A) : aucune
// résolution de tenant agence ⇒ comportement historique byte-identique.
function isLegacy(auth?: TeamAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

// ── GET /api/team/users ─────────────────────────────────────────────────────
// CONTRAT §6.A — legacy byte-identique ; agence : bornée
// (agency_id du tenant OU client_id ∈ accessibleClientIds).
export async function handleGetUsers(
  _request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  if (isLegacy(auth)) {
    // Legacy/mono-tenant : comportement historique. On tente d'inclure les
    // colonnes additives (role_generic/last_login_at) ; si la migration 79
    // n'est pas jouée, fallback SELECT minimal = BYTE-IDENTIQUE à l'ancien
    // code (pattern tenant-context.ts:72-83).
    try {
      const { results } = await env.DB.prepare(
        'SELECT id, name, email, role, role_generic, last_login_at, created_at FROM users LIMIT 50',
      ).all();
      return json({ data: results || [] });
    } catch {
      const { results } = await env.DB.prepare(
        'SELECT id, name, email, role, created_at FROM users LIMIT 50',
      ).all();
      return json({ data: results || [] });
    }
  }

  // Tenant agence : isolation DURE. Visible = users de l'agence courante OU
  // des sous-comptes accessibles. agency_id peut être absent pré-migration 78
  // ⇒ try/catch fallback minimal borné aux seuls accessibleClientIds.
  const agencyId = auth!.tenant!.agencyId as string;
  const accessible = auth!.tenant!.accessibleClientIds || [];
  const placeholders = accessible.map(() => '?').join(',');
  try {
    const sql = placeholders
      ? `SELECT id, name, email, role, role_generic, last_login_at, created_at FROM users WHERE agency_id = ? OR client_id IN (${placeholders}) LIMIT 50`
      : 'SELECT id, name, email, role, role_generic, last_login_at, created_at FROM users WHERE agency_id = ? LIMIT 50';
    const { results } = await env.DB.prepare(sql)
      .bind(agencyId, ...accessible)
      .all();
    return json({ data: results || [] });
  } catch {
    // agency_id/role_generic absents : on ne fuit RIEN — on borne au seul
    // périmètre sous-comptes accessibles (jamais de SELECT plein scope).
    if (!placeholders) return json({ data: [] });
    const { results } = await env.DB.prepare(
      `SELECT id, name, email, role, created_at FROM users WHERE client_id IN (${placeholders}) LIMIT 50`,
    )
      .bind(...accessible)
      .all();
    return json({ data: results || [] });
  }
}

// ── POST /api/team/invites ──────────────────────────────────────────────────
// CONTRAT §6.B — crée user_invitations (token hashé), email Resend RÉEL.
// PLUS d'INSERT users ici (le mock password_hash='PENDING_INVITE' est SUPPRIMÉ).
export async function handleInviteUser(
  request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  const cg = capGuard(auth as never, 'team.manage');
  if (cg) return cg;
  const body = (await request.json()) as any;
  const email = sanitizeInput(body.email).toLowerCase();
  const roleRaw = sanitizeInput(body.role) || 'member';
  const role = (VALID_GENERIC_ROLES as readonly string[]).includes(roleRaw)
    ? roleRaw
    : 'member';
  // name de l'invité (capturé au body mais consommé seulement à l'acceptation)
  sanitizeInput(body.name);
  const scope = sanitizeInput(body.scope) === 'subaccount' ? 'subaccount' : 'agency';
  const message = sanitizeInput(body.message);

  if (!email || !email.includes('@')) {
    return json({ error: 'Email invalide' }, 400);
  }

  // Tenant agence requis pour inviter. (Legacy/mono-tenant n'a pas d'agence
  // ⇒ agencyId résolu null : on borne quand même via tenant si dispo.)
  const agencyId = auth?.tenant?.agencyId ?? null;
  const accessible = auth?.tenant?.accessibleClientIds || [];

  let clientId: string | null = null;
  if (scope === 'subaccount') {
    clientId = sanitizeInput(body.client_id) || null;
    if (!clientId || !accessible.includes(clientId)) {
      return json({ error: 'Sous-compte non autorisé', code: 'INVALID_SCOPE' }, 400);
    }
  }

  // Vérifier si l'utilisateur existe déjà (message verbatim conservé).
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) {
    return json({ error: 'Cet utilisateur existe déjà' }, 400);
  }

  const id = crypto.randomUUID();
  // Token clair (256 bits) — NE JAMAIS persister. Seul son SHA-256 va en base.
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    `INSERT INTO user_invitations
       (id, email, agency_id, scope, client_id, role, token_hash, status, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now','+7 days'), datetime('now'))`,
  )
    .bind(id, email, agencyId, scope, clientId, role, tokenHash, auth?.userId ?? null)
    .run();

  // Email Resend RÉEL (pattern workflows.ts:552). Garde-fou identique : si la
  // clé n'est pas configurée, on log et on continue (l'invitation existe en
  // base, le lien pourra être renvoyé via /resend).
  const acceptUrl = `/invite/accept?token=${token}`;
  if (!env.RESEND_API_KEY) {
    console.log(
      `[Resend] RESEND_API_KEY absente — invitation ${id} créée, email NON envoyé (${email})`,
    );
  } else {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [email],
        subject: 'Vous êtes invité·e à rejoindre Intralys CRM',
        html: `<p>Bonjour,</p><p>Vous avez été invité·e à rejoindre l'équipe sur Intralys CRM.</p>${
          message ? `<p>${message}</p>` : ''
        }<p><a href="${acceptUrl}">Accepter l'invitation</a></p><p>Ce lien expire dans 7 jours.</p>`,
      });
    } catch (err) {
      console.error('Team invite email failed:', err);
    }
  }

  await audit(env, auditActor(request, auth), 'user.invite', 'user_invitation', id, {
    email,
    role,
    scope,
    clientId,
  });
  return json({ data: { success: true, message: 'Invitation envoyée avec succès' } }, 201);
}

// ── POST /api/team/invites/accept (PUBLIC — pré-requireAuth) ────────────────
// CONTRAT §6.B — sécurité = token hashé + expiration + single-use seuls
// (par design, pas de session requise). Succès = finishLogin (contrat Lot1 §6.5).
export async function handleAcceptInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const ua = request.headers.get('User-Agent') || 'Unknown Browser';

  const body = (await request.json()) as any;
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = sanitizeInput(body.name);

  if (!token) return json({ error: 'Invitation invalide ou expirée', code: 'INVALID_INVITE' }, 400);
  if (!password || password.length < 12) {
    return json({ error: 'Mot de passe trop court (min 12 caractères)' }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const invite = (await env.DB.prepare(
    `SELECT id, email, agency_id, scope, client_id, role
       FROM user_invitations
      WHERE token_hash = ? AND status = 'pending' AND expires_at > datetime('now')`,
  )
    .bind(tokenHash)
    .first()) as
    | {
        id: string;
        email: string;
        agency_id: string | null;
        scope: string;
        client_id: string | null;
        role: string;
      }
    | null;

  if (!invite) {
    return json({ error: 'Invitation invalide ou expirée', code: 'INVALID_INVITE' }, 400);
  }

  // Garde anti-collision : si un user a été créé entre-temps avec cet email.
  const dup = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(invite.email)
    .first();
  if (dup) {
    return json({ error: 'Cet utilisateur existe déjà' }, 400);
  }

  const legacyRole = genericToLegacyRole(invite.role);
  const finalName = name || invite.email.split('@')[0] || invite.email;
  const userId = crypto.randomUUID();
  const pwHash = await hashPassword(password);

  // users.role = rôle technique CHECK-valide UNIQUEMENT. role_generic =
  // rôle PME de l'invitation. JAMAIS de générique dans users.role.
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, role, role_generic, password_hash, client_id, agency_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      finalName,
      invite.email,
      legacyRole,
      invite.role,
      pwHash,
      invite.scope === 'subaccount' ? invite.client_id : null,
      invite.agency_id,
    )
    .run();

  // Jonction sous-comptes (table user_sub_accounts seq 78).
  if (invite.scope === 'subaccount' && invite.client_id) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_sub_accounts (id, user_id, client_id, role)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, invite.client_id, invite.role)
      .run();
  } else if (invite.scope === 'agency' && invite.agency_id) {
    // Agence : accès à TOUS les sous-comptes de l'agence.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_sub_accounts (id, user_id, client_id, role)
       SELECT lower(hex(randomblob(16))), ?, c.id, ?
         FROM clients c WHERE c.agency_id = ?`,
    )
      .bind(userId, invite.role, invite.agency_id)
      .run();
  }

  await env.DB.prepare(
    "UPDATE user_invitations SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?",
  )
    .bind(invite.id)
    .run();

  await audit(env, userId, 'user.invite.accept', 'user_invitation', invite.id, {
    email: invite.email,
    role: invite.role,
    scope: invite.scope,
  });

  // Succès = format IDENTIQUE à finishLogin (contrat Lot1 §6.5).
  return finishLogin(env, userId, legacyRole, finalName, invite.email, false, ip, ua);
}

// ── POST /api/team/invites/:id/revoke ───────────────────────────────────────
export async function handleRevokeInvitation(
  request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  const cg = capGuard(auth as never, 'team.manage');
  if (cg) return cg;
  const url = new URL(request.url);
  const inviteId = url.pathname.split('/').slice(-2)[0] || '';
  const agencyId = auth?.tenant?.agencyId ?? null;

  await env.DB.prepare(
    "UPDATE user_invitations SET status = 'revoked' WHERE id = ? AND agency_id = ? AND status IN ('pending','expired')",
  )
    .bind(inviteId, agencyId)
    .run();

  await audit(env, auditActor(request, auth), 'user.invite.revoke', 'user_invitation', inviteId);
  return json({ data: { success: true } });
}

// ── POST /api/team/invites/:id/resend ───────────────────────────────────────
// Régénère token + hash, repousse l'expiration +7j, repasse en 'pending'.
export async function handleResendInvitation(
  request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  const cg = capGuard(auth as never, 'team.manage');
  if (cg) return cg;
  const url = new URL(request.url);
  const inviteId = url.pathname.split('/').slice(-2)[0] || '';
  const agencyId = auth?.tenant?.agencyId ?? null;

  const invite = (await env.DB.prepare(
    `SELECT id, email FROM user_invitations
      WHERE id = ? AND agency_id = ? AND status IN ('pending','expired')`,
  )
    .bind(inviteId, agencyId)
    .first()) as { id: string; email: string } | null;

  if (!invite) {
    return json({ error: 'Invitation invalide ou expirée', code: 'INVALID_INVITE' }, 400);
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    "UPDATE user_invitations SET token_hash = ?, status = 'pending', expires_at = datetime('now','+7 days') WHERE id = ?",
  )
    .bind(tokenHash, invite.id)
    .run();

  const acceptUrl = `/invite/accept?token=${token}`;
  if (!env.RESEND_API_KEY) {
    console.log(
      `[Resend] RESEND_API_KEY absente — invitation ${invite.id} régénérée, email NON renvoyé`,
    );
  } else {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [invite.email],
        subject: 'Rappel : votre invitation Intralys CRM',
        html: `<p>Bonjour,</p><p>Voici à nouveau votre invitation à rejoindre Intralys CRM.</p><p><a href="${acceptUrl}">Accepter l'invitation</a></p><p>Ce lien expire dans 7 jours.</p>`,
      });
    } catch (err) {
      console.error('Team invite resend email failed:', err);
    }
  }

  await audit(env, auditActor(request, auth), 'user.invite.resend', 'user_invitation', invite.id);
  return json({ data: { success: true } });
}

// ── PATCH /api/team/users/:id ───────────────────────────────────────────────
// CONTRAT §6.A — legacy byte-identique ; agence : garde tenant minimale.
export async function handleUpdateUserRole(
  request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  const cg = capGuard(auth as never, 'team.manage');
  if (cg) return cg;
  const url = new URL(request.url);
  const userId = url.pathname.split('/').pop() || '';
  const body = (await request.json()) as any;
  const newRole = sanitizeInput(body.role);

  if (!newRole) return json({ error: 'Rôle manquant' }, 400);

  if (!isLegacy(auth)) {
    const guard = await assertTargetInTenant(env, userId, auth!);
    if (guard) return guard;
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(newRole, userId).run();
  await audit(env, auditActor(request, auth), 'user.role_change', 'user', userId, {
    role: newRole,
  });
  return json({ data: { success: true } });
}

// ── DELETE /api/team/users/:id ──────────────────────────────────────────────
export async function handleDeleteUser(
  request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  const cg = capGuard(auth as never, 'team.manage');
  if (cg) return cg;
  const url = new URL(request.url);
  const userId = url.pathname.split('/').pop() || '';

  if (!isLegacy(auth)) {
    const guard = await assertTargetInTenant(env, userId, auth!);
    if (guard) return guard;
  }

  // Hard delete pour le MVP (comportement legacy conservé).
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  await audit(env, auditActor(request, auth), 'user.remove', 'user', userId);
  return json({ data: { success: true } });
}

// Garde tenant minimale : la cible doit appartenir au périmètre agence.
// Renvoie une Response 404 (NOT_FOUND) si hors périmètre, sinon undefined.
async function assertTargetInTenant(
  env: Env,
  targetUserId: string,
  auth: TeamAuth,
): Promise<Response | undefined> {
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  let target: { agency_id: string | null; client_id: string | null } | null = null;
  try {
    target = (await env.DB.prepare('SELECT agency_id, client_id FROM users WHERE id = ?')
      .bind(targetUserId)
      .first()) as { agency_id: string | null; client_id: string | null } | null;
  } catch {
    // agency_id absent pré-migration 78 : fallback client_id seul.
    try {
      const t2 = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
        .bind(targetUserId)
        .first()) as { client_id: string | null } | null;
      target = t2 ? { agency_id: null, client_id: t2.client_id } : null;
    } catch {
      target = null;
    }
  }

  const inTenant =
    !!target &&
    ((target.client_id != null && accessible.includes(target.client_id)) ||
      (target.agency_id != null && target.agency_id === agencyId));

  if (!inTenant) {
    return json({ error: 'Utilisateur introuvable', code: 'NOT_FOUND' }, 404);
  }
  return undefined;
}

// ── GET /api/team/invites ───────────────────────────────────────────────────
// CONTRAT §6.B (docs/LOT-TEAM-BC.md) — liste les invitations, bornée tenant
// EXACTEMENT comme handleGetUsers mode agence (legacy/mono-tenant = scope
// complet byte-identique à l'absence de garde ; agence = WHERE agency_id).
// Réponse succès : { data: [...] } (pattern handleGetUsers).
//
// ⚠ État : IMPLÉMENTÉ. Signature `(request, env, auth?)` + endpoint + contrat
//   de réponse (§6.B) figés. Corps réel en place (legacy : SELECT ... FROM
//   user_invitations LIMIT 50 ; agence : WHERE agency_id = auth.tenant.agencyId).
export async function handleListInvitations(
  _request: Request,
  env: Env,
  auth?: TeamAuth,
): Promise<Response> {
  // Pattern EXACT handleGetUsers : legacy = scope complet LIMIT 50
  // byte-équivalent à l'absence de garde (endpoint NEUF) ; agence = WHERE
  // agency_id borné. try/catch best-effort : table seq 79 absente → { data:[] }
  // (jamais de throw, jamais de fuite).
  try {
    if (isLegacy(auth)) {
      const { results } = await env.DB.prepare(
        `SELECT id, email, role, scope, client_id, status, expires_at, created_at
           FROM user_invitations
          ORDER BY created_at DESC LIMIT 50`,
      ).all();
      return json({ data: results || [] });
    }

    const agencyId = auth!.tenant!.agencyId as string;
    const { results } = await env.DB.prepare(
      `SELECT id, email, role, scope, client_id, status, expires_at, created_at
         FROM user_invitations
        WHERE agency_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(agencyId)
      .all();
    return json({ data: results || [] });
  } catch {
    // Table seq 79 absente / panne D1 : aucune régression (endpoint NEUF).
    return json({ data: [] });
  }
}

// ── GET /api/team/roles ─────────────────────────────────────────────────────
// 4 rôles PME génériques en dur (mapping VERROUILLÉ owner/manager/member/
// viewer). Signature ÉLARGIE `(request, env, auth?)` (§6.E). État : IMPLÉMENTÉ —
// le corps joint les capabilities lues de `role_capabilities` (seq 80) à chaque
// rôle (enrichissement best-effort). Rétro-compatible : table absente → 4 rôles
// is_system:true avec capabilities:[].
export async function handleGetRoles(
  _request: Request,
  env: Env,
  _auth?: TeamAuth,
): Promise<Response> {
  const roles: {
    id: string;
    name: string;
    description: string;
    is_system: boolean;
    capabilities: string[];
  }[] = [
    { id: 'owner', name: 'Propriétaire', description: 'Accès complet à l’organisation', is_system: true, capabilities: [] },
    { id: 'manager', name: 'Gestionnaire', description: 'Gère l’équipe et les opérations', is_system: true, capabilities: [] },
    { id: 'member', name: 'Membre', description: 'Accès standard aux dossiers', is_system: true, capabilities: [] },
    { id: 'viewer', name: 'Observateur', description: 'Lecture seule', is_system: true, capabilities: [] },
  ];

  // Enrichissement best-effort : capabilities lues de role_capabilities
  // (seq 80). Table absente / panne D1 → capabilities:[] (rétro-compat,
  // JAMAIS de throw — endpoint déjà gardé, contrat §6.E).
  try {
    const { results } = await env.DB.prepare(
      'SELECT role_generic, capability FROM role_capabilities',
    ).all();
    const byRole = new Map<string, string[]>();
    for (const r of results || []) {
      const row = r as { role_generic: string | null; capability: string | null };
      if (typeof row.role_generic !== 'string' || !row.role_generic) continue;
      if (typeof row.capability !== 'string' || !row.capability) continue;
      const list = byRole.get(row.role_generic) || [];
      list.push(row.capability);
      byRole.set(row.role_generic, list);
    }
    for (const role of roles) {
      role.capabilities = byRole.get(role.id) || [];
    }
  } catch {
    // role_capabilities (seq 80) non jouée : 4 rôles sans capabilities
    // (rétro-compat — TeamRoleWithCaps.capabilities optionnel/[]).
  }

  return json({ data: roles });
}
