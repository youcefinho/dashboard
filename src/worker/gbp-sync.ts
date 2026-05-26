// ════════════════════════════════════════════════════════════
// Sprint 32 — GBP Reviews Sync (cron best-effort)
// ════════════════════════════════════════════════════════════
//
// ── OBJECTIF ────────────────────────────────────────────────
//
// Cron processor invoqué depuis `src/worker.ts → scheduled()` en
// best-effort (ctx.waitUntil + .catch(() => {})). Il itère sur les
// `gbp_connections` ACTIVES et leurs `gbp_locations` jamais
// synchronisées (ou pas synchronisées depuis > 1h) pour récupérer
// les derniers avis Google via `gbpListReviews` (A1 lib/gbp-client),
// et alimenter :
//   - `reviews_cache` (UPSERT par external_id, source_origin='google')
//   - `gbp_reviews_sync` (UPSERT par gbp_review_name, last_fetched_at)
//   - `gbp_locations.updated_at` (timestamp courant)
//
// ── ISOLATION TENANT (NON NÉGOCIABLE) ───────────────────────
//
// Chaque ligne sélectionnée porte son `client_id` et c'est CE
// `client_id` qui est binded lors des UPSERTs. Aucune jointure
// cross-tenant possible (la sélection est déjà bornée).
//
// ── BEST-EFFORT ─────────────────────────────────────────────
//
// Le processor try/catch chaque tenant individuellement : une
// erreur token/API sur 1 location n'empêche PAS le traitement des
// autres. Le compte `{ processed, errors }` est retourné pour les
// logs / observabilité. Le wrapper appelant (worker.ts scheduled)
// fait `.catch(() => {})` de toute façon.
//
// ── LIMITES VOLONTAIRES ─────────────────────────────────────
//
// LIMIT 20 locations / cron → évite de saturer le quota Google API
// (1 cron / 5min en prod selon wrangler crontab). 20 locations × ~10
// reviews moyennes = ~200 fetch + ~400 UPSERTs / cron → safe edge.

import type { Env } from './types';
import { getGbpAccessToken, gbpListReviews } from './lib/gbp-client';
import { createLogger } from './lib/logger';

export const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1h par tenant max

export interface GbpSyncResult {
  processed: number;
  errors: number;
}

export async function processGbpReviewsSync(env: Env): Promise<GbpSyncResult> {
  const logger = createLogger(env);
  let processed = 0;
  let errors = 0;

  try {
    // SELECT gbp_connections ACTIVES + gbp_locations non sync depuis > 1h
    const rows = await env.DB.prepare(`
      SELECT gc.client_id, gc.oauth_connection_id, gl.gbp_account_id, gl.gbp_location_id, gl.id as location_id
      FROM gbp_connections gc
      JOIN gbp_locations gl ON gl.gbp_connection_id = gc.id
      WHERE gc.status='active' AND (gl.updated_at IS NULL OR gl.updated_at < datetime('now', '-1 hour'))
      LIMIT 20
    `).all<any>();

    for (const row of rows.results ?? []) {
      try {
        const accessToken = await getGbpAccessToken(env, { clientId: row.client_id } as any);
        if (!accessToken) {
          errors++;
          continue;
        }

        const result = await gbpListReviews(
          env,
          accessToken,
          row.gbp_account_id,
          row.gbp_location_id,
        );

        // UPSERT chaque review dans reviews_cache + gbp_reviews_sync
        for (const r of (result?.reviews ?? []) as any[]) {
          // UPSERT reviews_cache (source_origin='google', clé external_id)
          await env.DB.prepare(`
            INSERT INTO reviews_cache (id, client_id, source_origin, external_id, rating, content, author_name, created_at)
            VALUES (lower(hex(randomblob(16))), ?, 'google', ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(external_id) DO UPDATE SET rating=excluded.rating, content=excluded.content, updated_at=datetime('now')
          `).bind(
            row.client_id,
            r.name,
            r.starRating ?? 0,
            r.comment ?? '',
            r.reviewer?.displayName ?? '',
          ).run();

          // UPSERT gbp_reviews_sync (clé gbp_review_name, last_fetched_at)
          await env.DB.prepare(`
            INSERT INTO gbp_reviews_sync (client_id, gbp_location_id, gbp_review_name, last_fetched_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(gbp_review_name) DO UPDATE SET last_fetched_at=datetime('now')
          `).bind(
            row.client_id,
            row.location_id,
            r.name,
          ).run();
        }

        // UPDATE gbp_locations.updated_at (marque le tenant comme sync)
        await env.DB.prepare(
          "UPDATE gbp_locations SET updated_at=datetime('now') WHERE id=?"
        ).bind(row.location_id).run();

        processed++;
      } catch (e: any) {
        errors++;
        logger.warn('gbp.sync_review_failed', {
          client_id: row.client_id,
          location: row.gbp_location_id,
          error: e?.message,
        });
      }
    }
  } catch (e: any) {
    logger.error('gbp.sync.error', { error: e?.message });
  }

  return { processed, errors };
}
