// ── Product reviews — Sprint 40 Phase B (2026-05-24) ──────────────────────
//
// 7 handlers (3 PUBLIC + 3 AUTHED + 1 cron) pour `product_reviews` seq135.
//
// DISTINCT de `reviews.ts` (Sprint 9 — review_requests + reviews_cache Google/FB,
// INVITATIONS d'avis = flux 1st-party SÉPARÉ — NE PAS MODIFIER). Ici on couvre
// les AVIS PRODUITS clients (post-purchase rating + body + photos + verified).
//
// Capabilities FIGÉES seq80 (ZÉRO ajout à ALL_CAPABILITIES) :
//   - `reports.view`   : modération queue (lecture).
//   - `clients.manage` : modération action + delete (mutations).
//
// PUBLIC submit = anti-bot strict :
//   - honeypot champ `website_url` (HANDLER : non vide ⇒ silent drop 200).
//   - rate-limit IP via `rate_limit_buckets` seq121 (5 submit / IP / 3600s),
//     bypass si verified_buyer (fast-track).
//   - verified_buyer fast-track + spam_score auto-flag (>50 ⇒ 'flagged').
//   - badWords détectés ⇒ override 'flagged' (modération manuelle obligatoire).
//
// Réponses normalisées { data } / { error } (PAS de champ `code` — apiFetch
// GELÉ, calque ecommerce-cart-recovery.ts).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import {
  computeSpamScore,
  containsBadWords,
  checkVerifiedBuyer,
  autoApproveDecision,
} from './lib/review-moderation';
import { checkRateLimit } from './lib/rate-limit';
import {
  validateReviewInput,
  validateModerationAction as engineValidateModerationAction,
  isValidPhotoUrl,
  MAX_PHOTOS_PER_REVIEW,
} from './lib/product-reviews-engine';

type Auth = CapAuth & { capabilities?: Set<string> };

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Résout client_id du tenant courant (pattern ecommerce-cart-recovery.ts). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

