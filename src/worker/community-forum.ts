// ── Sprint 45 — community-forum.ts — Handlers REST forum tenant interne ────
//
// 14 handlers AUTHED (CRUD threads/comments + votes + moderation queue). Routes
// câblées dans `src/worker.ts` (Phase A, ordre anti-shadowing : sous-routes
// spécifiques AVANT /:id générique). Phase B Manager-B : corps réels. SIGNATURES
// FIGÉES (recopiées verbatim Phase A stubs).
//
// ⚠ DISTINCT de `community.ts` (LOT G10 seq93 — AUTH MEMBRE SÉPARÉE
//   member-auth/member-sessions + member_id auteur). S45 = MODULE NEUF (tables
//   `c45_*` seq140, AUTH STD users + admin_sessions, caps leads.write membres
//   + settings.manage modération admin). Voir docs/LOT-COMMUNITY-S45.md §6.
//
// Contrats GELÉS (docs/LOT-COMMUNITY-S45.md §6) :
//   - succès : json({ data })
//   - erreur : json({ error }, status)   ← JAMAIS de champ `code`
//   - imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`,
//                                  `./modules`,
//                                  `./lib/community-engine`,
//                                  `./lib/review-moderation`)
//   - capabilities FIGÉES :
//       * `leads.write`     (membres) : create thread/comment, vote
//       * `settings.manage` (admin)   : moderate (hide/delete/pin/lock/ban)
//     AUCUN ajout à ALL_CAPABILITIES seq 80.
//   - anti-spam : lib/community-engine.moderateContent (S40 réutilise
//     review-moderation : computeSpamScore + containsBadWords)
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability au top de chaque handler. resolveClientId() = calque
// `funnels-builder.ts:67` (chat-bot/voice-agent même pattern).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import {
  recordVote,
  moderateContent,
  bumpThreadActivity,
  sanitizeBody,
  validateThreadInput,
  validateCommentInput,
  checkReplyDepth,
  canModerate,
  canTransitionStatus,
  checkVoteRateLimit,
  hashIp,
  VALID_THREAD_CATEGORIES,
} from './lib/community-engine';

// Fallback salt si COMMUNITY_SALT absent (dev local). Production : ENV-set.
const DEFAULT_COMMUNITY_SALT = 'intralys-default-salt';

/** Auth enrichi au choke-point worker.ts (calque funnels-builder.ts:41). */
export type CommunityForumAuth = CapAuth & { capabilities?: Set<string> };

// ── Whitelists HANDLER (pas de CHECK SQL) ──────────────────────────────────

/** Catégories autorisées pour un thread (délégué à l'engine). */
const VALID_CATEGORIES = VALID_THREAD_CATEGORIES;

/** Statuts threads enum HANDLER. */
const THREAD_STATUSES = new Set(['open', 'hidden', 'deleted']);
/** Statuts comments enum HANDLER. */
const COMMENT_STATUSES = new Set(['visible', 'hidden', 'deleted']);
/** target_type votes/moderation enum HANDLER. */
const VALID_TARGET_TYPES = new Set(['thread', 'comment']);
/** Actions modération enum HANDLER. */
const VALID_MOD_ACTIONS = new Set(['hide', 'delete', 'warn', 'ban']);

// ── Gardes capability ──────────────────────────────────────────────────────

/** Garde capability `leads.write` (FIGÉE seq80) — membres. */
function memberCapGuard(auth: CommunityForumAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'leads.write');
}

