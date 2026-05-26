// ── member-auth.ts — LOT MEMBERSHIPS (Sprint 6) ────────────────────────────
//
// Auth membre 100% SÉPARÉE du CRM. `requireMember` lit `member_sessions`
// UNIQUEMENT — JAMAIS `admin_sessions` / `users` / `requireAuth`. Le login
// membre est un calque EXACT de auth.ts:finishLogin (token
// crypto.randomUUID(), INSERT member_sessions) + password via
// crypto.ts:hashPassword (pbkdf2 EXISTANT RÉUTILISÉ). Le tenant est résolu
// via `membership_sites.slug` (calque funnels.ts:693 handlePublicFunnelGet +
// table funnel_publications). Fichier NEUF et ISOLÉ — n'étend PAS auth.ts.
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response, contrat du contexte
//   retourné) NE CHANGENT PAS : worker.ts (GELÉ Phase A) câble déjà ces
//   handlers ; src/lib/api.ts (GELÉ Phase A) appelle les endpoints. Contrat
//   §6 verbatim dans docs/LOT-MEMBER6.md (Phase B/C ne lisent QUE ce
//   document + le CODE).
//
// Conventions imposées (docs/LOT-MEMBER6.md §6.A/§6.C/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Login succès : json({ data: { token, member: { id, email, name } } }).
//   - `requireMember` : calque EXACT api-public-auth.ts:requireApiKey —
//     Bearer header → lookup member_sessions (token + expires_at > now) →
//     contexte typé MemberContext, sinon Response 401. NE LIT JAMAIS
//     admin_sessions / users.
//   - Tenant : résolu via membership_sites.slug (slug → client_id/agency_id).
//   - best-effort : table seq 87 absente → réponse propre (401/{error}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json } from './helpers';
import { hashPassword, verifyPassword } from './crypto';

// Durée d'une session membre — calque auth.ts:8 SESSION_DURATION_HOURS (72h).
const MEMBER_SESSION_HOURS = 72;

// Contexte d'auth membre injecté par `requireMember` (calque
// PublicAuthContext de api-public-auth.ts — DISTINCT, namespace membre).
export interface MemberContext {
  memberId: string;
  clientId: string;
  agencyId: string;
}

// Extrait le token membre : header `Authorization: Bearer <token>` en
// priorité, sinon `?token=` en query (la route vidéo `<video>` n'envoie pas
// de header Authorization — calque pattern WS worker.ts:603 ; §6.C/§6.E).
function extractMemberToken(request: Request): string | null {
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

// Résout le tenant d'un espace membre via son slug (calque EXACT
// funnels.ts:702 funnel_publications — SELECT slug actif → tenant). Retourne
// { clientId, agencyId } ou null (site absent/inactif/table seq 87 absente).
async function resolveSiteTenant(
  env: Env,
  slug: string,
): Promise<{ clientId: string; agencyId: string | null } | null> {
  if (!slug) return null;
  try {
    const site = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM membership_sites WHERE slug = ? AND is_active = 1 LIMIT 1',
    )
      .bind(slug)
      .first()) as { client_id: string | null; agency_id: string | null } | null;
    if (!site || site.client_id == null) return null;
    return { clientId: site.client_id, agencyId: site.agency_id ?? null };
  } catch {
    // Table seq 87 absente : best-effort → tenant introuvable.
    return null;
  }
}

// ── requireMember ───────────────────────────────────────────────────────────
// Contrat (FIGÉ §6.C) : lit le header Authorization: Bearer <token> (OU
// ?token= pour la vidéo), résout le token dans `member_sessions`
// (token = ? AND expires_at > datetime('now')), joint `members` pour
// client_id/agency_id, retourne MemberContext { memberId, clientId, agencyId }
// ou une Response 401 si token manquant/invalide/expiré. NE LIT JAMAIS
// admin_sessions / users / requireAuth. Calque EXACT
// api-public-auth.ts:requireApiKey (Bearer → lookup table → contexte typé).
export async function requireMember(
  request: Request,
  env: Env,
): Promise<Response | MemberContext> {
  const token = extractMemberToken(request);
  if (!token) {
    return json({ error: 'Session membre invalide ou expirée' }, 401);
  }

  try {
    // Lookup member_sessions UNIQUEMENT — jointure applicative members pour
    // client_id/agency_id (zéro FK, calque api-public-auth.ts:32-34).
    const row = (await env.DB.prepare(
      `SELECT s.member_id AS member_id, m.client_id AS client_id, m.agency_id AS agency_id
         FROM member_sessions s
         JOIN members m ON m.id = s.member_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
        LIMIT 1`,
    )
      .bind(token)
      .first()) as {
      member_id: string;
      client_id: string | null;
      agency_id: string | null;
    } | null;

    if (!row || !row.member_id) {
      return json({ error: 'Session membre invalide ou expirée' }, 401);
    }

    return {
      memberId: row.member_id,
      clientId: row.client_id ?? '',
      agencyId: row.agency_id ?? '',
    };
  } catch {
    // Table seq 87 absente / panne D1 : best-effort → 401 propre, JAMAIS 500.
    return json({ error: 'Session membre invalide ou expirée' }, 401);
  }
}

