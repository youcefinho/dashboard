// ── Community engine — Sprint 45 Phase B (Manager-B SOLO, 2026-05-25) ───────
//   + Phase B+ Renforcement (2026-05-25) : sanitization HTML, rate-limit votes,
//   hashIp, validateThreadInput, validateCommentInput, canModerate, status
//   transitions whitelist, codes erreur stables.
//
// Helpers internes pour le forum tenant interne (community-forum.ts) :
//   - recordVote()             : INSERT OR IGNORE c45_votes + UPDATE upvotes_count
//                                (ou DELETE + UPDATE -1 en mode 'none').
//   - moderateContent()        : réutilise S40 lib/review-moderation
//                                (computeSpamScore + containsBadWords) pour
//                                flag/auto-hide threads/comments à la création.
//   - bumpThreadActivity()     : UPDATE c45_threads.last_activity_at +
//                                comments_count à chaque INSERT comment.
//   - sanitizeBody()           : strip <script>/<iframe>/on*=/javascript:/data:
//                                (PUR — defense-in-depth XSS, complète
//                                sanitizeInput() helpers.ts qui trim/slice).
//   - hashIp(ip, salt)         : SHA-256 hex 32 (anti-spam votes anonymisé).
//   - validateThreadInput()    : whitelist title/body/category (codes stables).
//   - validateCommentInput()   : whitelist body/parent (depth 1 max).
//   - canModerate(auth)        : cap settings.manage ou role='admin'.
//   - canTransitionStatus()    : whitelist transitions thread/comment.
//   - checkVoteRateLimit()     : KV sliding window 5 votes/min/(user|ipHash).
//
// Politique : pas de CHECK SQL (enums whitelist HANDLER), best-effort sur D1/KV
// (panne réseau ⇒ dégradation gracieuse, JAMAIS throw — calque
// `lib/currency-converter.ts` / `lib/review-moderation.ts`). Renforcement 100%
// additif — signatures FIGÉES préservées.

import type { Env } from '../types';
import { computeSpamScore, containsBadWords } from './review-moderation';

// ── Codes d'erreur stables (logs + audit) ────────────────────────────────────
// NB : les handlers retournent toujours `{ error: '...' }` (contrat S45 GELÉ —
// pas de champ `code` dans la réponse JSON). Ces codes servent à :
//   - audit_log.payload.error_code
//   - assertions tests
//   - éventuel logger.warn structuré
export const COMMUNITY_ERROR_CODES = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  COMMENT_LOCKED: 'COMMENT_LOCKED',
  THREAD_LOCKED: 'THREAD_LOCKED',
  THREAD_DELETED: 'THREAD_DELETED',
  MODERATOR_REQUIRED: 'MODERATOR_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  DUPLICATE_VOTE: 'DUPLICATE_VOTE',
  SELF_VOTE_REFUSED: 'SELF_VOTE_REFUSED',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  REPLY_DEPTH_EXCEEDED: 'REPLY_DEPTH_EXCEEDED',
} as const;

export type CommunityErrorCode =
  (typeof COMMUNITY_ERROR_CODES)[keyof typeof COMMUNITY_ERROR_CODES];

/** Résultat d'un vote (INSERT OR IGNORE — `ok=false` si duplicate). */
export interface RecordVoteResult {
  /** true si le vote a été enregistré, false si déjà existant (duplicate). */
  ok: boolean;
  /** Nouveau total upvotes_count post-UPDATE (0 si table absente / erreur D1). */
  newCount: number;
}

/** Résultat de modération auto à la création (thread/comment). */
export interface ModerateContentResult {
  /** Score spam 0..100 (S40 computeSpamScore). */
  spamScore: number;
  /** true si dictionnaire S40 badwords détecte un mot (locale-aware). */
  badWords: boolean;
  /** Décision auto : true ⇒ HANDLER pose status='hidden' à l'INSERT. */
  autoHide: boolean;
}

/** Résultat validation d'input (PUR — pas de D1). */
export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: CommunityErrorCode;
  /** Champ en cause (pour log/debug uniquement). */
  field?: string;
}