/** SHA-256 hex (anonymisation IP Loi 25 — pas d'IP brute stockée). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Recompute products.avg_rating + reviews_count depuis avis approuvés. */
async function recomputeProductAggregates(env: Env, productId: string): Promise<void> {
  try {
    const row = (await env.DB.prepare(
      `SELECT COALESCE(AVG(rating), 0) AS avg_r, COUNT(*) AS cnt
         FROM product_reviews
        WHERE product_id = ? AND status = 'approved'`,
    )
      .bind(productId)
      .first()) as { avg_r: number | string; cnt: number | string } | null;

    const avg = Number(row?.avg_r ?? 0);
    const cnt = Number(row?.cnt ?? 0);

    await env.DB.prepare(
      `UPDATE products
          SET avg_rating = ?, reviews_count = ?, reviews_last_updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(avg, cnt, productId)
      .run();
  } catch {
    // Best-effort : colonnes possiblement absentes selon version migration.
    // Fallback silencieux — ne bloque pas l'action principale.
  }
}

// ── PUBLIC handlers (3) ────────────────────────────────────────────────────

/**
 * POST /api/products/:productId/reviews — submit avis PUBLIC anonyme.
 *
 * Contrat FIGÉ : handleSubmitProductReview(request, env, productId) -> Response.
 */
export async function handleSubmitProductReview(
  request: Request,
  env: Env,
  productId: string,
): Promise<Response> {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'JSON invalide' }, 400);
    }

    // ── 1) Honeypot : champ piège pour bots naïfs. Non vide ⇒ silent drop.
    //    Réponse 200 fake success pour ne pas signaler au bot qu'il est détecté.
    const honeypot = body.website_url;
    if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
      return json({ data: { id: 'silent_drop' } });
    }

    // ── 2) Validation stars + body via engine (codes stables + sanitize XSS).
    //    NB : on délègue `stars` (alias accepté par engine) ou `rating` legacy.
    //    Le contrat HANDLER retourne `{ error }` FR figé (pas le code stable).
    const validation = validateReviewInput({
      stars: body.stars ?? body.rating,
      body: body.body,
      // photo_url: validation single photo n'est PAS appliquée ici (handler
      //   accepte un array `photos[]` — chaque URL est filtrée séparément
      //   ci-dessous via isValidPhotoUrl).
    });
    if (!validation.ok || !validation.data) {
      return json({ error: validation.error || 'Input invalide' }, 400);
    }
    const rating = validation.data.stars;
    const reviewBody = validation.data.body;

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Email requis' }, 400);
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : null;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : null;
    // Filtrage strict photos : https + ext jpg/png/webp (drop silencieux des
    // URLs invalides — anti-XSS via .svg / data: / http downgrades).
    const photos = Array.isArray(body.photos)
      ? (body.photos as unknown[])
          .filter((p): p is string => typeof p === 'string' && isValidPhotoUrl(p))
          .slice(0, MAX_PHOTOS_PER_REVIEW)
      : [];
    const orderIdRaw = typeof body.order_id === 'string' ? body.order_id.trim() : '';
    const locale = typeof body.locale === 'string' ? body.locale.slice(0, 10) : 'fr-CA';

    // ── 3) Hash IP (anonymisation Loi 25).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const sha256Ip = await sha256Hex(ip);

    // ── 4) Lookup product → client_id (404 si inexistant).
    const product = (await env.DB.prepare(
      'SELECT client_id FROM products WHERE id = ? LIMIT 1',
    )
      .bind(productId)
      .first()) as { client_id: string | null } | null;
    if (!product || !product.client_id) {
      return json({ error: 'Produit introuvable' }, 404);
    }
    const clientId = product.client_id;

    // ── 5) Lookup customer_id (best-effort — pas obligatoire).
    let customerId: string | null = null;
    try {
      const cust = (await env.DB.prepare(
        'SELECT id FROM customers WHERE email = ? AND client_id = ? LIMIT 1',
      )
        .bind(email, clientId)
        .first()) as { id: string | null } | null;
      customerId = cust?.id || null;
    } catch {
      customerId = null;
    }

    // ── 6) Verified buyer (orderId déduit si match). Fast-track le rate-limit.
    const { verified, orderId } = await checkVerifiedBuyer(
      env,
      clientId,
      productId,
      customerId,
      email,
    );

    // ── 7) Rate-limit IP (bypass si verified — acheteur réel toujours autorisé).
    if (!verified) {
      const rl = await checkRateLimit(env, `review:submit:${sha256Ip}`, 5, 3600);
      if (!rl.allowed) {
        return json(
          {
            error: 'Trop de tentatives',
            message: 'Veuillez réessayer plus tard.',
            retry_after_seconds: rl.retry_after_seconds,
          },
          429,
        );
      }
    }

    // ── 8) Heuristiques anti-spam + décision auto.
    const spamScore = computeSpamScore(reviewBody, locale);
    const badWords = containsBadWords(reviewBody, locale);
    let status = autoApproveDecision(rating, verified, spamScore.score);
    if (badWords) status = 'flagged'; // override : badwords ⇒ modération manuelle.

    // ── 9) INSERT product_reviews.
    const id = crypto.randomUUID();
    const photosJson = JSON.stringify(photos);
    const finalOrderId = orderId || (orderIdRaw ? orderIdRaw.slice(0, 64) : null);

    await env.DB.prepare(
      `INSERT INTO product_reviews (
         id, client_id, product_id, customer_id, order_id,
         rating, title, body, photos_json,
         verified_buyer, status, spam_score,
         submitter_ip, submitter_locale, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        id,
        clientId,
        productId,
        customerId,
        finalOrderId,
        rating,
        title,
        reviewBody,
        photosJson,
        verified ? 1 : 0,
        status,
        spamScore.score,
        sha256Ip,
        locale,
      )
      .run();

    // ── 10) Si auto-approved : recompute product aggregates.
    if (status === 'approved') {
      await recomputeProductAggregates(env, productId);
    }

    // ── 11) Audit (submitter anonyme = userId 'public', name optionnel en details).
    await audit(env, 'public', 'product_review_submitted', 'product_review', id, {
      product_id: productId,
      client_id: clientId,
      rating,
      status,
      verified,
      spam_score: spamScore.score,
      name,
    });

    return json({ data: { id, status } });
  } catch (err) {
    console.error('handleSubmitProductReview failed', productId, err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

/**
 * GET /api/products/:productId/reviews — list avis approuvés PUBLIC.
 *
 * Filtres : ?rating=N (1-5), ?verified_only=1, ?limit=N (max 100).
 * PUBLIC ⇒ status forcé à 'approved' (jamais pending/rejected/flagged).
 * Ordering : helpful_count DESC, created_at DESC.
 *
 * Contrat FIGÉ : handleListProductReviews(request, env, productId, url) -> Response.
 */
export async function handleListProductReviews(
  request: Request,
  env: Env,
  productId: string,
  url: URL,
): Promise<Response> {
  void request;
  try {
    const ratingParam = url.searchParams.get('rating');
    const verifiedOnly = url.searchParams.get('verified_only') === '1';
    const limitRaw = Number(url.searchParams.get('limit') || '20');
    const limit = Math.max(1, Math.min(100, Math.floor(limitRaw) || 20));

    const filters: string[] = [
      'product_id = ?',
      "status = 'approved'",
    ];
    const binds: unknown[] = [productId];

    if (ratingParam) {
      const r = Math.round(Number(ratingParam));
      if (r >= 1 && r <= 5) {
        filters.push('rating = ?');
        binds.push(r);
      }
    }
    if (verifiedOnly) {
      filters.push('verified_buyer = 1');
    }

    const sql = `SELECT id, rating, title, body, photos_json, verified_buyer,
                        helpful_count, created_at
                   FROM product_reviews
                  WHERE ${filters.join(' AND ')}
                  ORDER BY helpful_count DESC, created_at DESC
                  LIMIT ?`;
    binds.push(limit);

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch (err) {
    console.error('handleListProductReviews failed', productId, err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

/**
 * POST /api/reviews/:id/helpful — vote utile PUBLIC anonyme.
 *
 * Anti-rejeu : UNIQUE (review_id, voter_ip_hash). SHA-256 hex de l'IP
 * (anonymisation Loi 25 — pas d'IP brute stockée).
 *
 * Contrat FIGÉ : handleVoteHelpful(request, env, reviewId) -> Response.
 */
export async function handleVoteHelpful(
  request: Request,
  env: Env,
  reviewId: string,
): Promise<Response> {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const sha256Ip = await sha256Hex(ip);
    const voteId = crypto.randomUUID();

    // INSERT OR IGNORE : si UNIQUE viole ⇒ no-op idempotent (déjà voté).
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO product_review_helpful_votes
         (id, review_id, voter_ip_hash, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
      .bind(voteId, reviewId, sha256Ip)
      .run();

    const changes = (res.meta?.changes as number) || 0;
    if (changes > 0) {
      await env.DB.prepare(
        'UPDATE product_reviews SET helpful_count = helpful_count + 1 WHERE id = ?',
      )
        .bind(reviewId)
        .run();
    }

    return json({ data: { ok: true } });
  } catch (err) {
    console.error('handleVoteHelpful failed', reviewId, err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

// ── AUTHED handlers (3) ────────────────────────────────────────────────────

/**
 * GET /api/reviews/moderation-queue — queue modération admin.
 *
 * Capability `reports.view` (lecture). Renvoie pending + flagged du tenant,
 * triés par spam_score DESC (plus suspects en tête).
 *
 * Contrat FIGÉ : handleModerationQueue(env, auth, url) -> Response.
 */
export async function handleModerationQueue(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  try {
    const caps = await getCaps(env, auth);
    const denied = requireCapability(caps, 'reports.view');
    if (denied) return denied;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    void url; // filtres optionnels — pas exposés Phase B (queue compacte).

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, product_id, customer_id, order_id,
              rating, title, body, photos_json,
              verified_buyer, status, spam_score,
              submitter_ip, submitter_locale, created_at,
              moderation_notes, moderator_id, moderated_at,
              helpful_count
         FROM product_reviews
        WHERE client_id = ? AND status IN ('pending', 'flagged')
        ORDER BY spam_score DESC, created_at ASC
        LIMIT 50`,
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    console.error('handleModerationQueue failed', err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

/**
 * POST /api/reviews/:id/moderate — décision modération admin.
 *
 * Capability `clients.manage`. Body : { action: 'approve'|'reject'|'flag',
 * notes?: string }. Recompute product.avg_rating + reviews_count si transition
 * vers 'approved'.
 *
 * Contrat FIGÉ : handleModerateReview(request, env, auth, id) -> Response.
 */
export async function handleModerateReview(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  try {
    const caps = await getCaps(env, auth);
    const denied = requireCapability(caps, 'clients.manage');
    if (denied) return denied;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'JSON invalide' }, 400);
    }

    const action = typeof body.action === 'string' ? body.action : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;

    // Whitelist engine (approve|reject|flag|delete) — handler restreint à 3.
    // 'delete' passe par DELETE /api/reviews/:id (handleDeleteReview) — refusé ici.
    if (!engineValidateModerationAction(action) || action === 'delete') {
      return json({ error: 'Action invalide (approve|reject|flag)' }, 400);
    }
    let newStatus: 'approved' | 'rejected' | 'flagged';
    if (action === 'approve') newStatus = 'approved';
    else if (action === 'reject') newStatus = 'rejected';
    else newStatus = 'flagged'; // 'flag' (seul restant après whitelist + exclude delete)

    // Load avis (pour product_id + ancien statut, bornage strict tenant).
    const review = (await env.DB.prepare(
      'SELECT id, product_id, status FROM product_reviews WHERE id = ? AND client_id = ? LIMIT 1',
    )
      .bind(id, clientId)
      .first()) as { id: string; product_id: string; status: string } | null;
    if (!review) return json({ error: 'Avis introuvable' }, 404);

    const oldStatus = review.status;

    const upd = await env.DB.prepare(
      `UPDATE product_reviews
          SET status = ?, moderation_notes = ?, moderator_id = ?, moderated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    )
      .bind(newStatus, notes, auth.userId, id, clientId)
      .run();

    if (((upd.meta?.changes as number) || 0) === 0) {
      return json({ error: 'Avis introuvable' }, 404);
    }

    // Recompute si transition vers 'approved' depuis pending/flagged
    // (avg_rating + reviews_count changent).
    const wasInModeration = oldStatus === 'pending' || oldStatus === 'flagged';
    if (newStatus === 'approved' && wasInModeration) {
      await recomputeProductAggregates(env, review.product_id);
    } else if (oldStatus === 'approved' && newStatus !== 'approved') {
      // Si on retire un avis précédemment approuvé : recompute aussi.
      await recomputeProductAggregates(env, review.product_id);
    }

    await audit(env, auth.userId, 'product_review_moderated', 'product_review', id, {
      action,
      notes,
      old_status: oldStatus,
      new_status: newStatus,
      product_id: review.product_id,
    });

    return json({ data: { id, status: newStatus } });
  } catch (err) {
    console.error('handleModerateReview failed', id, err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

/**
 * DELETE /api/reviews/:id — supprime un avis (admin only).
 *
 * Capability `clients.manage`. Bornage strict tenant. Recompute product
 * aggregates après suppression (cascade FK supposée présente seq135 sur
 * product_review_helpful_votes).
 *
 * Contrat FIGÉ : handleDeleteReview(env, auth, id) -> Response.
 */
export async function handleDeleteReview(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  try {
    const caps = await getCaps(env, auth);
    const denied = requireCapability(caps, 'clients.manage');
    if (denied) return denied;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();

    // Load product_id avant DELETE pour recompute aggregates.
    const review = (await env.DB.prepare(
      'SELECT id, product_id, rating, status FROM product_reviews WHERE id = ? AND client_id = ? LIMIT 1',
    )
      .bind(id, clientId)
      .first()) as { id: string; product_id: string; rating: number; status: string } | null;
    if (!review) return json({ error: 'Avis introuvable' }, 404);

    const del = await env.DB.prepare(
      'DELETE FROM product_reviews WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .run();

    if (((del.meta?.changes as number) || 0) === 0) {
      return json({ error: 'Avis introuvable' }, 404);
    }

    // Recompute systématique (l'avis supprimé pouvait être approuvé).
    await recomputeProductAggregates(env, review.product_id);

    await audit(env, auth.userId, 'product_review_deleted', 'product_review', id, {
      product_id: review.product_id,
      rating: review.rating,
      previous_status: review.status,
    });

    return json({ data: { id, deleted: true } });
  } catch (err) {
    console.error('handleDeleteReview failed', id, err);
    return json({ error: 'Erreur interne' }, 500);
  }
}

// ── Cron handler (1) ────────────────────────────────────────────────────────

/**
 * Cron périodique : auto-flag heuristique des avis 'pending' > 24h. Re-score
 * via computeSpamScore (drift dictionnaire) + bump à 'flagged' si la nouvelle
 * décision le dicte.
 *
 * Idempotent : ne touche QUE pending → flagged (jamais autre transition).
 * Best-effort par row (jamais de throw global).
 *
 * Contrat FIGÉ : runReviewModerationAutoFlagCron(env)
 *   -> Promise<{ rescored, flagged }>.
 */
export async function runReviewModerationAutoFlagCron(
  env: Env,
): Promise<{ rescored: number; flagged: number }> {
  let rescored = 0;
  let flagged = 0;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, body, rating, verified_buyer, spam_score, submitter_locale
         FROM product_reviews
        WHERE status = 'pending'
          AND created_at < datetime('now', '-24 hours')
        ORDER BY created_at ASC
        LIMIT 50`,
    ).all();

    for (const r of (results || []) as Array<{
      id: string;
      body: string;
      rating: number;
      verified_buyer: number;
      spam_score: number;
      submitter_locale: string | null;
    }>) {
      try {
        const locale = r.submitter_locale || 'fr-CA';
        const score = computeSpamScore(r.body || '', locale);
        const decision = autoApproveDecision(
          Number(r.rating) || 0,
          Boolean(r.verified_buyer),
          score.score,
        );
        rescored += 1;

        if (decision === 'flagged') {
          const upd = await env.DB.prepare(
            `UPDATE product_reviews
                SET status = 'flagged', spam_score = ?
              WHERE id = ? AND status = 'pending'`,
          )
            .bind(score.score, r.id)
            .run();
          if (((upd.meta?.changes as number) || 0) > 0) flagged += 1;
        } else if (score.score !== Number(r.spam_score)) {
          // Drift de score sans changement de décision : refresh la colonne.
          await env.DB.prepare(
            "UPDATE product_reviews SET spam_score = ? WHERE id = ? AND status = 'pending'",
          )
            .bind(score.score, r.id)
            .run();
        }
      } catch (err) {
        console.error('runReviewModerationAutoFlagCron row failed', r.id, err);
      }
    }
  } catch (err) {
    console.error('runReviewModerationAutoFlagCron failed', err);
  }

  return { rescored, flagged };
}