/** Garde capability `settings.manage` (FIGÉE seq80) — modération admin. */
function modCapGuard(auth: CommunityForumAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

/** Vérifie si l'utilisateur courant possède la cap modération. */
function isModerator(auth: CommunityForumAuth): boolean {
  return !!(auth.capabilities && auth.capabilities.has('settings.manage'));
}

// ── Helpers locaux ─────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque funnels-builder.ts:67). */
async function resolveClientId(
  env: Env,
  auth: CommunityForumAuth,
): Promise<string | null> {
  try {
    const { clientId } = await getClientModules(env, auth.userId);
    return clientId ?? null;
  } catch {
    return null;
  }
}

function noClient(): Response {
  return json({ error: 'Client introuvable' }, 400);
}

/** Vérifie si l'utilisateur courant est banni (community_banned_at != NULL). */
async function isUserBanned(env: Env, userId: string): Promise<boolean> {
  try {
    const row = (await env.DB
      .prepare('SELECT community_banned_at FROM users WHERE id = ? LIMIT 1')
      .bind(userId)
      .first()) as { community_banned_at: string | null } | null;
    return !!(row && row.community_banned_at);
  } catch {
    return false;
  }
}

// NB : sha256Ip local supprimé S45 Phase B+ — remplacé par engine.hashIp(ip, salt)
// (Loi 25 : salt par défaut 'intralys-default-salt' override via env.COMMUNITY_SALT).

/** Locale d'un user (fallback fr-CA). */
function readLocale(request?: Request): string {
  try {
    const al = request?.headers.get('Accept-Language') || '';
    const first = al.split(',')[0]?.trim() || '';
    return first.length > 0 ? first.slice(0, 10) : 'fr-CA';
  } catch {
    return 'fr-CA';
  }
}

/** Lit en safe le JSON body (retourne {} si invalide). */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return (b && typeof b === 'object' ? (b as Record<string, unknown>) : {});
  } catch {
    return {};
  }
}

/** Normalise une row thread D1 → shape API. */
function mapThreadRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id ?? ''),
    client_id: String(r.client_id ?? ''),
    author_user_id: r.author_user_id == null ? null : String(r.author_user_id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    category: String(r.category ?? 'general'),
    is_pinned: r.is_pinned === 1 || r.is_pinned === true,
    is_locked: r.is_locked === 1 || r.is_locked === true,
    status: String(r.status ?? 'open'),
    upvotes_count: Number(r.upvotes_count ?? 0),
    comments_count: Number(r.comments_count ?? 0),
    last_activity_at: String(r.last_activity_at ?? ''),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Normalise une row comment D1 → shape API. */
function mapCommentRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id ?? ''),
    thread_id: String(r.thread_id ?? ''),
    author_user_id: r.author_user_id == null ? null : String(r.author_user_id),
    parent_comment_id:
      r.parent_comment_id == null ? null : String(r.parent_comment_id),
    body: String(r.body ?? ''),
    status: String(r.status ?? 'visible'),
    upvotes_count: Number(r.upvotes_count ?? 0),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Normalise une row moderation action D1 → shape API. */
function mapModerationRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id ?? ''),
    target_type: r.target_type == null ? null : String(r.target_type),
    target_id: r.target_id == null ? null : String(r.target_id),
    action: r.action == null ? null : String(r.action),
    moderator_user_id:
      r.moderator_user_id == null ? null : String(r.moderator_user_id),
    reason: r.reason == null ? null : String(r.reason),
    client_id: r.client_id == null ? null : String(r.client_id),
    created_at: String(r.created_at ?? ''),
  };
}

/** Lookup thread (avec borne tenant). */
async function fetchThread(
  env: Env,
  threadId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  const row = (await env.DB
    .prepare(
      `SELECT * FROM c45_threads
        WHERE id = ? AND client_id = ?
        LIMIT 1`,
    )
    .bind(threadId, clientId)
    .first()) as Record<string, unknown> | null;
  return row;
}

