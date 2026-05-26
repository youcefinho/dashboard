// ── Sprint 32 — Google Business Profile (GBP) handlers — Agent A2 ──────────
//
// 9 handlers métier GBP, multi-tenant strict (`client_id = auth.clientId`).
// Pattern aligné sur saas-billing.ts (Stripe live + mock fallback) :
//   - capabilities : `settings.manage` pour toute mutation, `reports.view`
//     pour les insights (lecture analytics).
//   - succès `json({ data })`, erreur `json({ error, code }, status)` —
//     codes stables : GBP_NOT_CONNECTED, GBP_LOCATION_NOT_FOUND,
//     GBP_REVIEW_NOT_FOUND, GBP_API_ERROR, INVALID_INPUT.
//   - audit après chaque mutation (best-effort via helpers.audit).
//   - best-effort live : si `gbp-client.ts` throw (token expiré, 429,
//     500 upstream Google) → 502 GBP_API_ERROR avec message court, AUCUN
//     payload Google exposé brut au front (sécurité).
//
// ⚠ INTERDIT : ce module ne crée AUCUNE table. Le schéma D1 vit dans
// migration-gbp-seq127.sql (4 tables : gbp_connections, gbp_locations,
// gbp_posts_sync, gbp_reviews_sync) + reviews_cache (seq 12, JOIN) +
// social_posts (seq 110, FK applicative pour posts).
//
// depends_on : lib/gbp-client.ts (Agent A1) — wrappers fetch authentifiés
//              vers mybusinessaccountmanagement.googleapis.com,
//              mybusinessbusinessinformation.googleapis.com,
//              mybusiness.googleapis.com (reviews v4 legacy),
//              localpostings.googleapis.com (posts v4 legacy),
//              businessprofileperformance.googleapis.com (insights v1).

import type { Env } from './types';
import { json, audit } from './helpers';
import { requireCapability } from './capabilities';
import {
  getGbpAccessToken,
  gbpListLocations,
  gbpListReviews,
  gbpReplyReview,
  gbpCreateLocalPost,
  gbpGetInsights,
} from './lib/gbp-client';
import {
  validateReplyComment,
  validateLocalPostPayload,
  validateMetricsList,
  parseGbpDateRange,
  mapStarRating,
} from './lib/gbp-engine';

// ── Types locaux (miroir handler — pas exposés via src/lib/types.ts) ───────

/** Auth enrichie au choke-point worker.ts (calque CapAuth + capabilities). */
interface GbpAuth {
  userId: string;
  role: string;
  clientId?: string;
  capabilities?: Set<string>;
}