// Crée une session membre (calque EXACT auth.ts:120 finishLogin — token
// crypto.randomUUID(), INSERT member_sessions ; SANS toucher auth.ts /
// admin_sessions). Renvoie la Response succès format §6.C.
async function finishMemberLogin(
  request: Request,
  env: Env,
  member: { id: string; email: string; name: string | null },
): Promise<Response> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + MEMBER_SESSION_HOURS * 3600_000,
  ).toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';

  await env.DB.prepare(
    `INSERT INTO member_sessions (member_id, token, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(member.id, token, expiresAt, ip, ua)
    .run();

  // Cleanup best-effort des sessions expirées (calque auth.ts:124 — non
  // critique, jamais bloquant pour l'auth membre).
  try {
    await env.DB.prepare(
      "DELETE FROM member_sessions WHERE expires_at < datetime('now')",
    ).run();
  } catch {
    /* non critique */
  }

  return json({
    data: { token, member: { id: member.id, email: member.email, name: member.name } },
  });
}

// Wiring CRM OPTIONNEL §6.G — best-effort APRÈS création membre/session.
// Résout/crée un lead borné client_id (RÉUTILISE le pipeline forms.ts :
// applyLeadMapping / resolveDedup / mergeIntoLead / logIngestConsent — ZÉRO
// dup dedup), pose members.lead_id, puis autoEnrollForTrigger('member_signup').
// TOUT échec est avalé : l'auth membre RESTE fonctionnelle, jamais couplée.
async function wireMemberLead(
  request: Request,
  env: Env,
  member: { id: string; email: string; name: string | null },
  clientId: string,
): Promise<void> {
  try {
    const { applyLeadMapping } = await import('./lead-mapping');
    const { logIngestConsent } = await import('./leads');
    const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');
    const { autoEnrollForTrigger } = await import('./workflows');

    const m = applyLeadMapping({} as Record<string, unknown>, null);
    const consentStatus =
      m.consent === true ? 'granted' : m.consent === false ? 'denied' : 'unknown';
    const attr = m.attribution;

    const decision = await resolveDedup(env, 'email_phone', {
      clientId,
      email: member.email,
      phone: '',
    });

    let leadId: string;
    if (decision.action !== 'create' && decision.existingId) {
      leadId = decision.existingId;
      if (decision.action === 'merge') {
        await mergeIntoLead(env, leadId, {
          name: member.name || '',
          ...attr,
        });
      }
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    } else {
      leadId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, source, status, pipeline_id, stage_id,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, consent_status)
         VALUES (?, ?, ?, ?, 'membership', 'new', 'pipeline-default', 'stage-new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          leadId,
          clientId,
          member.name || '',
          member.email,
          attr.utm_source,
          attr.utm_medium,
          attr.utm_campaign,
          attr.utm_term,
          attr.utm_content,
          attr.gclid,
          attr.fbclid,
          attr.referrer,
          consentStatus,
        )
        .run();
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    }

    // members.lead_id nullable — lien CRM OPTIONNEL, n'altère JAMAIS l'auth.
    await env.DB.prepare('UPDATE members SET lead_id = ? WHERE id = ?')
      .bind(leadId, member.id)
      .run();

    await autoEnrollForTrigger(env, 'member_signup', leadId);
  } catch {
    // best-effort §6.G : un échec lead ne bloque JAMAIS le membre. Les deux
    // systèmes d'auth ne sont jamais couplés.
  }
}

// ── handleMemberRegister ────────────────────────────────────────────────────
// POST /api/member/:slug/register — body { email, password, name? }.
// Contrat (FIGÉ §6.C) : résout le tenant via membership_sites.slug, refuse
// si email déjà pris pour ce tenant (idx_members_email client_id,email),
// hash via crypto.ts:hashPassword (pbkdf2 RÉUTILISÉ), INSERT `members`
// (status 'active'), puis crée une session (calque finishLogin). Wiring CRM
// OPTIONNEL §6.G — SANS coupler les auth.
// Succès : json({ data: { token, member: { id, email, name } } }).
export async function handleMemberRegister(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = ((await request.json()) as typeof body) || {};
  } catch {
    body = {};
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Mot de passe trop court (min 6 caractères)' }, 400);
  }

  const tenant = await resolveSiteTenant(env, slug);
  if (!tenant) {
    return json({ error: 'Espace membre introuvable' }, 404);
  }

  try {
    // Anti-doublon : email déjà pris pour ce tenant (idx_members_email).
    const existing = (await env.DB.prepare(
      'SELECT id FROM members WHERE client_id = ? AND email = ? LIMIT 1',
    )
      .bind(tenant.clientId, email)
      .first()) as { id: string } | null;
    if (existing) {
      return json({ error: 'Cet email est déjà utilisé' }, 409);
    }

    // hashPassword RÉUTILISÉ depuis crypto.ts (pbkdf2 — JAMAIS dupliqué).
    const passwordHash = await hashPassword(password);
    const memberId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO members (id, client_id, agency_id, email, password_hash, name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    )
      .bind(memberId, tenant.clientId, tenant.agencyId, email, passwordHash, name)
      .run();

    const member = { id: memberId, email, name };

    // Wiring CRM OPTIONNEL §6.G — best-effort, jamais couplé à l'auth.
    await wireMemberLead(request, env, member, tenant.clientId);

    return await finishMemberLogin(request, env, member);
  } catch {
    // Table seq 87 absente / panne D1 : best-effort → réponse propre.
    return json({ error: 'Inscription membre indisponible' }, 503);
  }
}

// ── handleMemberLogin ───────────────────────────────────────────────────────
// POST /api/member/:slug/login — body { email, password }.
// Contrat (FIGÉ §6.C) : résout le tenant via membership_sites.slug, charge
// `members` (client_id du tenant + email), vérifie le mot de passe via
// crypto.ts:verifyPassword (pbkdf2), crée une session membre (token
// crypto.randomUUID(), INSERT member_sessions — calque auth.ts:finishLogin
// SANS y toucher). NE LIT JAMAIS users / admin_sessions.
// Succès : json({ data: { token, member: { id, email, name } } }).
export async function handleMemberLogin(
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

  const tenant = await resolveSiteTenant(env, slug);
  if (!tenant) {
    return json({ error: 'Espace membre introuvable' }, 404);
  }

  try {
    const member = (await env.DB.prepare(
      `SELECT id, email, name, password_hash, status
         FROM members WHERE client_id = ? AND email = ? LIMIT 1`,
    )
      .bind(tenant.clientId, email)
      .first()) as {
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
      status: string;
    } | null;

    if (!member) {
      return json({ error: 'Identifiants incorrects' }, 401);
    }
    if (member.status && member.status !== 'active') {
      return json({ error: 'Compte désactivé' }, 401);
    }

    // verifyPassword RÉUTILISÉ depuis crypto.ts (pbkdf2 — JAMAIS dupliqué).
    const ok =
      !!member.password_hash &&
      member.password_hash.startsWith('pbkdf2$') &&
      (await verifyPassword(password, member.password_hash));
    if (!ok) {
      return json({ error: 'Identifiants incorrects' }, 401);
    }

    return await finishMemberLogin(request, env, {
      id: member.id,
      email: member.email,
      name: member.name,
    });
  } catch {
    // Table seq 87 absente / panne D1 : best-effort → réponse propre.
    return json({ error: 'Connexion membre indisponible' }, 503);
  }
}

// ── handleMemberLogout ──────────────────────────────────────────────────────
// POST /api/member/:slug/logout — supprime la session courante
// (DELETE FROM member_sessions WHERE token = ? — calque auth.ts:handleLogout
// SANS y toucher). Best-effort, toujours { data: { success: true } }.
export async function handleMemberLogout(
  request: Request,
  env: Env,
  _slug: string,
): Promise<Response> {
  const token = extractMemberToken(request);
  if (token) {
    try {
      await env.DB.prepare('DELETE FROM member_sessions WHERE token = ?')
        .bind(token)
        .run();
    } catch {
      // best-effort : table absente / panne → on renvoie quand même succès.
    }
  }
  return json({ data: { success: true } });
}