/** Lookup comment + thread parent (defense-in-depth tenant via JOIN applicatif). */
async function fetchCommentWithThread(
  env: Env,
  commentId: string,
  clientId: string,
): Promise<{
  comment: Record<string, unknown>;
  thread: Record<string, unknown>;
} | null> {
  const c = (await env.DB
    .prepare(
      `SELECT c.*
         FROM c45_comments c
         JOIN c45_threads t ON t.id = c.thread_id
        WHERE c.id = ? AND t.client_id = ?
        LIMIT 1`,
    )
    .bind(commentId, clientId)
    .first()) as Record<string, unknown> | null;
  if (!c) return null;
  const t = await fetchThread(env, String(c.thread_id ?? ''), clientId);
  if (!t) return null;
  return { comment: c, thread: t };
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS THREADS — 7 endpoints (CRUD + pin + lock)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/community/threads — liste threads filtrés (cap leads.write). */
export async function handleListThreads(
  env: Env,
  auth: CommunityForumAuth,
  url: URL,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const categoryRaw = url.searchParams.get('category') || '';
    const statusRaw = url.searchParams.get('status') || 'open';
    const limitRaw = Number(url.searchParams.get('limit') || 50);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(200, Math.floor(limitRaw))
        : 50;

    const status = THREAD_STATUSES.has(statusRaw) ? statusRaw : 'open';
    const category =
      categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : '';

    let sql =
      `SELECT * FROM c45_threads
        WHERE client_id = ? AND status = ?`;
    const binds: unknown[] = [clientId, status];
    if (category) {
      sql += ` AND category = ?`;
      binds.push(category);
    }
    sql += ` ORDER BY is_pinned DESC, last_activity_at DESC LIMIT ?`;
    binds.push(limit);

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const data = (results || []).map((r) =>
      mapThreadRow(r as Record<string, unknown>),
    );
    return json({ data });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** POST /api/community/threads — créer un thread (cap leads.write). */
export async function handleCreateThread(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    if (await isUserBanned(env, auth.userId)) {
      return json({ error: 'Compte banni de la communauté' }, 403);
    }

    const body = await readJson(request);

    // Engine renforcé : whitelist title/body/category + sanitizeBody (XSS strip).
    // Re-pass sanitizeInput pour cohérence trim() avec le reste du code-base.
    const v = validateThreadInput(body);
    if (!v.ok || !v.data) {
      return json(
        { error: 'Titre et corps requis' },
        400,
      );
    }
    const title = sanitizeInput(v.data.title, 200);
    const bodyText = sanitizeInput(v.data.body, 10000);
    const category = v.data.category;

    if (!title || !bodyText) {
      return json({ error: 'Titre et corps requis' }, 400);
    }

    const locale = readLocale(request);
    const mod = moderateContent(env, bodyText, locale);
    const status = mod.autoHide ? 'hidden' : 'open';

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    await env.DB
      .prepare(
        `INSERT INTO c45_threads (
           id, client_id, author_user_id, title, body, category, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, clientId, auth.userId, title, bodyText, category, status)
      .run();

    const row = await fetchThread(env, id, clientId);
    if (!row) return json({ error: 'Création échouée' }, 500);

    await audit(env, auth.userId, 'community_thread_create', 'c45_thread', id, {
      category,
      status,
      spamScore: mod.spamScore,
    });

    return json({ data: mapThreadRow(row) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** GET /api/community/threads/:id — détail d'un thread (cap leads.write). */
export async function handleGetThread(
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const row = await fetchThread(env, id, clientId);
    if (!row) return json({ error: 'Thread introuvable' }, 404);
    // On expose même les hidden/deleted aux modérateurs ; pour les membres
    // standard, on masque les threads non-open.
    const status = String(row.status ?? 'open');
    if (status !== 'open' && !isModerator(auth)) {
      return json({ error: 'Thread introuvable' }, 404);
    }
    return json({ data: mapThreadRow(row) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** PATCH /api/community/threads/:id — update (auteur ou modérateur). */
export async function handleUpdateThread(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const existing = await fetchThread(env, id, clientId);
    if (!existing) return json({ error: 'Thread introuvable' }, 404);

    const isAuthor = String(existing.author_user_id ?? '') === auth.userId;
    if (!isAuthor && !isModerator(auth)) {
      return json({ error: 'Accès refusé' }, 403);
    }

    const body = await readJson(request);
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.title === 'string') {
      const t = sanitizeInput(body.title, 200);
      if (t) {
        sets.push('title = ?');
        binds.push(t);
      }
    }
    if (typeof body.body === 'string') {
      // sanitizeBody (XSS strip) AVANT sanitizeInput (trim/slice).
      const b = sanitizeInput(sanitizeBody(body.body), 10000);
      if (b) {
        sets.push('body = ?');
        binds.push(b);
      }
    }
    if (typeof body.category === 'string') {
      const c = body.category.trim();
      if (VALID_CATEGORIES.has(c)) {
        sets.push('category = ?');
        binds.push(c);
      }
    }

    if (sets.length === 0) {
      return json({ data: mapThreadRow(existing) });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(id, clientId);
    await env.DB
      .prepare(
        `UPDATE c45_threads SET ${sets.join(', ')}
          WHERE id = ? AND client_id = ?`,
      )
      .bind(...binds)
      .run();

    const updated = await fetchThread(env, id, clientId);
    if (!updated) return json({ error: 'Thread introuvable' }, 404);
    await audit(env, auth.userId, 'community_thread_update', 'c45_thread', id, {});
    return json({ data: mapThreadRow(updated) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** DELETE /api/community/threads/:id — soft-delete (auteur ou modérateur). */
export async function handleDeleteThread(
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const existing = await fetchThread(env, id, clientId);
    if (!existing) return json({ error: 'Thread introuvable' }, 404);

    const isAuthor = String(existing.author_user_id ?? '') === auth.userId;
    if (!isAuthor && !isModerator(auth)) {
      return json({ error: 'Accès refusé' }, 403);
    }

    // Soft-delete thread + cascade soft-delete comments.
    await env.DB
      .prepare(
        `UPDATE c45_threads
            SET status = 'deleted', updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
      .bind(id, clientId)
      .run();

    try {
      await env.DB
        .prepare(
          `UPDATE c45_comments
              SET status = 'deleted', updated_at = datetime('now')
            WHERE thread_id = ?`,
        )
        .bind(id)
        .run();
    } catch {
      // Best-effort cascade (table éventuellement absente).
    }

    await audit(env, auth.userId, 'community_thread_delete', 'c45_thread', id, {});
    return json({ data: { id, status: 'deleted' } });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** POST /api/community/threads/:id/pin — toggle pinned (cap settings.manage). */
export async function handlePinThread(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = modCapGuard(auth);
  if (cap) return cap;
  void request;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const existing = await fetchThread(env, id, clientId);
    if (!existing) return json({ error: 'Thread introuvable' }, 404);

    const next =
      existing.is_pinned === 1 || existing.is_pinned === true ? 0 : 1;
    await env.DB
      .prepare(
        `UPDATE c45_threads
            SET is_pinned = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
      .bind(next, id, clientId)
      .run();

    const updated = await fetchThread(env, id, clientId);
    if (!updated) return json({ error: 'Thread introuvable' }, 404);
    await audit(env, auth.userId, 'community_thread_pin', 'c45_thread', id, {
      is_pinned: next === 1,
    });
    return json({ data: mapThreadRow(updated) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** POST /api/community/threads/:id/lock — toggle locked (cap settings.manage). */
export async function handleLockThread(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = modCapGuard(auth);
  if (cap) return cap;
  void request;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const existing = await fetchThread(env, id, clientId);
    if (!existing) return json({ error: 'Thread introuvable' }, 404);

    const next =
      existing.is_locked === 1 || existing.is_locked === true ? 0 : 1;
    await env.DB
      .prepare(
        `UPDATE c45_threads
            SET is_locked = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
      .bind(next, id, clientId)
      .run();

    const updated = await fetchThread(env, id, clientId);
    if (!updated) return json({ error: 'Thread introuvable' }, 404);
    await audit(env, auth.userId, 'community_thread_lock', 'c45_thread', id, {
      is_locked: next === 1,
    });
    return json({ data: mapThreadRow(updated) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS COMMENTS — 4 endpoints (list + create + update + delete)
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/community/threads/:id/comments — liste commentaires (cap leads.write). */
export async function handleListComments(
  env: Env,
  auth: CommunityForumAuth,
  threadId: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const thread = await fetchThread(env, threadId, clientId);
    if (!thread) return json({ error: 'Thread introuvable' }, 404);

    const { results } = await env.DB
      .prepare(
        `SELECT * FROM c45_comments
          WHERE thread_id = ? AND status = 'visible'
          ORDER BY created_at ASC
          LIMIT 500`,
      )
      .bind(threadId)
      .all();

    const data = (results || []).map((r) =>
      mapCommentRow(r as Record<string, unknown>),
    );
    return json({ data });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** POST /api/community/threads/:id/comments — créer commentaire (cap leads.write). */
export async function handleCreateComment(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
  threadId: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    if (await isUserBanned(env, auth.userId)) {
      return json({ error: 'Compte banni de la communauté' }, 403);
    }

    const thread = await fetchThread(env, threadId, clientId);
    if (!thread) return json({ error: 'Thread introuvable' }, 404);

    if (thread.is_locked === 1 || thread.is_locked === true) {
      return json({ error: 'Thread verrouillé' }, 423);
    }
    if (String(thread.status ?? 'open') !== 'open') {
      return json({ error: 'Thread fermé' }, 410);
    }

    const body = await readJson(request);

    // Engine renforcé : whitelist body/parent_comment_id + sanitizeBody (XSS).
    const v = validateCommentInput(body, threadId);
    if (!v.ok || !v.data) {
      return json({ error: 'Corps requis' }, 400);
    }
    const bodyText = sanitizeInput(v.data.body, 5000);
    if (!bodyText) {
      return json({ error: 'Corps requis' }, 400);
    }
    const parentCommentId = v.data.parentCommentId;

    // Garde profondeur réponse (1 niveau max — anti-arborescence infinie).
    if (parentCommentId) {
      const depth = await checkReplyDepth(env, parentCommentId);
      if (!depth.ok) {
        return json(
          { error: 'Profondeur de réponse dépassée (1 niveau max)' },
          400,
        );
      }
    }

    const locale = readLocale(request);
    const mod = moderateContent(env, bodyText, locale);
    const status = mod.autoHide ? 'hidden' : 'visible';

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    await env.DB
      .prepare(
        `INSERT INTO c45_comments (
           id, thread_id, author_user_id, parent_comment_id, body, status
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, threadId, auth.userId, parentCommentId, bodyText, status)
      .run();

    // Bump thread activity (last_activity_at + comments_count) seulement
    // si commentaire visible (status='visible' — hidden ne doit pas pousser
    // le thread en haut du tri).
    if (status === 'visible') {
      await bumpThreadActivity(env, threadId);
    }

    const created = (await env.DB
      .prepare(`SELECT * FROM c45_comments WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()) as Record<string, unknown> | null;
    if (!created) return json({ error: 'Création échouée' }, 500);

    await audit(
      env,
      auth.userId,
      'community_comment_create',
      'c45_comment',
      id,
      { thread_id: threadId, status, spamScore: mod.spamScore },
    );

    return json({ data: mapCommentRow(created) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** PATCH /api/community/comments/:id — update (auteur ou modérateur). */
export async function handleUpdateComment(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const ctx = await fetchCommentWithThread(env, id, clientId);
    if (!ctx) return json({ error: 'Commentaire introuvable' }, 404);

    const isAuthor =
      String(ctx.comment.author_user_id ?? '') === auth.userId;
    if (!isAuthor && !isModerator(auth)) {
      return json({ error: 'Accès refusé' }, 403);
    }

    const body = await readJson(request);
    if (typeof body.body !== 'string') {
      return json({ data: mapCommentRow(ctx.comment) });
    }
    const newBody = sanitizeInput(body.body, 5000);
    if (!newBody) return json({ error: 'Corps requis' }, 400);

    await env.DB
      .prepare(
        `UPDATE c45_comments
            SET body = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(newBody, id)
      .run();

    const updated = (await env.DB
      .prepare(`SELECT * FROM c45_comments WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()) as Record<string, unknown> | null;
    if (!updated) return json({ error: 'Commentaire introuvable' }, 404);

    await audit(
      env,
      auth.userId,
      'community_comment_update',
      'c45_comment',
      id,
      {},
    );
    return json({ data: mapCommentRow(updated) });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** DELETE /api/community/comments/:id — soft-delete (auteur ou modérateur). */
export async function handleDeleteComment(
  env: Env,
  auth: CommunityForumAuth,
  id: string,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const ctx = await fetchCommentWithThread(env, id, clientId);
    if (!ctx) return json({ error: 'Commentaire introuvable' }, 404);

    const isAuthor =
      String(ctx.comment.author_user_id ?? '') === auth.userId;
    if (!isAuthor && !isModerator(auth)) {
      return json({ error: 'Accès refusé' }, 403);
    }

    const prevStatus = String(ctx.comment.status ?? 'visible');
    await env.DB
      .prepare(
        `UPDATE c45_comments
            SET status = 'deleted', updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(id)
      .run();

    // Si le commentaire était 'visible', décrémenter comments_count du thread.
    if (prevStatus === 'visible') {
      try {
        await env.DB
          .prepare(
            `UPDATE c45_threads
                SET comments_count = MAX(0, COALESCE(comments_count, 0) - 1),
                    updated_at = datetime('now')
              WHERE id = ?`,
          )
          .bind(String(ctx.comment.thread_id ?? ''))
          .run();
      } catch {
        // Best-effort.
      }
    }

    await audit(
      env,
      auth.userId,
      'community_comment_delete',
      'c45_comment',
      id,
      {},
    );
    return json({ data: { id, status: 'deleted' } });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS VOTES + MODERATION — 3 endpoints
// ════════════════════════════════════════════════════════════════════════════

/** POST /api/community/vote — voter sur thread ou comment (cap leads.write). */
export async function handleVote(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
): Promise<Response> {
  const cap = memberCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    if (await isUserBanned(env, auth.userId)) {
      return json({ error: 'Compte banni de la communauté' }, 403);
    }

    const body = await readJson(request);
    const targetType =
      typeof body.target_type === 'string' ? body.target_type.trim() : '';
    const targetId =
      typeof body.target_id === 'string' ? body.target_id.trim() : '';
    const directionRaw =
      typeof body.direction === 'string' ? body.direction.trim() : 'up';

    if (!VALID_TARGET_TYPES.has(targetType)) {
      return json({ error: 'target_type invalide' }, 400);
    }
    if (!targetId) {
      return json({ error: 'target_id requis' }, 400);
    }

    // Spec user : direction = 'up' | 'remove'. Signature engine FIGÉE :
    // 'up' | 'none'. On normalise 'remove' → 'none' (sémantique identique).
    let direction: 'up' | 'none';
    if (directionRaw === 'up') direction = 'up';
    else if (directionRaw === 'remove' || directionRaw === 'none') {
      direction = 'none';
    } else {
      return json({ error: 'direction invalide' }, 400);
    }

    // Verrouille le tenant : la cible doit appartenir au client courant.
    if (targetType === 'thread') {
      const t = await fetchThread(env, targetId, clientId);
      if (!t) return json({ error: 'Thread introuvable' }, 404);
    } else {
      const ctx = await fetchCommentWithThread(env, targetId, clientId);
      if (!ctx) return json({ error: 'Commentaire introuvable' }, 404);
    }

    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'unknown';
    // Engine renforcé : hashIp salé (Loi 25 — jamais IP brute en D1).
    const salt = env.COMMUNITY_SALT || DEFAULT_COMMUNITY_SALT;
    const ipHash = await hashIp(ip, salt);

    // Rate-limit anti-flood vote (5 votes/60s/user|ipHash). Bloque seulement
    // l'action 'up' — le 'remove' (toggle) reste permis (toggle UX naturel).
    if (direction === 'up') {
      const rl = await checkVoteRateLimit(env, auth.userId, ipHash);
      if (!rl.ok) {
        return json(
          {
            error: 'Trop de votes — réessayez dans quelques instants',
          },
          429,
        );
      }
    }

    const res = await recordVote(
      env,
      targetType as 'thread' | 'comment',
      targetId,
      auth.userId,
      ipHash,
      direction,
    );

    await audit(env, auth.userId, 'community_vote', `c45_${targetType}`, targetId, {
      direction,
      ok: res.ok,
    });

    return json({
      data: {
        ok: res.ok,
        newCount: res.newCount,
        target_type: targetType,
        target_id: targetId,
        direction,
      },
    });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** GET /api/community/moderation — queue actions modération (cap settings.manage). */
export async function handleListModerationActions(
  env: Env,
  auth: CommunityForumAuth,
  url: URL,
): Promise<Response> {
  const cap = modCapGuard(auth);
  if (cap) return cap;
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const targetTypeRaw = url.searchParams.get('target_type') || '';
    const actionRaw = url.searchParams.get('action') || '';

    let sql =
      `SELECT * FROM c45_moderation_actions
        WHERE client_id = ?`;
    const binds: unknown[] = [clientId];
    if (targetTypeRaw && VALID_TARGET_TYPES.has(targetTypeRaw)) {
      sql += ` AND target_type = ?`;
      binds.push(targetTypeRaw);
    }
    if (actionRaw && VALID_MOD_ACTIONS.has(actionRaw)) {
      sql += ` AND action = ?`;
      binds.push(actionRaw);
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const data = (results || []).map((r) =>
      mapModerationRow(r as Record<string, unknown>),
    );
    return json({ data });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

/** POST /api/community/moderation — modérer (hide|delete|warn|ban). */
export async function handleModerateTarget(
  request: Request,
  env: Env,
  auth: CommunityForumAuth,
): Promise<Response> {
  const cap = modCapGuard(auth);
  if (cap) return cap;
  // Defense-in-depth : double-check capability/role via engine.canModerate
  // (couvre futurs role='admin' sans cap settings.manage explicite).
  if (!canModerate(auth)) {
    return json({ error: 'Accès refusé' }, 403);
  }
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    const body = await readJson(request);
    const targetType =
      typeof body.target_type === 'string' ? body.target_type.trim() : '';
    const targetId =
      typeof body.target_id === 'string' ? body.target_id.trim() : '';
    const action =
      typeof body.action === 'string' ? body.action.trim() : '';
    const reason = sanitizeInput(
      typeof body.reason === 'string' ? body.reason : '',
      500,
    );

    if (!VALID_TARGET_TYPES.has(targetType)) {
      return json({ error: 'target_type invalide' }, 400);
    }
    if (!targetId) {
      return json({ error: 'target_id requis' }, 400);
    }
    if (!VALID_MOD_ACTIONS.has(action)) {
      return json({ error: 'action invalide' }, 400);
    }

    // Verrou tenant + récupération auteur (pour action='ban').
    let authorUserId: string | null = null;
    if (targetType === 'thread') {
      const t = await fetchThread(env, targetId, clientId);
      if (!t) return json({ error: 'Thread introuvable' }, 404);
      authorUserId =
        t.author_user_id == null ? null : String(t.author_user_id);
    } else {
      const ctx = await fetchCommentWithThread(env, targetId, clientId);
      if (!ctx) return json({ error: 'Commentaire introuvable' }, 404);
      authorUserId =
        ctx.comment.author_user_id == null
          ? null
          : String(ctx.comment.author_user_id);
    }

    // Journal action modération.
    const actionId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    await env.DB
      .prepare(
        `INSERT INTO c45_moderation_actions (
           id, target_type, target_id, action, moderator_user_id, reason, client_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        actionId,
        targetType,
        targetId,
        action,
        auth.userId,
        reason || null,
        clientId,
      )
      .run();

    // Mutation cible selon action.
    if (action === 'hide' || action === 'delete') {
      if (targetType === 'thread') {
        const newStatus = action === 'hide' ? 'hidden' : 'deleted';
        if (!THREAD_STATUSES.has(newStatus)) {
          // Garde-fou (whitelist déjà vérifiée).
          return json({ error: 'action invalide' }, 400);
        }
        // Whitelist transitions engine (anti-régression : `deleted` terminal).
        const currentStatus = String(
          (await fetchThread(env, targetId, clientId))?.status ?? 'open',
        );
        if (!canTransitionStatus('thread', currentStatus, newStatus)) {
          return json(
            { error: 'Transition de statut invalide' },
            400,
          );
        }
        await env.DB
          .prepare(
            `UPDATE c45_threads
                SET status = ?, updated_at = datetime('now')
              WHERE id = ? AND client_id = ?`,
          )
          .bind(newStatus, targetId, clientId)
          .run();

        // Cascade soft-delete commentaires si delete.
        if (action === 'delete') {
          try {
            await env.DB
              .prepare(
                `UPDATE c45_comments
                    SET status = 'deleted', updated_at = datetime('now')
                  WHERE thread_id = ?`,
              )
              .bind(targetId)
              .run();
          } catch {
            // Best-effort.
          }
        }
      } else {
        const newStatus = action === 'hide' ? 'hidden' : 'deleted';
        if (!COMMENT_STATUSES.has(newStatus)) {
          return json({ error: 'action invalide' }, 400);
        }
        // Whitelist transitions engine.
        const cmtCtx = await fetchCommentWithThread(env, targetId, clientId);
        const currentStatus = String(cmtCtx?.comment.status ?? 'visible');
        if (!canTransitionStatus('comment', currentStatus, newStatus)) {
          return json(
            { error: 'Transition de statut invalide' },
            400,
          );
        }
        await env.DB
          .prepare(
            `UPDATE c45_comments
                SET status = ?, updated_at = datetime('now')
              WHERE id = ?`,
          )
          .bind(newStatus, targetId)
          .run();
      }
    }

    // action='ban' → bannir l'auteur (community_banned_at = now).
    // action='warn' → simple journal (déjà fait ci-dessus).
    if (action === 'ban' && authorUserId) {
      try {
        await env.DB
          .prepare(
            `UPDATE users
                SET community_banned_at = datetime('now')
              WHERE id = ?`,
          )
          .bind(authorUserId)
          .run();
      } catch {
        // Best-effort : colonne possiblement absente si migration seq140 pas jouée.
      }
    }

    await audit(
      env,
      auth.userId,
      'community_moderate',
      `c45_${targetType}`,
      targetId,
      { action, reason: reason || null, authorUserId },
    );

    return json({
      data: {
        id: actionId,
        target_type: targetType,
        target_id: targetId,
        action,
        reason: reason || null,
        authorUserId,
      },
    });
  } catch {
    return json({ error: 'Erreur serveur' }, 500);
  }
}