/** Résultat check rate-limit (KV sliding window). */
export interface RateLimitResult {
  ok: boolean;
  /** Si !ok, secondes avant la prochaine tentative (≥ 1). */
  retryAfter?: number;
}

/** Catégories autorisées pour un thread (FIGÉE — calque handler). */
export const VALID_THREAD_CATEGORIES = new Set([
  'general',
  'question',
  'announce',
  'discussion',
  'feedback',
]);

/** Limites strictes input (validées HANDLER + engine). */
export const COMMUNITY_LIMITS = {
  TITLE_MIN: 1,
  TITLE_MAX: 200,
  BODY_MIN: 1,
  BODY_MAX: 10000,
  COMMENT_BODY_MIN: 1,
  COMMENT_BODY_MAX: 5000,
  PARENT_COMMENT_ID_MAX: 64,
  /** Profondeur réponse imbriquée — 1 niveau MAX (anti-arborescence
   *  infinie + UX lisible / mobile). */
  REPLY_DEPTH_MAX: 1,
  /** Rate-limit votes : 5 votes / fenêtre glissante 60 s. */
  VOTE_RATE_WINDOW_SEC: 60,
  VOTE_RATE_MAX: 5,
} as const;

// ── Whitelist transitions de status (anti-régression) ────────────────────────
// status thread : 'open' | 'hidden' | 'deleted' (+ flags is_locked/is_pinned
// orthogonaux). Soft-delete : 'deleted' est terminal pour l'audit trail —
// JAMAIS de revert vers 'open' (compliance Loi 25 § traçabilité).
const THREAD_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  open: new Set(['hidden', 'deleted']),
  hidden: new Set(['open', 'deleted']),
  deleted: new Set([]), // terminal
};

// status comment : 'visible' | 'hidden' | 'deleted'. Mêmes règles.
const COMMENT_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  visible: new Set(['hidden', 'deleted']),
  hidden: new Set(['visible', 'deleted']),
  deleted: new Set([]), // terminal
};

/** Résout la table cible d'un vote (whitelist HANDLER, pas de CHECK SQL). */
function targetTable(targetType: 'thread' | 'comment'): string | null {
  if (targetType === 'thread') return 'c45_threads';
  if (targetType === 'comment') return 'c45_comments';
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SANITIZATION HTML (defense-in-depth XSS, complète sanitizeInput trim/slice)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strip les vecteurs XSS dangereux d'un body utilisateur (thread/comment).
 *
 * Approche : strip aggressif (PAS d'allowlist DOM — Worker n'a pas DOMParser).
 *   - `<script>` ... `</script>` et `<script ... />` retirés (case-insensitive).
 *   - `<iframe>`, `<object>`, `<embed>`, `<style>`, `<link>`, `<meta>` retirés.
 *   - Attributs handlers `on*=` (onclick, onerror, onload, etc.) retirés.
 *   - Protocoles dangereux dans href/src : `javascript:`, `data:`, `vbscript:`,
 *     `file:` retirés (remplacés par `#`).
 *
 * NB : on ne fait PAS d'escape global (le frontend rend le body en `<pre>` /
 * markdown — escape déjà géré côté React). Cette fonction est une couche
 * BACKEND défense-en-profondeur si un futur renderer SSR génère du HTML brut.
 *
 * PUR — pas de D1, pas de réseau, idempotent. Best-effort sur input non-string
 * (retourne '').
 *
 * Contrat FIGÉ : sanitizeBody(html: string) -> string.
 */
