// ── reputation.ts — LOT REPUTATION (Sprint 8) — handlers PRO ────────────────
//
// Gestion PRO de la réputation (réglages routing + lecture du feedback privé +
// notification). Fichier NEUF et ISOLÉ — N'ÉTEND PAS et NE MODIFIE PAS reviews.ts
// (les 7 routes /api/reviews/* restent intactes). Lit/écrit reputation_settings
// (seq 109) et liste private_feedback (seq 109), bornés client_id.
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS : worker.ts
//   (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ Phase A) appelle
//   les endpoints. Contrat §6 verbatim dans docs/LOT-REPUTATION.md.
//
// Conventions imposées (docs/LOT-REPUTATION.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Capability : RÉUTILISE le pattern de reviews.ts. reviews.ts gate par
//     `auth.role === 'admin'`. Côté capabilities (seq 80), on RÉUTILISE
//     'settings.manage' OU 'workflows.manage' (déjà dans ALL_CAPABILITIES —
//     calque SMS/WhatsApp/IVR/OAuth/storefront). ZÉRO ajout à ALL_CAPABILITIES.
//   - Bornage tenant STRICT : client_id résolu via auth.clientId / getClientModules
//     (calque storefront-public.ts:resolveProClientId). Toute requête WHERE
//     client_id = <résolu>.
//   - best-effort : table/colonne absente (seq 109 non jouée) → réponse propre
//     ({ data } par défaut / 500 maîtrisé), JAMAIS de throw nu.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { getClientModules } from './modules';

// Auth enrichi au choke-point (worker.ts) pour les routes PRO — calque le type
// passé à routeProtected (userId/role/clientId/tenant/capabilities).
export type ReputationAuth = CapAuth & { capabilities?: Set<string> };

// Garde capability PRO (calque storefront-public.ts:capGuard / booking-public.ts).
// RÉUTILISE 'settings.manage' (déjà dans ALL_CAPABILITIES seq 80). AUCUN ajout.
function capGuard(auth: ReputationAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

/** Résout le client_id du tenant connecté (PRO). null ⇒ pas de tenant. */
async function resolveProClientId(env: Env, auth: ReputationAuth): Promise<string | null> {
  if (auth.clientId) return auth.clientId;
  try {
    const { clientId } = await getClientModules(env, auth.userId, auth.tenant);
    return clientId;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STUBS → CORPS RÉELS Phase B (Manager-B). Signatures FIGÉES Phase A.
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/reputation/settings — réglages réputation du tenant (PRO).
 * Corps réel Phase B (Manager-B) : SELECT reputation_settings WHERE client_id = ?
 * ; si absent, renvoie les défauts (rating_threshold 4, widget_enabled 0,
 * notify_on_review 1). Forme = ReputationSettings.
 */
export async function handleGetReputationSettings(
  env: Env,
  auth: ReputationAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;
  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  // SELECT borné client_id ; défauts si pas de row (table seq 109 vide / non jouée).
  try {
    const row = (await env.DB.prepare(
      `SELECT client_id, rating_threshold, public_redirect_url, widget_enabled, notify_on_review, updated_at
         FROM reputation_settings WHERE client_id = ?`,
    ).bind(clientId).first()) as Record<string, unknown> | null;
    if (row) return json({ data: row });
  } catch { /* best-effort : table absente ⇒ défauts */ }

  return json({
    data: {
      client_id: clientId,
      rating_threshold: 4,
      public_redirect_url: null,
      widget_enabled: 0,
      notify_on_review: 1,
    },
  });
}

/**
 * PATCH /api/reputation/settings — met à jour les réglages (seuil, URL publique,
 * widget, notif). Corps réel Phase B (Manager-B) : UPSERT reputation_settings
 * (INSERT ... ON CONFLICT(client_id) DO UPDATE, ou INSERT OR REPLACE) borné
 * client_id, merge partiel. Renvoie l'état complet (ReputationSettings).
 */
export async function handleUpdateReputationSettings(
  request: Request,
  env: Env,
  auth: ReputationAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;
  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  // Merge partiel sur l'existant (ou les défauts) — on ne touche que les champs
  // fournis. Lecture préalable bornée client_id.
  let current: Record<string, unknown> = {
    rating_threshold: 4,
    public_redirect_url: null,
    widget_enabled: 0,
    notify_on_review: 1,
  };
  try {
    const row = (await env.DB.prepare(
      'SELECT rating_threshold, public_redirect_url, widget_enabled, notify_on_review FROM reputation_settings WHERE client_id = ?',
    ).bind(clientId).first()) as Record<string, unknown> | null;
    if (row) current = row;
  } catch { /* best-effort */ }

  const ratingThreshold = body?.rating_threshold != null
    ? Math.max(1, Math.min(5, Math.round(Number(body.rating_threshold))))
    : Number(current.rating_threshold ?? 4);
  const publicRedirectUrl = body?.public_redirect_url !== undefined
    ? (sanitizeInput(body.public_redirect_url as string, 500) || null)
    : ((current.public_redirect_url as string) || null);
  const widgetEnabled = body?.widget_enabled !== undefined
    ? (body.widget_enabled ? 1 : 0)
    : Number(current.widget_enabled ?? 0);
  const notifyOnReview = body?.notify_on_review !== undefined
    ? (body.notify_on_review ? 1 : 0)
    : Number(current.notify_on_review ?? 1);

  try {
    // UPSERT borné client_id (PK reputation_settings.client_id).
    await env.DB.prepare(
      `INSERT INTO reputation_settings (client_id, rating_threshold, public_redirect_url, widget_enabled, notify_on_review, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(client_id) DO UPDATE SET
         rating_threshold = excluded.rating_threshold,
         public_redirect_url = excluded.public_redirect_url,
         widget_enabled = excluded.widget_enabled,
         notify_on_review = excluded.notify_on_review,
         updated_at = datetime('now')`,
    ).bind(clientId, ratingThreshold, publicRedirectUrl, widgetEnabled, notifyOnReview).run();
  } catch (err) {
    console.error('updateReputationSettings UPSERT failed:', err);
    return json({ error: 'Échec mise à jour des réglages' }, 500);
  }

  return json({
    data: {
      client_id: clientId,
      rating_threshold: ratingThreshold,
      public_redirect_url: publicRedirectUrl,
      widget_enabled: widgetEnabled,
      notify_on_review: notifyOnReview,
    },
  });
}

/**
 * GET /api/reputation/private-feedback — liste le feedback privé (note < seuil,
 * jamais publié) du tenant. Corps réel Phase B (Manager-B) : SELECT
 * private_feedback WHERE client_id = ? ORDER BY created_at DESC. Forme =
 * PrivateFeedback[].
 */
export async function handleGetPrivateFeedback(
  env: Env,
  auth: ReputationAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;
  const clientId = await resolveProClientId(env, auth);
  if (!clientId) return json({ error: 'Client introuvable' }, 400);

  // Liste bornée client_id, ORDER BY created_at DESC. Best-effort : table seq 109
  // absente ⇒ liste vide (jamais de throw nu).
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, lead_id, invitation_id, rating, comment, status, created_at
         FROM private_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 200`,
    ).bind(clientId).all();
    return json({ data: results || [] });
  } catch (err) {
    console.warn('handleGetPrivateFeedback failed (best-effort)', err);
    return json({ data: [] });
  }
}