/** Mapped row gbp_connections → réponse front. */
export interface GbpConnection {
  id: string;
  clientId: string | null;
  agencyId: string | null;
  oauthConnectionId: string | null;
  gbpAccountId: string | null;
  gbpAccountName: string | null;
  status: string;
  lastSyncAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Mapped row gbp_locations → réponse front. */
export interface GbpLocation {
  id: string;
  clientId: string | null;
  gbpConnectionId: string | null;
  gbpAccountId: string | null;
  gbpLocationId: string | null;
  locationTitle: string | null;
  primaryPhone: string | null;
  primaryCategory: string | null;
  storeCode: string | null;
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Mapped row reviews_cache JOIN gbp_reviews_sync → réponse front. */
export interface GbpReviewRow {
  id: string;
  clientId: string | null;
  source: string;
  authorName: string | null;
  rating: number;
  comment: string | null;
  reviewDate: string | null;
  reply: string | null;
  replyDate: string | null;
  externalId: string | null;
  gbpReviewName: string | null;
  replyStatus: string;
  replySyncedAt: string | null;
  lastFetchedAt: string | null;
}

// ── Constantes ──────────────────────────────────────────────────────────────

/** TTL cache reviews : au-delà, on déclenche un sync via gbpListReviews. */
const REVIEWS_STALE_TTL_MS = 60 * 60 * 1000; // 1h

// ── Helpers internes (privés, jamais exportés) ─────────────────────────────

/** Récupère la connexion GBP active du tenant (la première trouvée). */
async function getActiveGbpConnection(
  env: Env,
  clientId: string,
): Promise<{ id: string; oauth_connection_id: string | null; gbp_account_id: string | null } | null> {
  return (await env.DB.prepare(
    `SELECT id, oauth_connection_id, gbp_account_id
       FROM gbp_connections
      WHERE client_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(clientId)
    .first()) as { id: string; oauth_connection_id: string | null; gbp_account_id: string | null } | null;
}

/** Format JSON.error stable + code (jamais d'erreur brute Google exposée). */
function gbpError(message: string, code: string, status = 502): Response {
  return json({ error: message, code }, status);
}

/** Adapter D1 row gbp_connections → GbpConnection (camelCase, défensif). */
function mapConnectionRow(r: Record<string, unknown>): GbpConnection {
  return {
    id: String(r.id ?? ''),
    clientId: (r.client_id as string | null) ?? null,
    agencyId: (r.agency_id as string | null) ?? null,
    oauthConnectionId: (r.oauth_connection_id as string | null) ?? null,
    gbpAccountId: (r.gbp_account_id as string | null) ?? null,
    gbpAccountName: (r.gbp_account_name as string | null) ?? null,
    status: String(r.status ?? 'active'),
    lastSyncAt: (r.last_sync_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/** Adapter D1 row gbp_locations → GbpLocation. */
function mapLocationRow(r: Record<string, unknown>): GbpLocation {
  return {
    id: String(r.id ?? ''),
    clientId: (r.client_id as string | null) ?? null,
    gbpConnectionId: (r.gbp_connection_id as string | null) ?? null,
    gbpAccountId: (r.gbp_account_id as string | null) ?? null,
    gbpLocationId: (r.gbp_location_id as string | null) ?? null,
    locationTitle: (r.location_title as string | null) ?? null,
    primaryPhone: (r.primary_phone as string | null) ?? null,
    primaryCategory: (r.primary_category as string | null) ?? null,
    storeCode: (r.store_code as string | null) ?? null,
    isDefault: (r.is_default as number | null) === 1,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1) GET /api/gbp/connections — list des connexions GBP du tenant
// ════════════════════════════════════════════════════════════════════════════

export async function handleListGbpConnections(
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, oauth_connection_id, gbp_account_id,
              gbp_account_name, status, last_sync_at, created_at, updated_at
         FROM gbp_connections
        WHERE client_id = ?
        ORDER BY created_at DESC`,
    )
      .bind(auth.clientId)
      .all();

    const connections = (results || []).map((r) => mapConnectionRow(r as Record<string, unknown>));
    return json({ data: connections });
  } catch (e) {
    return gbpError(
      `Erreur lecture connexions GBP : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2) DELETE /api/gbp/connections/:id — déconnexion + révocation OAuth
//    best-effort.
// ════════════════════════════════════════════════════════════════════════════

export async function handleDeleteGbpConnection(
  _request: Request,
  env: Env,
  auth: GbpAuth,
  id: string,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'settings.manage');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }
  if (!id || id.length < 8) {
    return json({ error: 'id invalide', code: 'INVALID_INPUT' }, 400);
  }

  // Vérifier que la connexion appartient bien au tenant (multi-tenant strict)
  const existing = (await env.DB.prepare(
    `SELECT id, oauth_connection_id FROM gbp_connections WHERE id = ? AND client_id = ?`,
  )
    .bind(id, auth.clientId)
    .first()) as { id: string; oauth_connection_id: string | null } | null;

  if (!existing) {
    return gbpError('Connexion GBP introuvable', 'GBP_NOT_CONNECTED', 404);
  }

  try {
    // DELETE gbp_connections (les gbp_locations/sync orphelins restent —
    // nettoyage différé par cron, calque convention saas / oauth).
    await env.DB.prepare(`DELETE FROM gbp_connections WHERE id = ? AND client_id = ?`)
      .bind(id, auth.clientId)
      .run();

    // Best-effort : DELETE oauth_connections (révocation locale ; le revoke
    // Google live est porté par lib/gbp-client si supporté).
    if (existing.oauth_connection_id) {
      try {
        await env.DB.prepare(`DELETE FROM oauth_connections WHERE id = ?`)
          .bind(existing.oauth_connection_id)
          .run();
      } catch {
        /* best-effort : table oauth_connections absente (seq 95 non jouée) → no-op */
      }
    }

    await audit(env, auth.userId, 'gbp.connection.delete', 'gbp_connection', id, {
      oauthConnectionId: existing.oauth_connection_id,
    });

    return json({ data: { success: true, deletedId: id } });
  } catch (e) {
    return gbpError(
      `Erreur suppression connexion GBP : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3) GET /api/gbp/locations?account_id=… — list locations du compte GBP
//    Cache D1 prioritaire ; si vide → live fetch + cache write.
// ════════════════════════════════════════════════════════════════════════════

export async function handleListGbpLocations(
  request: Request,
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id');
  if (!accountId) {
    return json({ error: 'account_id requis', code: 'INVALID_INPUT' }, 400);
  }

  // 1) Lecture cache D1
  let cached: Record<string, unknown>[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, gbp_connection_id, gbp_account_id, gbp_location_id,
              location_title, primary_phone, primary_category, store_code,
              is_default, created_at, updated_at
         FROM gbp_locations
        WHERE client_id = ? AND gbp_account_id = ?
        ORDER BY is_default DESC, location_title ASC`,
    )
      .bind(auth.clientId, accountId)
      .all();
    cached = (results || []) as Record<string, unknown>[];
  } catch (e) {
    return gbpError(
      `Erreur lecture cache locations : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }

  if (cached.length > 0) {
    return json({ data: cached.map(mapLocationRow), source: 'cache' });
  }

  // 2) Cache vide → fetch live + cache write
  const conn = await getActiveGbpConnection(env, auth.clientId);
  if (!conn || !conn.oauth_connection_id) {
    return gbpError(
      'Aucune connexion GBP active pour ce tenant',
      'GBP_NOT_CONNECTED',
      404,
    );
  }

  try {
    const accessToken = await getGbpAccessToken(env, auth);
    const { locations: liveLocations } = await gbpListLocations(env, accessToken ?? '', accountId);

    // Cache write (best-effort, on n'échoue pas si INSERT plante)
    const now = new Date().toISOString();
    for (const loc of liveLocations) {
      try {
        const locId = loc.name?.replace(/^locations\//, '') || '';
        if (!locId) continue;
        await env.DB.prepare(
          `INSERT INTO gbp_locations
             (client_id, gbp_connection_id, gbp_account_id, gbp_location_id,
              location_title, primary_phone, primary_category, store_code,
              metadata_json, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
          .bind(
            auth.clientId,
            conn.id,
            accountId,
            locId,
            loc.title ?? null,
            loc.primaryPhone ?? null,
            loc.categories?.primaryCategory?.displayName ?? null,
            loc.storeCode ?? null,
            JSON.stringify(loc),
            now,
            now,
          )
          .run();
      } catch {
        /* best-effort : skip cette location */
      }
    }

    // Re-read le cache pour renvoyer le format mappé
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, gbp_connection_id, gbp_account_id, gbp_location_id,
              location_title, primary_phone, primary_category, store_code,
              is_default, created_at, updated_at
         FROM gbp_locations
        WHERE client_id = ? AND gbp_account_id = ?
        ORDER BY is_default DESC, location_title ASC`,
    )
      .bind(auth.clientId, accountId)
      .all();

    return json({
      data: ((results || []) as Record<string, unknown>[]).map(mapLocationRow),
      source: 'live',
    });
  } catch (e) {
    return gbpError(
      `Erreur fetch locations GBP : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      502,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4) POST /api/gbp/locations/:id/default — définir location par défaut
//    UPDATE atomique : tous les is_default=0 du tenant, puis 1 sur id.
// ════════════════════════════════════════════════════════════════════════════

export async function handleSetDefaultGbpLocation(
  _request: Request,
  env: Env,
  auth: GbpAuth,
  id: string,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'settings.manage');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }
  if (!id || id.length < 8) {
    return json({ error: 'id invalide', code: 'INVALID_INPUT' }, 400);
  }

  // Vérifier que la location appartient bien au tenant
  const existing = (await env.DB.prepare(
    `SELECT id, gbp_location_id FROM gbp_locations WHERE id = ? AND client_id = ?`,
  )
    .bind(id, auth.clientId)
    .first()) as { id: string; gbp_location_id: string | null } | null;

  if (!existing) {
    return gbpError('Location GBP introuvable', 'GBP_LOCATION_NOT_FOUND', 404);
  }

  try {
    // 1) Reset tous les is_default du tenant
    await env.DB.prepare(
      `UPDATE gbp_locations SET is_default = 0, updated_at = datetime('now')
        WHERE client_id = ?`,
    )
      .bind(auth.clientId)
      .run();

    // 2) Promote celui-ci
    await env.DB.prepare(
      `UPDATE gbp_locations SET is_default = 1, updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    )
      .bind(id, auth.clientId)
      .run();

    await audit(env, auth.userId, 'gbp.location.set_default', 'gbp_location', id, {
      gbpLocationId: existing.gbp_location_id,
    });

    return json({ data: { success: true, defaultLocationId: id } });
  } catch (e) {
    return gbpError(
      `Erreur set default location : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5) GET /api/gbp/reviews?location_id=… — list reviews JOIN sync state
//    Si stale (>1h) → trigger sync inline (bloquant ; pas de ctx ici).
// ════════════════════════════════════════════════════════════════════════════

export async function handleListGbpReviews(
  request: Request,
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'reports.view');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  const url = new URL(request.url);
  const gbpLocationId = url.searchParams.get('location_id');
  if (!gbpLocationId) {
    return json({ error: 'location_id requis', code: 'INVALID_INPUT' }, 400);
  }

  // Vérifier la propriété (multi-tenant strict) sur la location
  const location = (await env.DB.prepare(
    `SELECT id, gbp_account_id FROM gbp_locations
      WHERE gbp_location_id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(gbpLocationId, auth.clientId)
    .first()) as { id: string; gbp_account_id: string | null } | null;

  if (!location) {
    return gbpError('Location GBP introuvable', 'GBP_LOCATION_NOT_FOUND', 404);
  }

  // Lookup last_fetched_at pour décider du staleness
  const lastSync = (await env.DB.prepare(
    `SELECT MAX(last_fetched_at) as last FROM gbp_reviews_sync
      WHERE gbp_location_id = ?`,
  )
    .bind(gbpLocationId)
    .first()) as { last: string | null } | null;

  const lastFetched = lastSync?.last ? new Date(lastSync.last).getTime() : 0;
  const isStale = !lastFetched || (Date.now() - lastFetched) > REVIEWS_STALE_TTL_MS;

  // Si stale → trigger sync inline best-effort (handler 7 fait async via ctx ;
  // ici on est en lecture user-facing donc on tolère un sync court).
  if (isStale && location.gbp_account_id) {
    try {
      const conn = await getActiveGbpConnection(env, auth.clientId);
      if (conn && conn.oauth_connection_id) {
        const accessToken = await getGbpAccessToken(env, auth);
        const { reviews: liveReviews } = await gbpListReviews(
          env,
          accessToken ?? '',
          location.gbp_account_id,
          gbpLocationId,
        );
        await syncReviewsToCache(env, auth.clientId, gbpLocationId, liveReviews);
      }
    } catch {
      /* best-effort : on continue avec le cache existant */
    }
  }

  // Lecture : JOIN reviews_cache ↔ gbp_reviews_sync (LEFT JOIN car le sync row
  // peut manquer pour les reviews historiques pré-Sprint 32).
  try {
    const { results } = await env.DB.prepare(
      `SELECT rc.id, rc.client_id, rc.source, rc.author_name, rc.rating,
              rc.comment, rc.review_date, rc.reply, rc.reply_date, rc.external_id,
              grs.gbp_review_name, grs.reply_status, grs.reply_synced_at,
              grs.last_fetched_at
         FROM reviews_cache rc
         LEFT JOIN gbp_reviews_sync grs ON grs.reviews_cache_id = rc.id
        WHERE rc.client_id = ?
          AND (grs.gbp_location_id = ? OR rc.source = 'google')
        ORDER BY rc.review_date DESC, rc.fetched_at DESC
        LIMIT 200`,
    )
      .bind(auth.clientId, gbpLocationId)
      .all();

    const reviews: GbpReviewRow[] = ((results || []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ''),
      clientId: (r.client_id as string | null) ?? null,
      source: String(r.source ?? 'google'),
      authorName: (r.author_name as string | null) ?? null,
      rating: Number(r.rating ?? 0),
      comment: (r.comment as string | null) ?? null,
      reviewDate: (r.review_date as string | null) ?? null,
      reply: (r.reply as string | null) ?? null,
      replyDate: (r.reply_date as string | null) ?? null,
      externalId: (r.external_id as string | null) ?? null,
      gbpReviewName: (r.gbp_review_name as string | null) ?? null,
      replyStatus: String(r.reply_status ?? 'none'),
      replySyncedAt: (r.reply_synced_at as string | null) ?? null,
      lastFetchedAt: (r.last_fetched_at as string | null) ?? null,
    }));

    return json({ data: reviews, stale: isStale });
  } catch (e) {
    return gbpError(
      `Erreur lecture reviews : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6) POST /api/gbp/reviews/:reviewName/reply — répondre à un avis Google
//    body = { comment: string }. UPDATE reply_status=pending → live →
//    sent|failed + miroir reviews_cache.reply.
//    Note: reviewName est URL-encoded en route ; on attend la forme native
//    Google "accounts/{a}/locations/{l}/reviews/{r}".
// ════════════════════════════════════════════════════════════════════════════

export async function handleReplyGbpReview(
  request: Request,
  env: Env,
  auth: GbpAuth,
  reviewName: string,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'settings.manage');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }
  if (!reviewName || !reviewName.includes('reviews/')) {
    return json({ error: 'reviewName invalide', code: 'INVALID_INPUT' }, 400);
  }

  let body: { comment?: string };
  try {
    body = (await request.json()) as { comment?: string };
  } catch {
    return json({ error: 'JSON invalide', code: 'INVALID_INPUT' }, 400);
  }

  // Validation centralisée via gbp-engine (1-4096 chars + sanitize XSS basic).
  const replyCheck = validateReplyComment(body.comment);
  if (!replyCheck.ok) {
    return json({ error: replyCheck.error || 'comment invalide', code: replyCheck.code || 'INVALID_INPUT' }, 400);
  }
  const comment = replyCheck.sanitized!;

  // Vérifier que ce review_name appartient bien au tenant (via gbp_reviews_sync).
  // gbp_review_name est UNIQUE cross-tenant (ID Google global) mais on doit
  // s'assurer que la ligne sync existante référence le bon client_id.
  const syncRow = (await env.DB.prepare(
    `SELECT id, reviews_cache_id, gbp_location_id, client_id
       FROM gbp_reviews_sync
      WHERE gbp_review_name = ? LIMIT 1`,
  )
    .bind(reviewName)
    .first()) as {
    id: string;
    reviews_cache_id: string | null;
    gbp_location_id: string | null;
    client_id: string | null;
  } | null;

  if (!syncRow) {
    return gbpError('Avis Google introuvable', 'GBP_REVIEW_NOT_FOUND', 404);
  }
  if (syncRow.client_id !== auth.clientId) {
    return gbpError('Avis Google introuvable', 'GBP_REVIEW_NOT_FOUND', 404);
  }

  // 1) Marquer pending
  try {
    await env.DB.prepare(
      `UPDATE gbp_reviews_sync
          SET reply_status = 'pending', updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(syncRow.id)
      .run();
  } catch {
    /* best-effort */
  }

  // 2) Live call
  const conn = await getActiveGbpConnection(env, auth.clientId);
  if (!conn || !conn.oauth_connection_id) {
    // Revert pending → failed
    await env.DB.prepare(
      `UPDATE gbp_reviews_sync
          SET reply_status = 'failed', updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(syncRow.id)
      .run()
      .catch(() => undefined);
    return gbpError('Aucune connexion GBP active', 'GBP_NOT_CONNECTED', 404);
  }

  try {
    const accessToken = await getGbpAccessToken(env, auth);
    const replyResult = await gbpReplyReview(env, accessToken ?? '', reviewName, comment);
    if (!replyResult.success) {
      throw new Error(replyResult.error || 'reply failed');
    }

    const nowIso = new Date().toISOString();

    // 3a) Marquer sent
    await env.DB.prepare(
      `UPDATE gbp_reviews_sync
          SET reply_status = 'sent', reply_synced_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(nowIso, syncRow.id)
      .run();

    // 3b) Miroir reviews_cache.reply
    if (syncRow.reviews_cache_id) {
      await env.DB.prepare(
        `UPDATE reviews_cache
            SET reply = ?, reply_date = ?
          WHERE id = ? AND client_id = ?`,
      )
        .bind(comment, nowIso, syncRow.reviews_cache_id, auth.clientId)
        .run()
        .catch(() => undefined);
    }

    await audit(env, auth.userId, 'gbp.review.reply', 'gbp_review', reviewName, {
      gbpLocationId: syncRow.gbp_location_id,
      commentLength: comment.length,
    });

    return json({
      data: {
        success: true,
        reviewName,
        replyStatus: 'sent',
        repliedAt: nowIso,
      },
    });
  } catch (e) {
    // Revert pending → failed
    await env.DB.prepare(
      `UPDATE gbp_reviews_sync
          SET reply_status = 'failed', updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(syncRow.id)
      .run()
      .catch(() => undefined);

    return gbpError(
      `Erreur reply Google : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      502,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 7) POST /api/gbp/reviews/sync — trigger manuel sync background
//    Utilise ctx.waitUntil pour ne pas bloquer la réponse.
// ════════════════════════════════════════════════════════════════════════════

export async function handleTriggerGbpReviewsSync(
  env: Env,
  auth: GbpAuth,
  ctx?: ExecutionContext,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'settings.manage');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  const conn = await getActiveGbpConnection(env, auth.clientId);
  if (!conn || !conn.oauth_connection_id || !conn.gbp_account_id) {
    return gbpError('Aucune connexion GBP active', 'GBP_NOT_CONNECTED', 404);
  }

  // Lister toutes les locations du tenant à syncer
  const locResults = await env.DB.prepare(
    `SELECT gbp_location_id FROM gbp_locations
      WHERE client_id = ? AND gbp_account_id = ? AND gbp_location_id IS NOT NULL`,
  )
    .bind(auth.clientId, conn.gbp_account_id)
    .all();

  const locationIds = ((locResults.results || []) as Record<string, unknown>[])
    .map((r) => r.gbp_location_id as string | null)
    .filter((s): s is string => !!s);

  if (locationIds.length === 0) {
    return json({
      data: { success: true, syncedLocations: 0, note: 'Aucune location à syncer' },
    });
  }

  // Background sync (ctx.waitUntil) — never blocking
  const tenantId = auth.clientId;
  const accountId = conn.gbp_account_id;
  const tenantAuth: GbpAuth = { ...auth };
  const connId = conn.id;

  const syncJob = (async () => {
    try {
      const accessToken = await getGbpAccessToken(env, tenantAuth);
      for (const locId of locationIds) {
        try {
          const { reviews: liveReviews } = await gbpListReviews(
            env,
            accessToken ?? '',
            accountId,
            locId,
          );
          await syncReviewsToCache(env, tenantId, locId, liveReviews);
        } catch {
          /* best-effort par location : on continue les autres */
        }
      }
      // Mise à jour last_sync_at sur la connexion
      await env.DB.prepare(
        `UPDATE gbp_connections
            SET last_sync_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?`,
      )
        .bind(connId)
        .run()
        .catch(() => undefined);
    } catch {
      /* never throw — background job */
    }
  })();

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(syncJob);
  } else {
    // Pas de ctx (tests, appel direct) : on await pour ne pas perdre le job
    await syncJob;
  }

  await audit(env, auth.userId, 'gbp.reviews.sync_triggered', 'gbp_connection', connId, {
    locationsCount: locationIds.length,
    background: !!ctx,
  });

  return json({
    data: {
      success: true,
      triggered: true,
      locationsQueued: locationIds.length,
      background: !!ctx,
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 8) POST /api/gbp/posts — créer un Local Post (publié direct sur GBP)
//    body = { locationId, summary, topicType?, callToAction?, mediaUrl? }
//    INSERT social_posts(status=pending) → live → INSERT gbp_posts_sync →
//    UPDATE social_posts(status=published|failed).
// ════════════════════════════════════════════════════════════════════════════

export async function handleCreateGbpPost(
  request: Request,
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'settings.manage');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  let body: {
    locationId?: string;
    summary?: string;
    topicType?: string;
    callToAction?: { actionType?: string; url?: string };
    mediaUrl?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON invalide', code: 'INVALID_INPUT' }, 400);
  }

  const locationId = (body.locationId || '').trim();
  const summary = (body.summary || '').trim();

  if (!locationId) {
    return json({ error: 'locationId requis', code: 'INVALID_INPUT' }, 400);
  }
  // Validation centralisée via gbp-engine (summary 1-1500 + topicType + CTA + mediaUrl).
  const postCheck = validateLocalPostPayload({
    summary,
    topicType: body.topicType,
    callToAction: body.callToAction,
    mediaUrl: body.mediaUrl,
  });
  if (!postCheck.ok) {
    return json({ error: postCheck.error || 'payload invalide', code: postCheck.code || 'INVALID_INPUT' }, 400);
  }
  const topicType = (body.topicType || 'STANDARD').toUpperCase();

  // Vérifier propriété de la location
  const location = (await env.DB.prepare(
    `SELECT id, gbp_account_id FROM gbp_locations
      WHERE gbp_location_id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(locationId, auth.clientId)
    .first()) as { id: string; gbp_account_id: string | null } | null;

  if (!location || !location.gbp_account_id) {
    return gbpError('Location GBP introuvable', 'GBP_LOCATION_NOT_FOUND', 404);
  }

  // 1) INSERT social_posts(status=pending)
  const socialPostId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO social_posts (id, client_id, content, networks_json, status, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        socialPostId,
        auth.clientId,
        summary,
        JSON.stringify(['google_business']),
        auth.userId,
      )
      .run();
  } catch (e) {
    return gbpError(
      `Erreur création social_post : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      500,
    );
  }

  // 2) Live call
  const conn = await getActiveGbpConnection(env, auth.clientId);
  if (!conn || !conn.oauth_connection_id) {
    await env.DB.prepare(
      `UPDATE social_posts SET status = 'failed', error = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind('GBP_NOT_CONNECTED', socialPostId)
      .run()
      .catch(() => undefined);
    return gbpError('Aucune connexion GBP active', 'GBP_NOT_CONNECTED', 404);
  }

  try {
    const accessToken = await getGbpAccessToken(env, auth);
    // locationName attendu par gbp-client : "accounts/{a}/locations/{l}"
    const accountPath = location.gbp_account_id.startsWith('accounts/')
      ? location.gbp_account_id
      : `accounts/${location.gbp_account_id}`;
    const locationPath = locationId.startsWith('locations/')
      ? locationId
      : `locations/${locationId}`;
    const locationName = `${accountPath}/${locationPath}`;

    // mediaUrl (string) → media array attendu par la lib
    const mediaArr = body.mediaUrl
      ? [{ mediaFormat: 'PHOTO' as const, sourceUrl: body.mediaUrl }]
      : undefined;

    // callToAction : la lib attend actionType requis ; on filtre si absent
    const ctaPayload =
      body.callToAction && body.callToAction.actionType
        ? { actionType: body.callToAction.actionType, url: body.callToAction.url }
        : undefined;

    const liveResp = await gbpCreateLocalPost(env, accessToken ?? '', locationName, {
      summary,
      topicType: topicType as 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT',
      callToAction: ctaPayload,
      media: mediaArr,
    });

    if (!liveResp.success) {
      throw new Error(liveResp.error || 'create post failed');
    }

    const localPostName = liveResp.localPostName || null;
    const nowIso = new Date().toISOString();

    // 3a) INSERT gbp_posts_sync
    await env.DB.prepare(
      `INSERT INTO gbp_posts_sync
         (client_id, social_post_id, gbp_location_id, gbp_local_post_name,
          status, published_at)
       VALUES (?, ?, ?, ?, 'published', ?)`,
    )
      .bind(auth.clientId, socialPostId, locationId, localPostName, nowIso)
      .run()
      .catch(() => undefined);

    // 3b) UPDATE social_posts → published
    await env.DB.prepare(
      `UPDATE social_posts
          SET status = 'published', published_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(nowIso, socialPostId)
      .run()
      .catch(() => undefined);

    await audit(env, auth.userId, 'gbp.post.create', 'social_post', socialPostId, {
      gbpLocalPostName: localPostName,
      gbpLocationId: locationId,
      topicType,
    });

    return json({
      data: {
        success: true,
        socialPostId,
        gbpLocalPostName: localPostName,
        status: 'published',
        publishedAt: nowIso,
      },
    });
  } catch (e) {
    const errMsg = (e as Error).message || 'unknown';

    // Revert : social_posts → failed + gbp_posts_sync → failed
    await env.DB.prepare(
      `UPDATE social_posts SET status = 'failed', error = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(errMsg.slice(0, 500), socialPostId)
      .run()
      .catch(() => undefined);

    await env.DB.prepare(
      `INSERT INTO gbp_posts_sync
         (client_id, social_post_id, gbp_location_id, status, error)
       VALUES (?, ?, ?, 'failed', ?)`,
    )
      .bind(auth.clientId, socialPostId, locationId, errMsg.slice(0, 500))
      .run()
      .catch(() => undefined);

    return gbpError(`Erreur création post GBP : ${errMsg}`, 'GBP_API_ERROR', 502);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 9) GET /api/gbp/insights?location_id=…&start=…&end=… — metrics performances
//    3-4 métriques (impressions desktop maps, call clicks, direction requests,
//    website clicks).
// ════════════════════════════════════════════════════════════════════════════

export async function handleGetGbpInsights(
  request: Request,
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  const cap = requireCapability(auth.capabilities, 'reports.view');
  if (cap) return cap;

  if (!auth.clientId) {
    return gbpError('Tenant requis', 'GBP_NOT_CONNECTED', 403);
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get('location_id');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!locationId) {
    return json({ error: 'location_id requis', code: 'INVALID_INPUT' }, 400);
  }
  // Validation date range centralisée via gbp-engine (ISO + end>start + ≤540j).
  const rangeCheck = parseGbpDateRange(start, end);
  if (!rangeCheck.valid || !start || !end) {
    return json({ error: rangeCheck.error || 'date range invalide', code: rangeCheck.code || 'INVALID_INPUT' }, 400);
  }

  // Vérifier propriété
  const location = (await env.DB.prepare(
    `SELECT id, gbp_account_id FROM gbp_locations
      WHERE gbp_location_id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(locationId, auth.clientId)
    .first()) as { id: string; gbp_account_id: string | null } | null;

  if (!location || !location.gbp_account_id) {
    return gbpError('Location GBP introuvable', 'GBP_LOCATION_NOT_FOUND', 404);
  }

  const conn = await getActiveGbpConnection(env, auth.clientId);
  if (!conn || !conn.oauth_connection_id) {
    return gbpError('Aucune connexion GBP active', 'GBP_NOT_CONNECTED', 404);
  }

  // 4 métriques Business Profile Performance API v1 (dailyMetrics). Param
  // optionnel `metrics` (CSV) accepté pour permettre au front de demander un
  // subset — filtré via whitelist gbp-engine pour éviter 400 Google.
  const metricsParam = url.searchParams.get('metrics');
  const requestedMetrics = metricsParam ? metricsParam.split(',') : [];
  const filteredMetrics = validateMetricsList(requestedMetrics);
  const metrics = filteredMetrics.length > 0 ? filteredMetrics : [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
  ];

  try {
    const accessToken = await getGbpAccessToken(env, auth);
    // locationName attendu par lib : "locations/{l}" (sans accounts/ pour v1 Performance)
    const locationName = locationId.startsWith('locations/')
      ? locationId
      : `locations/${locationId}`;
    const insights = await gbpGetInsights(
      env,
      accessToken ?? '',
      locationName,
      metrics,
      start,
      end,
    );

    return json({
      data: {
        locationId,
        start,
        end,
        metrics,
        results: insights,
      },
    });
  } catch (e) {
    return gbpError(
      `Erreur fetch insights GBP : ${(e as Error).message || 'unknown'}`,
      'GBP_API_ERROR',
      502,
    );
  }
}

// ── Helper interne : sync live reviews → reviews_cache + gbp_reviews_sync ──
//
// Utilisé par handler 5 (sync inline si stale) et handler 7 (sync background
// via ctx.waitUntil). Best-effort par review : un INSERT qui plante n'arrête
// pas la boucle. external_id = nom Google complet pour idempotence
// (UNIQUE sur reviews_cache.external_id + UNIQUE sur gbp_reviews_sync.gbp_review_name).
async function syncReviewsToCache(
  env: Env,
  clientId: string,
  gbpLocationId: string,
  liveReviews: unknown[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const rev of liveReviews) {
    try {
      const r = rev as {
        name?: string;
        reviewer?: { displayName?: string };
        starRating?: string;
        comment?: string;
        createTime?: string;
        reviewReply?: { comment?: string; updateTime?: string };
      };
      const reviewName = r.name;
      if (!reviewName) continue;

      // Star rating Google → INTEGER 1..5 via gbp-engine (0 fallback pour
      // les colonnes NOT NULL ; null serait casseur côté SQL).
      const rating = mapStarRating(r.starRating) ?? 0;

      // 1) UPSERT reviews_cache (external_id UNIQUE = idempotent)
      // SQLite syntax : INSERT OR REPLACE conserverait l'id, mais on préfère
      // INSERT OR IGNORE + UPDATE séparé pour préserver l'id existant.
      let cacheId: string | null = null;
      const existing = (await env.DB.prepare(
        `SELECT id FROM reviews_cache WHERE external_id = ?`,
      )
        .bind(reviewName)
        .first()) as { id: string } | null;

      if (existing) {
        cacheId = existing.id;
        await env.DB.prepare(
          `UPDATE reviews_cache
              SET rating = ?, comment = ?, review_date = ?,
                  reply = ?, reply_date = ?, fetched_at = ?
            WHERE id = ?`,
        )
          .bind(
            rating,
            r.comment ?? null,
            r.createTime ?? null,
            r.reviewReply?.comment ?? null,
            r.reviewReply?.updateTime ?? null,
            nowIso,
            cacheId,
          )
          .run();
      } else {
        cacheId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO reviews_cache
             (id, client_id, source, author_name, rating, comment, review_date,
              reply, reply_date, external_id, fetched_at)
           VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            cacheId,
            clientId,
            r.reviewer?.displayName ?? null,
            rating,
            r.comment ?? null,
            r.createTime ?? null,
            r.reviewReply?.comment ?? null,
            r.reviewReply?.updateTime ?? null,
            reviewName,
            nowIso,
          )
          .run();
      }

      // 2) UPSERT gbp_reviews_sync (gbp_review_name UNIQUE)
      const existingSync = (await env.DB.prepare(
        `SELECT id FROM gbp_reviews_sync WHERE gbp_review_name = ?`,
      )
        .bind(reviewName)
        .first()) as { id: string } | null;

      if (existingSync) {
        await env.DB.prepare(
          `UPDATE gbp_reviews_sync
              SET reviews_cache_id = ?, gbp_location_id = ?, last_fetched_at = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
          .bind(cacheId, gbpLocationId, nowIso, existingSync.id)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO gbp_reviews_sync
             (client_id, reviews_cache_id, gbp_location_id, gbp_review_name,
              reply_status, last_fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            clientId,
            cacheId,
            gbpLocationId,
            reviewName,
            r.reviewReply ? 'sent' : 'none',
            nowIso,
          )
          .run();
      }
    } catch {
      /* best-effort par review : on continue */
    }
  }
}