export function sanitizeBody(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return '';

  let s = html;

  // 1) Strip <script> blocks (avec contenu).
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  // 2) Strip <script> self-closing ou orphelin.
  s = s.replace(/<script\b[^>]*\/?>/gi, '');
  // 3) Strip <iframe>, <object>, <embed>, <style>, <link>, <meta>, <base>, <form>.
  s = s.replace(
    /<(iframe|object|embed|style|link|meta|base|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  s = s.replace(
    /<(iframe|object|embed|style|link|meta|base|form)\b[^>]*\/?>/gi,
    '',
  );
  // 4) Strip handlers `on*=...` (onclick, onerror, onload, onmouseover, etc.)
  //    — formes "...", '...', ou sans quotes.
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // 5) Strip protocoles dangereux dans href/src.
  s = s.replace(
    /(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(?:javascript|data|vbscript|file)\s*:[^"'>\s]*\2/gi,
    '$1=$2#$2',
  );
  // 6) Strip data:/javascript: URIs orphelins (CSS url(...), text plain liens).
  s = s.replace(/javascript\s*:/gi, '');
  s = s.replace(/vbscript\s*:/gi, '');
  // NB : on ne strip PAS `data:` au global (peut être légitime dans markdown
  // d'image base64 inline). On le strip uniquement dans href/src ci-dessus.

  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// HASH IP — anti-spam votes anonymisé (Loi 25 : jamais IP brute en clair)
// ════════════════════════════════════════════════════════════════════════════

/**
 * SHA-256(ip + salt) → hex 32 chars (tronqué pour storage compact).
 *
 * Usage : anti-spam votes anonymes. JAMAIS d'IP brute en clair dans D1 (Loi 25
 * Québec §17 — données personnelles minimisation). Le salt vient idéalement
 * de env.TOKEN_KEY (stable cross-requête, secret) ; fallback string vide.
 *
 * Best-effort : crypto.subtle indisponible → fallback ip.slice(0,32) (mieux
 * que rien, log explicite à éviter).
 *
 * Contrat FIGÉ : hashIp(ip, salt?) -> Promise<string>.
 */
export async function hashIp(ip: string, salt: string = ''): Promise<string> {
  if (typeof ip !== 'string' || ip.length === 0) return '';
  try {
    const data = new TextEncoder().encode(ip + salt);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    // Pas de crypto.subtle (ne devrait jamais arriver sur Workers).
    return ip.slice(0, 32);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION INPUT (PUR — codes erreur stables)
// ════════════════════════════════════════════════════════════════════════════

/** Shape validée d'un thread input (post-sanitization/trim). */
export interface ValidatedThreadInput {
  title: string;
  body: string;
  category: string;
}

/** Shape validée d'un comment input (post-sanitization/trim). */
export interface ValidatedCommentInput {
  body: string;
  parentCommentId: string | null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Valide l'input d'un thread (POST /api/community/threads).
 *
 * Whitelist :
 *   - title    : 1..200 chars (post-trim).
 *   - body     : 1..10000 chars (post-trim + post-sanitizeBody).
 *   - category : VALID_THREAD_CATEGORIES (défaut 'general' si vide).
 *
 * Retourne { ok: true, data } ou { ok: false, error: INVALID_INPUT, field }.
 * PUR — pas de D1, pas de réseau.
 *
 * Contrat FIGÉ : validateThreadInput(input) -> ValidationResult<ValidatedThreadInput>.
 */
export function validateThreadInput(
  input: unknown,
): ValidationResult<ValidatedThreadInput> {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'body',
    };
  }
  const obj = input as Record<string, unknown>;

  const title = asString(obj.title).trim().slice(0, COMMUNITY_LIMITS.TITLE_MAX);
  if (title.length < COMMUNITY_LIMITS.TITLE_MIN) {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'title',
    };
  }

  const rawBody = asString(obj.body);
  const body = sanitizeBody(rawBody)
    .trim()
    .slice(0, COMMUNITY_LIMITS.BODY_MAX);
  if (body.length < COMMUNITY_LIMITS.BODY_MIN) {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'body',
    };
  }

  const catRaw = asString(obj.category).trim() || 'general';
  const category = VALID_THREAD_CATEGORIES.has(catRaw) ? catRaw : 'general';

  return { ok: true, data: { title, body, category } };
}

/**
 * Valide l'input d'un comment (POST /api/community/threads/:id/comments).
 *
 * Whitelist :
 *   - body              : 1..5000 chars (post-trim + post-sanitizeBody).
 *   - parent_comment_id : string nullable, <= 64 chars (UUID-like).
 *
 * Le check de "depth max 1" se fait au handler (besoin d'un D1 lookup sur
 * parent.parent_comment_id) — voir checkReplyDepth() ci-dessous.
 *
 * Contrat FIGÉ : validateCommentInput(input, threadId) -> ValidationResult.
 */
export function validateCommentInput(
  input: unknown,
  threadId: string,
): ValidationResult<ValidatedCommentInput> {
  if (!threadId || typeof threadId !== 'string') {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'thread_id',
    };
  }
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'body',
    };
  }
  const obj = input as Record<string, unknown>;

  const rawBody = asString(obj.body);
  const body = sanitizeBody(rawBody)
    .trim()
    .slice(0, COMMUNITY_LIMITS.COMMENT_BODY_MAX);
  if (body.length < COMMUNITY_LIMITS.COMMENT_BODY_MIN) {
    return {
      ok: false,
      error: COMMUNITY_ERROR_CODES.INVALID_INPUT,
      field: 'body',
    };
  }

  let parentCommentId: string | null = null;
  const rawParent = asString(obj.parent_comment_id).trim();
  if (rawParent) {
    parentCommentId = rawParent.slice(0, COMMUNITY_LIMITS.PARENT_COMMENT_ID_MAX);
  }

  return { ok: true, data: { body, parentCommentId } };
}

/**
 * Vérifie qu'un comment-parent n'est pas lui-même une réponse (depth 1 max).
 *
 * Si parentCommentId est null → ok (top-level). Sinon SELECT parent.parent_comment_id.
 * Si parent.parent_comment_id != NULL → REPLY_DEPTH_EXCEEDED.
 *
 * Best-effort : panne D1 ⇒ { ok: true } (degradation gracieuse — au pire on
 * permet une réponse niveau 2, jamais on refuse une réponse légitime).
 *
 * Contrat FIGÉ : checkReplyDepth(env, parentCommentId) -> Promise<ValidationResult<void>>.
 */
export async function checkReplyDepth(
  env: Env,
  parentCommentId: string | null,
): Promise<ValidationResult<undefined>> {
  if (!parentCommentId) return { ok: true };
  try {
    const row = (await env.DB
      .prepare(
        `SELECT parent_comment_id AS pcid
           FROM c45_comments
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(parentCommentId)
      .first()) as { pcid: string | null } | null;

    if (row && row.pcid) {
      return {
        ok: false,
        error: COMMUNITY_ERROR_CODES.REPLY_DEPTH_EXCEEDED,
        field: 'parent_comment_id',
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODÉRATION — capabilities + transitions de status
// ════════════════════════════════════════════════════════════════════════════

/**
 * Vérifie si auth a le droit de modérer (cap settings.manage ou role='admin').
 *
 * PUR — pas de D1. Lit auth.capabilities (Set<string>) + auth.role optionnel.
 *
 * Contrat FIGÉ : canModerate(auth) -> boolean.
 */
export function canModerate(auth: {
  capabilities?: Set<string>;
  role?: string;
}): boolean {
  if (!auth) return false;
  if (auth.capabilities && auth.capabilities.has('settings.manage')) return true;
  if (typeof auth.role === 'string' && auth.role === 'admin') return true;
  return false;
}

/**
 * Whitelist transition status pour thread/comment.
 *
 * Retourne true si transition autorisée, false sinon. Soft-delete 'deleted'
 * est TERMINAL — aucune transition sortante (anti-régression audit trail).
 *
 * Contrat FIGÉ : canTransitionStatus(target, from, to) -> boolean.
 */
export function canTransitionStatus(
  target: 'thread' | 'comment',
  from: string,
  to: string,
): boolean {
  const table = target === 'thread' ? THREAD_TRANSITIONS : COMMENT_TRANSITIONS;
  const allowed = table[from];
  if (!allowed) return false;
  return allowed.has(to);
}

// ════════════════════════════════════════════════════════════════════════════
// RATE-LIMIT VOTES (KV sliding window)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sliding window rate-limit pour les votes. Granularité :
 *   - voterUserId (clef primaire) : 5 votes / 60 s.
 *   - voterIpHash (clef secondaire) : 5 votes / 60 s (anti-multi-comptes).
 *
 * Implémentation : KV `vote:<userId>` stocke un compteur incrémenté, TTL 60s
 * (auto-expire). Au 6e vote dans la fenêtre → ok=false, retryAfter=TTL restant
 * (ou window full si TTL non lisible).
 *
 * Best-effort : env.RATE_LIMITER absent / KV down ⇒ { ok: true } (jamais bloquer
 * un vote légitime à cause d'une panne infra — calque api-public-auth.ts:55).
 *
 * Contrat FIGÉ : checkVoteRateLimit(env, voterUserId, voterIpHash) ->
 *                Promise<RateLimitResult>.
 */
export async function checkVoteRateLimit(
  env: Env,
  voterUserId: string,
  voterIpHash: string | null,
): Promise<RateLimitResult> {
  if (!env.RATE_LIMITER) return { ok: true };
  if (!voterUserId) return { ok: true };

  const window = COMMUNITY_LIMITS.VOTE_RATE_WINDOW_SEC;
  const max = COMMUNITY_LIMITS.VOTE_RATE_MAX;

  try {
    // Clef principale : userId.
    const userKey = `c45_vote:u:${voterUserId}`;
    const userCurrent = await env.RATE_LIMITER.get(userKey);
    const userCount = userCurrent ? parseInt(userCurrent, 10) : 0;
    if (userCount >= max) {
      return { ok: false, retryAfter: window };
    }

    // Clef secondaire : ipHash (si présent).
    if (voterIpHash) {
      const ipKey = `c45_vote:ip:${voterIpHash}`;
      const ipCurrent = await env.RATE_LIMITER.get(ipKey);
      const ipCount = ipCurrent ? parseInt(ipCurrent, 10) : 0;
      if (ipCount >= max) {
        return { ok: false, retryAfter: window };
      }
      // Increment ip key + TTL.
      await env.RATE_LIMITER.put(ipKey, String(ipCount + 1), {
        expirationTtl: window,
      });
    }

    // Increment user key + TTL (réécrit avec même TTL — sliding window
    // approximation, suffisant pour anti-flood).
    await env.RATE_LIMITER.put(userKey, String(userCount + 1), {
      expirationTtl: window,
    });

    return { ok: true };
  } catch {
    // KV down ⇒ ne bloque pas (degradation gracieuse).
    return { ok: true };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RECORD VOTE (signature FIGÉE Phase B)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Enregistre un vote (target_type = thread|comment) avec anti-duplicate via
 * UNIQUE INDEX uniq_community_votes. Sur succès, UPDATE atomic upvotes_count
 * sur la cible (c45_threads ou c45_comments).
 *
 * Direction :
 *   - 'up'   : INSERT OR IGNORE + UPDATE upvotes_count = upvotes_count + 1
 *   - 'none' : DELETE FROM c45_votes  + UPDATE upvotes_count = max(0, x - 1)
 *
 * Best-effort : panne D1 ⇒ { ok: false, newCount: 0 } (jamais throw).
 *
 * Contrat FIGÉ : recordVote(env, targetType, targetId, voterId, voterIpHash,
 *                            direction) -> Promise<RecordVoteResult>.
 */
export async function recordVote(
  env: Env,
  targetType: 'thread' | 'comment',
  targetId: string,
  voterId: string,
  voterIpHash: string | null,
  direction: 'up' | 'none',
): Promise<RecordVoteResult> {
  try {
    const table = targetTable(targetType);
    if (!table || !targetId || !voterId) {
      return { ok: false, newCount: 0 };
    }

    if (direction === 'none') {
      // DELETE + decrement si rowsAffected>0.
      const res = await env.DB
        .prepare(
          `DELETE FROM c45_votes
             WHERE target_type = ?
               AND target_id = ?
               AND voter_user_id = ?`,
        )
        .bind(targetType, targetId, voterId)
        .run();

      // D1 expose meta.changes (number of rows deleted).
      const changed = Number(
        (res as { meta?: { changes?: number } })?.meta?.changes ?? 0,
      );

      if (changed > 0) {
        await env.DB
          .prepare(
            `UPDATE ${table}
                SET upvotes_count = MAX(0, COALESCE(upvotes_count, 0) - 1)
              WHERE id = ?`,
          )
          .bind(targetId)
          .run();
      }

      const row = (await env.DB
        .prepare(`SELECT upvotes_count AS c FROM ${table} WHERE id = ? LIMIT 1`)
        .bind(targetId)
        .first()) as { c: number | string | null } | null;
      const newCount = Number(row?.c ?? 0);
      return { ok: changed > 0, newCount };
    }

    // direction === 'up' : INSERT OR IGNORE + increment si rowsAffected>0.
    const voteId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const ins = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO c45_votes
           (id, target_type, target_id, voter_user_id, voter_ip_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(voteId, targetType, targetId, voterId, voterIpHash)
      .run();

    const changed = Number(
      (ins as { meta?: { changes?: number } })?.meta?.changes ?? 0,
    );

    if (changed > 0) {
      await env.DB
        .prepare(
          `UPDATE ${table}
              SET upvotes_count = COALESCE(upvotes_count, 0) + 1
            WHERE id = ?`,
        )
        .bind(targetId)
        .run();
    }

    const row = (await env.DB
      .prepare(`SELECT upvotes_count AS c FROM ${table} WHERE id = ? LIMIT 1`)
      .bind(targetId)
      .first()) as { c: number | string | null } | null;
    const newCount = Number(row?.c ?? 0);
    return { ok: changed > 0, newCount };
  } catch {
    // Dégradation gracieuse (calque `lib/currency-converter.ts`) — jamais throw.
    return { ok: false, newCount: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODERATE CONTENT (signature FIGÉE Phase B)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Modère le contenu d'un thread/comment à la création. Combine S40
 * computeSpamScore (heuristiques links / caps / repeat / length) + S40
 * containsBadWords (dictionnaire FR/EN/ES embarqué, locale-aware).
 *
 * Décision autoHide :
 *   - badWords=true                       ⇒ autoHide=true (flag dur)
 *   - spamScore >= 70                     ⇒ autoHide=true (spam fort)
 *   - sinon                               ⇒ autoHide=false (status='open'/'visible')
 *
 * PUR — pas de D1, pas de réseau (réutilise S40 stricte ; même contrat).
 *
 * Contrat FIGÉ : moderateContent(env, body, locale) -> ModerateContentResult.
 */
export function moderateContent(
  env: Env,
  body: string,
  locale: string,
): ModerateContentResult {
  void env; // Signature env-friendly (futurs rate-limits par client_id).
  const { score } = computeSpamScore(body, locale);
  const badWords = containsBadWords(body, locale);
  const autoHide = badWords || score >= 70;
  return {
    spamScore: score,
    badWords,
    autoHide,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// BUMP THREAD ACTIVITY (signature FIGÉE Phase B)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bump last_activity_at + comments_count d'un thread à chaque INSERT comment.
 * Best-effort : panne D1 ⇒ no-op (jamais throw — calque
 * `lib/loyalty-engine.ts`).
 *
 * Contrat FIGÉ : bumpThreadActivity(env, threadId) -> Promise<void>.
 */
export async function bumpThreadActivity(
  env: Env,
  threadId: string,
): Promise<void> {
  if (!threadId) return;
  try {
    await env.DB
      .prepare(
        `UPDATE c45_threads
            SET last_activity_at = datetime('now'),
                comments_count = COALESCE(comments_count, 0) + 1
          WHERE id = ?`,
      )
      .bind(threadId)
      .run();
  } catch {
    // Best-effort : panne D1 ⇒ no-op (jamais throw).
  }
}
