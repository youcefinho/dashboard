// ── social-publish.ts — LOT SOCIAL PLANNER (Sprint 9) — NEUF (owned Manager-B)
//
// ⚠ État : corps réels Phase B (Manager-B). Signatures FIGÉES (worker.ts
//   scheduled() appelle déjà processDueSocialPosts). Imports worker RELATIFS.
//
// Cron de publication MOCK (calque EXACT broadcast.ts:runDueScheduledBroadcasts) :
//   SELECT social_posts WHERE scheduled_at <= now AND status='queued' LIMIT 50 →
//   UPDATE status='processing' (verrou idempotence) → publishToNetwork() MOCK par
//   réseau → UPDATE status='published'/'failed' + published_at. BEST-EFFORT : un
//   post en erreur n'arrête PAS les autres ; jamais throw (le worker.ts l'appelle
//   en .catch(() => undefined)).
//
// Publication sociale RÉELLE = MOCK / flag INACTIF (calque whatsapp.ts:
//   sendWhatsAppTemplate l.188) : sans credentials OAuth social, publishToNetwork
//   renvoie { success:false, mock:true } SANS appel réseau.

import type { Env } from './types';
import type { SocialProvider } from '../lib/types';
import { socialProviderCredentials } from './social-accounts';

// Parse tolérant d'un tableau JSON (networks_json). Best-effort : corruption → [].
function parseProviders(raw: unknown): SocialProvider[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x)) as SocialProvider[];
    return [];
  } catch {
    return [];
  }
}

/**
 * publishToNetwork — publication MOCK d'un post sur un réseau (flag INACTIF).
 *
 * Calque EXACT whatsapp.ts:sendWhatsAppTemplate l.188 : sans credentials OAuth
 * social du provider (account inactif / token absent), renvoie
 * { success:false, mock:true } SANS appel réseau. socialProviderCredentials
 * renvoie null ce sprint ⇒ TOUJOURS mock. Manager-B branche le POST réel par
 * provider quand les credentials OAuth social existent (E4/E6 — INACTIFS ce
 * sprint). Analytics = MOCK / flag (hors scope).
 */
export async function publishToNetwork(
  env: Env,
  account: { provider: SocialProvider; access_token?: string | null; status?: string } | null,
  _post: { id: string; content: string },
): Promise<{ success: boolean; mock?: boolean; external_id?: string; error?: string }> {
  const provider = account?.provider;
  const creds = provider ? socialProviderCredentials(env, provider) : null;

  // FLAG INACTIF — credentials provider absents, OU compte non actif / token
  // absent : aucun appel réseau (calque sendWhatsAppTemplate l.188).
  if (!creds || !account || account.status !== 'active' || !account.access_token) {
    return {
      success: false,
      mock: true,
      error: `${provider || 'réseau'} non configuré`,
    };
  }

  // Avec credentials réels (E4/E6 — INACTIFS ce sprint) : Manager-B branche ici
  // le POST vers l'API du provider. AUCUN fetch réseau social ce sprint.
  return { success: false, mock: true, error: `${provider} non configuré` };
}

/**
 * processDueSocialPosts — due-processor du cron de publication (best-effort).
 *
 * CALQUE runDueScheduledBroadcasts (broadcast.ts:474) :
 *   1. SELECT … FROM social_posts WHERE scheduled_at IS NOT NULL AND
 *      scheduled_at <= datetime('now') AND status='queued' ORDER BY scheduled_at
 *      ASC LIMIT 50.
 *   2. Pour chaque post : UPDATE status='processing' WHERE id=? AND status='queued'
 *      (verrou d'idempotence — un second tick ne le re-sélectionne pas).
 *   3. Pour chaque réseau de networks_json : publishToNetwork(env, account, post)
 *      (MOCK tant que les credentials OAuth social sont absents).
 *   4. UPDATE status='published' (ou 'failed' + error) + published_at=datetime('now').
 *   try/catch par post ; jamais throw (best-effort).
 */
export async function processDueSocialPosts(env: Env): Promise<void> {
  let due: Array<Record<string, unknown>> = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, client_id, content, media_json, networks_json
         FROM social_posts
        WHERE scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')
          AND status = 'queued'
        ORDER BY scheduled_at ASC LIMIT 50`,
    ).all();
    due = (r.results || []) as Array<Record<string, unknown>>;
  } catch (err) {
    console.error('processDueSocialPosts: select failed', err);
    return;
  }

  for (const p of due) {
    const postId = String(p.id || '');
    if (!postId) continue;
    try {
      // Verrou d'idempotence : passe à 'processing' SEULEMENT si encore 'queued'
      // (un second tick concurrent ne le re-traitera pas). meta.changes==0 ⇒
      // déjà pris par un autre tick → on saute.
      const lock = await env.DB.prepare(
        `UPDATE social_posts
            SET status = 'processing', updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
      ).bind(postId).run();
      if (lock.meta && typeof lock.meta.changes === 'number' && lock.meta.changes === 0) {
        continue;
      }

      const clientId = (p.client_id as string) || null;
      const content = String(p.content || '');
      const networks = parseProviders(p.networks_json);

      // Pour chaque réseau ciblé : charge le compte social du tenant (peut être
      // absent / inactif), tente la publication MOCK. Tous OK ⇒ published, sinon
      // failed + agrégat d'erreurs.
      const errors: string[] = [];
      let attempted = 0;
      for (const provider of networks) {
        attempted++;
        let account:
          | { provider: SocialProvider; access_token?: string | null; status?: string }
          | null = null;
        try {
          const acc = (await env.DB.prepare(
            `SELECT provider, access_token, status FROM social_accounts
              WHERE provider = ?${clientId ? ' AND client_id = ?' : ''}
              ORDER BY updated_at DESC LIMIT 1`,
          ).bind(...(clientId ? [provider, clientId] : [provider])).first()) as
            | { provider: SocialProvider; access_token: string | null; status: string }
            | null;
          account = acc;
        } catch {
          account = null;
        }

        const res = await publishToNetwork(env, account, { id: postId, content });
        if (!res.success) {
          errors.push(`${provider}: ${res.error || 'échec'}`);
        }
      }

      // Aucun réseau ciblé = rien à publier ⇒ on marque failed (post vide), sinon
      // published si tous OK, failed sinon. (Toutes les publications sont mock ce
      // sprint ⇒ failed/mock — aucun appel réseau réel.)
      const allOk = attempted > 0 && errors.length === 0;
      if (allOk) {
        await env.DB.prepare(
          `UPDATE social_posts
              SET status = 'published', published_at = datetime('now'),
                  error = NULL, updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(postId).run();
      } else {
        const errMsg = attempted === 0
          ? 'Aucun réseau ciblé'
          : errors.join(' | ').slice(0, 1000);
        await env.DB.prepare(
          `UPDATE social_posts
              SET status = 'failed', error = ?, updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(errMsg, postId).run();
      }
    } catch (err) {
      // Best-effort : un post en erreur n'arrête PAS les autres ; jamais throw.
      // On tente de marquer 'failed' (best-effort), sinon on laisse en
      // 'processing' (le post ne sera PAS re-sélectionné — status != 'queued').
      console.error('processDueSocialPosts: post failed', postId, err);
      try {
        await env.DB.prepare(
          `UPDATE social_posts
              SET status = 'failed', error = ?, updated_at = datetime('now')
            WHERE id = ? AND status = 'processing'`,
        ).bind(String(err).slice(0, 1000), postId).run();
      } catch {
        // avalé — best-effort, jamais throw.
      }
    }
  }
}
