// ── community.ts — LOT G10 Communauté membres (espace social) + commentaires
//    de leçons (2026-05-20) ───────────────────────────────────────────────────
//
// Espace SOCIAL derrière l'auth membre 100% SÉPARÉE (members / member_sessions
// seq 87, requireMember de member-auth.ts RÉUTILISÉ EN LECTURE — JAMAIS
// modifié). v1 RÉDUIT : (a) commentaires de leçons + (b) forum threads/posts
// PLATS. PAS de réactions (reactions.ts FRONT-ONLY interdit), PAS de badges/
// certifs (v2 ; le badge « cours complété » reste cosmétique FRONT dérivé de
// progress_pct). Fichier NEUF et ISOLÉ.
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS :
//   worker.ts (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ
//   Phase A) appelle les endpoints. Contrat §6 verbatim dans
//   docs/LOT-COMMUNITY-G10.md (Phase B/C ne lisent QUE ce document + le CODE).
//
// Conventions imposées (docs/LOT-COMMUNITY-G10.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - DEUX populations d'auth :
//       • MEMBRE (requireMember, member-auth.ts) → créer thread/poster/
//         commenter/lire + supprimer SON propre post/comment
//         (member_id == member.memberId). Handlers signés
//         (env, ..., member: MemberContext) — calque memberships.ts.
//       • PRO (requireAuth + capability 'workflows.manage') → modérer
//         (supprimer n'importe quel post/comment, pin/lock thread) borné
//         rowInTenant. Handlers signés (request, env, auth: CommunityAuth, ...)
//         — calque affiliates.ts. AUCUN ajout à ALL_CAPABILITIES.
//   - ISOLATION CROSS-SITE NON NÉGOCIABLE (FLAG #1) : à l'ÉCRITURE membre,
//     client_id = member.clientId (JAMAIS une valeur du body) ; à la LECTURE,
//     filtre WHERE client_id = member.clientId ; les routes par ID
//     RE-VÉRIFIENT row.client_id == member.clientId (membre) / rowInTenant
//     (PRO) AVANT toute action. member.clientId = SEULE racine de confiance.
//   - Commentaires de leçon : accès derrière la triple borne
//     member.clientId == lesson.client_id + enrollment actif + drip débloqué
//     (loadGatedLessonForMember — calque memberships.ts:loadGatedLesson, SANS
//     coupler le fichier READ-ONLY).
//   - best-effort : table seq 93 absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import type { MemberContext } from './member-auth';

// Caps de longueur (anti-XSS stocké : on TRIM + CAP côté serveur ; le front
// sanitise au rendu — calque memberships.ts:slice). Pas de markdown ici.
const TITLE_MAX = 200;
const BODY_MAX = 5000;

// Lit + parse le body JSON best-effort (jamais de throw — calque
// member-auth.ts:handleMemberLogin).
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

// Auth PRO enrichi au choke-point (worker.ts) — calque EXACT
// affiliates.ts:AffiliateAuth / memberships.ts:MembershipAuth
// (CapAuth + capabilities injectées).
export type CommunityAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES (corps réels Phase B Manager-B — signatures FIGÉES)
// ════════════════════════════════════════════════════════════════════════════

// Garde capability mode-agence-only (calque EXACT affiliates.ts:affiliateCapGuard
// / funnels.ts:capGuard / LOT B-bis). RÉUTILISE 'workflows.manage' (déjà dans
// ALL_CAPABILITIES seq 80 — AUCUN ajout). Legacy/mono-tenant (!tenant ||
// agencyId == null) → undefined : aucun bridage nouveau (set legacy LARGE ⇒
// pas de régression). Mode agence (agencyId != null) → enforcement réel ;
// viewer bridé.
export function communityCapGuard(auth: CommunityAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// Bornage tenant PRO sur une row porteuse de client_id/agency_id (calque EXACT
// affiliates.ts:loadAffiliateInTenant / memberships.ts:rowInTenant).
//   - Legacy/mono-tenant (!tenant || agencyId == null) → true : endpoints
//     NEUFS, rétro-compat byte-équivalente.
//   - Mode agence (agencyId != null) → client_id ∈ accessibleClientIds OU
//     agency_id == auth.tenant.agencyId, sinon false ⇒ 404.
export function rowInTenant(
  row: { client_id?: unknown; agency_id?: unknown },
  auth: CommunityAuth,
): boolean {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return true;
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  return (
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId)
  );
}

