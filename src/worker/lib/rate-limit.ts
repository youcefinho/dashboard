// ── Sprint 23 — Sécurité / conformité — rate-limit middleware D1 ─────────
// Sliding-window via table `rate_limit_buckets` (migration seq121).
// Idiome FAIL-OPEN (calque audit() helpers.ts:70-86) : si la table est
// absente (migration non jouée) ou si D1 panne, retourne { allowed: true }
// SANS bloquer. Manager-B remplit la logique réelle Phase B.
//
// ⚠️ Sprint 91 (seq186) — Pour les NOUVEAUX usages, préférer le module
// distribué KV : src/worker/lib/rate-limit-kv.ts (middleware global,
// fixed-window counter, fail-open garanti). Ce module D1 reste en place
// pour rétro-compatibilité (handlers existants qui l'appellent déjà).

import type { Env } from '../types';
import type { RateLimitResult } from '../../lib/types';

export async function checkRateLimit(
  env: Env,
  bucketKey: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    // 1) Cleanup best-effort des hits hors fenêtre — évite la croissance
    //    infinie de la table. Le DELETE est purement opportuniste : on ne
    //    bloque pas si la DB est lente.
    await env.DB.prepare(
      `DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND hit_at < datetime('now', '-' || ? || ' seconds')`,
    ).bind(bucketKey, windowSec).run();

    // 2) Compte les hits encore dans la fenêtre glissante.
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM rate_limit_buckets WHERE bucket_key = ? AND hit_at > datetime('now', '-' || ? || ' seconds')`,
    ).bind(bucketKey, windowSec).first() as { c: number | string } | null;
    const count = Number(countRow?.c ?? 0);

    if (count >= max) {
      // 3a) Quota dépassé : calcul de retry_after basé sur le hit le plus
      //     ancien encore dans la fenêtre (date à laquelle il « sort »).
      const oldest = await env.DB.prepare(
        `SELECT hit_at FROM rate_limit_buckets WHERE bucket_key = ? AND hit_at > datetime('now', '-' || ? || ' seconds') ORDER BY hit_at ASC LIMIT 1`,
      ).bind(bucketKey, windowSec).first() as { hit_at?: string } | null;
      let retryAfter = windowSec;
      if (oldest?.hit_at) {
        // datetime('now') D1 = UTC ISO sans suffixe — Date.parse l'accepte
        // comme UTC sur Cloudflare Workers (V8). On clamp à [1..windowSec].
        const oldestMs = Date.parse(String(oldest.hit_at).replace(' ', 'T') + 'Z');
        if (!Number.isNaN(oldestMs)) {
          const elapsedSec = Math.max(0, Math.floor((Date.now() - oldestMs) / 1000));
          retryAfter = Math.max(1, windowSec - elapsedSec);
        }
      }
      return {
        allowed: false,
        remaining: 0,
        retry_after_seconds: retryAfter,
        bucket_key: bucketKey,
      };
    }

    // 3b) Quota OK : on enregistre le hit courant.
    await env.DB.prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, hit_at) VALUES (?, datetime('now'))`,
    ).bind(bucketKey).run();

    return {
      allowed: true,
      remaining: Math.max(0, max - count - 1),
      retry_after_seconds: 0,
      bucket_key: bucketKey,
    };
  } catch {
    // Fail-open : table absente (migration seq121 pas jouée), colonne
    // manquante, panne D1, etc. → on AUTORISE plutôt que de bloquer la
    // prod. Calque idiome `audit()` best-effort (helpers.ts:78-86).
    return { allowed: true, remaining: max, retry_after_seconds: 0, bucket_key: bucketKey };
  }
}