// Re-borne ISOLATION membre (FLAG #1) : une row appartient-elle au tenant du
// membre ? Toute route membre par ID (DELETE post/comment) DOIT passer par là
// AVANT action — sinon un membre du tenant B supprime une row du tenant A par
// id deviné. member.clientId = SEULE racine de confiance.
export function rowOwnedByMemberTenant(
  row: { client_id?: unknown },
  member: MemberContext,
): boolean {
  return ((row.client_id as string | null) ?? null) === member.clientId;
}

// Charge une leçon + applique la TRIPLE borne membre (client_id ==
// + enrollment actif + drip débloqué) — calque memberships.ts:loadGatedLesson
// (READ-ONLY : ré-implémenté ICI plutôt qu'importé, pour ne pas coupler le
// fichier gelé). Retourne { lesson } ou une Response d'erreur. CORPS Phase B.
export async function loadGatedLessonForMember(
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<{ lesson: Record<string, unknown> } | Response> {
  // Calque LECTURE memberships.ts:loadGatedLesson (NON importé — fichier
  // READ-ONLY). best-effort : table seq 87 absente / panne D1 → 404 propre.
  try {
    const lesson = (await env.DB.prepare(
      `SELECT l.id AS id, l.module_id AS module_id, l.course_id AS course_id,
              l.title AS title, l.content_type AS content_type,
              l.drip_days AS drip_days, c.client_id AS client_id
         FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE l.id = ? LIMIT 1`,
    )
      .bind(lessonId)
      .first()) as Record<string, unknown> | null;

    if (!lesson) return json({ error: 'Leçon indisponible' }, 404);

    // Borne 1 : la leçon appartient au tenant du membre (FLAG #1).
    if (((lesson.client_id as string | null) ?? null) !== member.clientId) {
      return json({ error: 'Leçon indisponible' }, 404);
    }

    // Borne 2 : inscription active du membre au cours (course_enrollments —
    // JAMAIS workflow_enrollments).
    const enroll = (await env.DB.prepare(
      `SELECT enrolled_at FROM course_enrollments
        WHERE member_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(member.memberId, lesson.course_id as string)
      .first()) as { enrolled_at: string | null } | null;
    if (!enroll) return json({ error: 'Accès non autorisé' }, 403);

    // Borne 3 : drip débloqué (enrolled_at + drip_days ≤ now). Calque EXACT
    // memberships.ts:dripUnlocked (drip_days ≤ 0 → dispo ; date illisible →
    // ne pas bloquer).
    const dripDays = Number(lesson.drip_days) || 0;
    if (dripDays > 0) {
      const enrolledAt = enroll.enrolled_at;
      if (!enrolledAt) return json({ error: 'Leçon pas encore disponible' }, 403);
      const base = new Date(enrolledAt.replace(' ', 'T') + 'Z').getTime();
      if (!Number.isNaN(base) && base + dripDays * 86_400_000 > Date.now()) {
        return json({ error: 'Leçon pas encore disponible' }, 403);
      }
    }

    return { lesson };
  } catch {
    // Table seq 87 absente / panne D1 : best-effort → 404 propre, jamais 500.
    return json({ error: 'Leçon indisponible' }, 404);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ESPACE MEMBRE — forum threads / posts (auth membre — requireMember)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/member/:slug/community/threads — liste des threads du tenant du
// membre. LECTURE filtrée WHERE client_id = member.clientId (FLAG #1).
export async function handleListThreads(
  _request: Request,
  env: Env,
  _slug: string,
  member: MemberContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, member_id, title, is_pinned, is_locked, created_at
         FROM community_threads
        WHERE client_id = ?
        ORDER BY is_pinned DESC, created_at DESC`,
    )
      .bind(member.clientId)
      .all();
    return json({ data: results || [] });
  } catch {
    // Table seq 93 absente : best-effort → liste vide, jamais 500.
    return json({ data: [] });
  }
}

// POST /api/member/:slug/community/threads — body { title }. ÉCRITURE :
// client_id = member.clientId + member_id = member.memberId (JAMAIS le body —
// FLAG #1). Refuse si title vide.
export async function handleCreateThread(
  request: Request,
  env: Env,
  _slug: string,
  member: MemberContext,
): Promise<Response> {
  const body = await readJson(request);
  const title = sanitizeInput(
    typeof body.title === 'string' ? body.title : '',
    TITLE_MAX,
  );
  if (!title) return json({ error: 'Titre requis' }, 400);

  try {
    const id = crypto.randomUUID();
    // FLAG #1 : client_id/agency_id/member_id POSÉS depuis member (JAMAIS le
    // body). member.agencyId peut être '' (membre legacy/mono-tenant) → NULL.
    await env.DB.prepare(
      `INSERT INTO community_threads (id, client_id, agency_id, member_id, title)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, member.clientId, member.agencyId || null, member.memberId, title)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Création de discussion indisponible' }, 503);
  }
}

// GET /api/member/:slug/community/threads/:tid/posts — posts d'un thread, après
// re-borne du thread au tenant du membre (FLAG #1 : thread.client_id ==
// member.clientId). Posts is_hidden=0 par défaut côté membre.
export async function handleListThreadPosts(
  _request: Request,
  env: Env,
  _slug: string,
  threadId: string,
  member: MemberContext,
): Promise<Response> {
  try {
    // Re-borne FLAG #1 : le thread doit appartenir au tenant du membre.
    const thread = (await env.DB.prepare(
      'SELECT id, client_id FROM community_threads WHERE id = ? LIMIT 1',
    )
      .bind(threadId)
      .first()) as { id: string; client_id: string | null } | null;
    if (!thread || !rowOwnedByMemberTenant(thread, member)) {
      return json({ error: 'Discussion introuvable' }, 404);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, member_id, body, created_at
         FROM community_posts
        WHERE thread_id = ? AND client_id = ? AND is_hidden = 0
        ORDER BY created_at ASC`,
    )
      .bind(threadId, member.clientId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/member/:slug/community/threads/:tid/posts — body { body }. ÉCRITURE
// après re-borne thread (FLAG #1) + refus si thread.is_locked. client_id =
// member.clientId + member_id = member.memberId (JAMAIS le body).
export async function handleCreatePost(
  request: Request,
  env: Env,
  _slug: string,
  threadId: string,
  member: MemberContext,
): Promise<Response> {
  const reqBody = await readJson(request);
  const text = sanitizeInput(
    typeof reqBody.body === 'string' ? reqBody.body : '',
    BODY_MAX,
  );
  if (!text) return json({ error: 'Message vide' }, 400);

  try {
    // Re-borne FLAG #1 + refus thread verrouillé.
    const thread = (await env.DB.prepare(
      'SELECT id, client_id, is_locked FROM community_threads WHERE id = ? LIMIT 1',
    )
      .bind(threadId)
      .first()) as
      | { id: string; client_id: string | null; is_locked: number | null }
      | null;
    if (!thread || !rowOwnedByMemberTenant(thread, member)) {
      return json({ error: 'Discussion introuvable' }, 404);
    }
    if (thread.is_locked) {
      return json({ error: 'Discussion verrouillée' }, 403);
    }

    const id = crypto.randomUUID();
    // FLAG #1 : client_id/member_id POSÉS depuis member (JAMAIS le body).
    await env.DB.prepare(
      `INSERT INTO community_posts (id, client_id, thread_id, member_id, body)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, member.clientId, threadId, member.memberId, text)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Publication indisponible' }, 503);
  }
}

// DELETE /api/member/community/posts/:pid — un membre supprime SON PROPRE post.
// FLAG #1 : re-borne post.client_id == member.clientId ET post.member_id ==
// member.memberId AVANT suppression (sinon 404). PAS de slug (id global borné).
export async function handleDeleteOwnPost(
  _request: Request,
  env: Env,
  postId: string,
  member: MemberContext,
): Promise<Response> {
  try {
    const post = (await env.DB.prepare(
      'SELECT id, client_id, member_id FROM community_posts WHERE id = ? LIMIT 1',
    )
      .bind(postId)
      .first()) as
      | { id: string; client_id: string | null; member_id: string | null }
      | null;
    // FLAG #1 : re-borne tenant ET propriété (member_id == member.memberId).
    // 404 indistinct (ne révèle pas l'existence d'une row d'un autre tenant).
    if (
      !post ||
      !rowOwnedByMemberTenant(post, member) ||
      ((post.member_id as string | null) ?? null) !== member.memberId
    ) {
      return json({ error: 'Message introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM community_posts WHERE id = ?')
      .bind(postId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ESPACE MEMBRE — commentaires de leçons (triple borne via loadGatedLesson)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/member/lessons/:id/comments — commentaires d'une leçon, DERRIÈRE la
// triple borne (loadGatedLessonForMember). LECTURE filtrée client_id =
// member.clientId + is_hidden = 0 (FLAG #1).
export async function handleListLessonComments(
  _request: Request,
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<Response> {
  // Triple borne AVANT lecture (tenant + enrollment + drip).
  const gated = await loadGatedLessonForMember(env, lessonId, member);
  if (gated instanceof Response) return gated;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, member_id, body, created_at
         FROM lesson_comments
        WHERE lesson_id = ? AND client_id = ? AND is_hidden = 0
        ORDER BY created_at ASC`,
    )
      .bind(lessonId, member.clientId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/member/lessons/:id/comments — body { body }. ÉCRITURE derrière la
// triple borne (loadGatedLessonForMember d'ABORD). client_id = member.clientId
// + course_id de la leçon gated + member_id = member.memberId (FLAG #1).
export async function handleCreateLessonComment(
  request: Request,
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<Response> {
  // Triple borne AVANT écriture (tenant + enrollment + drip).
  const gated = await loadGatedLessonForMember(env, lessonId, member);
  if (gated instanceof Response) return gated;

  const reqBody = await readJson(request);
  const text = sanitizeInput(
    typeof reqBody.body === 'string' ? reqBody.body : '',
    BODY_MAX,
  );
  if (!text) return json({ error: 'Commentaire vide' }, 400);

  try {
    const id = crypto.randomUUID();
    const courseId = (gated.lesson.course_id as string | null) ?? null;
    // FLAG #1 : client_id/member_id POSÉS depuis member ; course_id de la leçon
    // gated (JAMAIS le body).
    await env.DB.prepare(
      `INSERT INTO lesson_comments (id, client_id, lesson_id, course_id, member_id, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, member.clientId, lessonId, courseId, member.memberId, text)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Commentaire indisponible' }, 503);
  }
}

// DELETE /api/member/community/comments/:cid — un membre supprime SON PROPRE
// commentaire. FLAG #1 : re-borne comment.client_id == member.clientId ET
// comment.member_id == member.memberId AVANT suppression (sinon 404).
export async function handleDeleteOwnComment(
  _request: Request,
  env: Env,
  commentId: string,
  member: MemberContext,
): Promise<Response> {
  try {
    const comment = (await env.DB.prepare(
      'SELECT id, client_id, member_id FROM lesson_comments WHERE id = ? LIMIT 1',
    )
      .bind(commentId)
      .first()) as
      | { id: string; client_id: string | null; member_id: string | null }
      | null;
    // FLAG #1 : re-borne tenant ET propriété (member_id == member.memberId).
    if (
      !comment ||
      !rowOwnedByMemberTenant(comment, member) ||
      ((comment.member_id as string | null) ?? null) !== member.memberId
    ) {
      return json({ error: 'Commentaire introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM lesson_comments WHERE id = ?')
      .bind(commentId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODÉRATION PRO (requireAuth + capability 'workflows.manage', borné rowInTenant)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/community/moderate/threads — liste des threads du tenant PRO pour la
// modération (capGuard + filtre rowInTenant applicatif).
export async function handleModerateListThreads(
  _request: Request,
  env: Env,
  auth: CommunityAuth,
  _url: URL,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, member_id, title, is_pinned, is_locked, created_at
         FROM community_threads ORDER BY created_at DESC`,
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}

// DELETE /api/community/moderate/posts/:id — modérateur PRO supprime N'IMPORTE
// QUEL post du tenant. capGuard + re-borne rowInTenant(post, auth) AVANT
// suppression (FLAG #1).
export async function handleModerateDeletePost(
  _request: Request,
  env: Env,
  auth: CommunityAuth,
  postId: string,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    const post = (await env.DB.prepare(
      'SELECT id, client_id FROM community_posts WHERE id = ? LIMIT 1',
    )
      .bind(postId)
      .first()) as { id: string; client_id: string | null } | null;
    // FLAG #1 PRO : re-borne tenant AVANT suppression.
    if (!post || !rowInTenant(post, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM community_posts WHERE id = ?')
      .bind(postId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// DELETE /api/community/moderate/comments/:id — modérateur PRO supprime
// N'IMPORTE QUEL commentaire du tenant. capGuard + re-borne rowInTenant.
export async function handleModerateDeleteComment(
  _request: Request,
  env: Env,
  auth: CommunityAuth,
  commentId: string,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    const comment = (await env.DB.prepare(
      'SELECT id, client_id FROM lesson_comments WHERE id = ? LIMIT 1',
    )
      .bind(commentId)
      .first()) as { id: string; client_id: string | null } | null;
    if (!comment || !rowInTenant(comment, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM lesson_comments WHERE id = ?')
      .bind(commentId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// PUT /api/community/moderate/threads/:id — pin/lock d'un thread par le
// modérateur PRO. body { is_pinned?, is_locked? }. capGuard + re-borne
// rowInTenant(thread, auth) AVANT UPDATE (FLAG #1).
export async function handleModerateThread(
  request: Request,
  env: Env,
  auth: CommunityAuth,
  threadId: string,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    const thread = (await env.DB.prepare(
      'SELECT id, client_id, agency_id FROM community_threads WHERE id = ? LIMIT 1',
    )
      .bind(threadId)
      .first()) as
      | { id: string; client_id: string | null; agency_id: string | null }
      | null;
    // FLAG #1 PRO : re-borne tenant AVANT UPDATE.
    if (!thread || !rowInTenant(thread, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    const body = await readJson(request);
    const updates: string[] = [];
    const params: number[] = [];
    // Flags 0/1 validés HANDLER (pas de CHECK SQL — calque seq 93).
    if (body.is_pinned !== undefined) {
      updates.push('is_pinned = ?');
      params.push(body.is_pinned ? 1 : 0);
    }
    if (body.is_locked !== undefined) {
      updates.push('is_locked = ?');
      params.push(body.is_locked ? 1 : 0);
    }
    if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

    await env.DB.prepare(
      `UPDATE community_threads SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...params, threadId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Mise à jour indisponible' }, 503);
  }
}

// GET /api/community/moderate/threads/:tid/posts — liste les posts d'UN thread
// du tenant PRO pour la modération. capGuard + re-borne rowInTenant(thread)
// AVANT lecture (FLAG #1) ⇒ thread hors périmètre = 404. Inclut is_hidden pour
// l'admin (≠ vue membre qui filtre is_hidden = 0). Calque handleModerateListThreads.
export async function handleModerateListPosts(
  _request: Request,
  env: Env,
  auth: CommunityAuth,
  threadId: string,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    // Re-borne tenant sur le thread parent AVANT de lister ses posts.
    const thread = (await env.DB.prepare(
      'SELECT id, client_id, agency_id FROM community_threads WHERE id = ? LIMIT 1',
    )
      .bind(threadId)
      .first()) as
      | { id: string; client_id: string | null; agency_id: string | null }
      | null;
    if (!thread || !rowInTenant(thread, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, thread_id, member_id, body, is_hidden, created_at
         FROM community_posts
        WHERE thread_id = ?
        ORDER BY created_at ASC`,
    )
      .bind(threadId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// GET /api/community/moderate/comments[?lesson_id=] — liste les commentaires de
// leçons du tenant PRO pour la modération. capGuard + filtre rowInTenant
// applicatif (lesson_comments porte client_id ⇒ borne accessibleClientIds).
// Récents (LIMIT 100, plus récents d'abord). Inclut is_hidden pour l'admin.
export async function handleModerateListComments(
  _request: Request,
  env: Env,
  auth: CommunityAuth,
  url: URL,
): Promise<Response> {
  const g = communityCapGuard(auth);
  if (g) return g;
  try {
    const lessonId = url.searchParams.get('lesson_id');
    const sql = lessonId
      ? `SELECT id, client_id, lesson_id, course_id, member_id, body, is_hidden, created_at
           FROM lesson_comments
          WHERE lesson_id = ?
          ORDER BY created_at DESC LIMIT 100`
      : `SELECT id, client_id, lesson_id, course_id, member_id, body, is_hidden, created_at
           FROM lesson_comments
          ORDER BY created_at DESC LIMIT 100`;
    const stmt = lessonId
      ? env.DB.prepare(sql).bind(lessonId)
      : env.DB.prepare(sql);
    const { results } = await stmt.all();
    // Borne tenant applicative (calque handleModerateListThreads).
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}
