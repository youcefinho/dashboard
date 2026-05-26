// ── Abandoned carts (multi-touch sequence) — Sprint 40 Phase B (2026-05-24)
//
// 5 handlers (1 PUBLIC + 3 AUTHED + 1 cron) pour la séquence de récupération
// multi-touch additive `carts.recovery_*` seq135. Délais 1h/24h/72h + discount
// progressif 0/5/10% via engine `coupons` existant (seq18 + ALTER seq85).
//
// NE TOUCHE PAS `ecommerce-cart-recovery.ts` (Sprint E7 — single-touch
// detectAbandonedCarts + handleRecoverCart reste FONCTIONNEL et autonome).
// Sprint 40 ÉTEND via colonnes NEUVES (recovery_email_sent_count etc.) — code
// E7 ignore ces colonnes et continue d'utiliser `recovered_at` legacy.
//
// Capabilities FIGÉES seq80 (ZÉRO ajout à ALL_CAPABILITIES) :
//   - `reports.view`   : list sequence states (lecture).
//   - `clients.manage` : update recovery-config + cron scan (mutations).
//
// Réponses normalisées { data } / { error } (PAS de champ `code`).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import {
  RECOVERY_DELAYS_MIN,
} from '../lib/types';
import { processRecoverySequence } from './lib/abandoned-cart-recovery';

type Auth = CapAuth & { capabilities?: Set<string> };

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Résout le client_id du tenant courant (via users.client_id). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Réponse 400 normalisée pour absence de tenant. */
function noClient(): Response {
  return json(
    {
      error: 'Client introuvable',
      message: 'Aucun compte tenant associé à ton utilisateur.',
    },
    400,
  );
}

// ── Type interne ───────────────────────────────────────────────────────────

interface SequenceRow {
  id: string;
  cart_token: string | null;
  customer_id: string | null;
  recovery_email_sent_count: number | null;
  last_recovery_at: string | null;
  recovery_discount_code: string | null;
  recovery_completed_at: string | null;
  recovery_attempts_json: string | null;
}

interface RecoveryAttempt {
  step: 1 | 2 | 3;
  channel: 'email' | 'sms';
  ts: string;
  coupon_code: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

/**
 * Calcule la prochaine échéance de relance à partir de last_recovery_at
 * et du compteur actuel. Retourne null si la séquence est terminée (≥3)
 * ou si aucune touche n'a encore été envoyée (éligible immédiatement).
 */
function computeNextDueAt(
  lastRecoveryAt: string | null,
  sentCount: number,
): string | null {
  if (sentCount >= 3) return null;
  if (!lastRecoveryAt) return null; // éligible immédiat
  const nextStep = (sentCount + 1) as 1 | 2 | 3;
  const delayMin = Number(RECOVERY_DELAYS_MIN[nextStep] || 0);
  if (!delayMin) return null;
  // Parse SQLite datetime (UTC) "YYYY-MM-DD HH:MM:SS" ⇒ ISO via espace→T + Z.
  const iso = lastRecoveryAt.includes('T')
    ? lastRecoveryAt
    : `${lastRecoveryAt.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const due = new Date(t + delayMin * 60_000);
  return due.toISOString().slice(0, 19).replace('T', ' ');
}

// ── AUTHED handlers (3) ────────────────────────────────────────────────────

/**
 * GET /api/ecommerce/carts/abandoned/sequence — list états séquence multi-touch.
 *
 * Capability `reports.view` (lecture). Filtre tenant strict via getClientModules.
 *
 * SELECT carts WHERE client_id = ? AND status='abandoned' AND
 * recovery_completed_at IS NULL ORDER BY last_recovery_at DESC NULLS FIRST
 * LIMIT 100. Mapping : recovery_attempts_json → attempts[] + calcul
 * next_recovery_due_at = last_recovery_at + RECOVERY_DELAYS_MIN[next_step].
 *
 * Contrat FIGÉ : handleListRecoverySequenceStates(env, auth) -> Response.
 */
export async function handleListRecoverySequenceStates(
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'reports.view');
  if (denied) return denied;

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // NULLS FIRST simulé via ORDER BY (last_recovery_at IS NULL) DESC : SQLite
  // n'a pas le mot-clé NULLS FIRST/LAST → on trie d'abord par "nullité" pour
  // remonter les paniers jamais relancés (les plus urgents), puis DESC par date.
  let rows: SequenceRow[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, cart_token, customer_id, recovery_email_sent_count,
              last_recovery_at, recovery_discount_code,
              recovery_completed_at, recovery_attempts_json
         FROM carts
        WHERE client_id = ?
          AND status = 'abandoned'
          AND recovery_completed_at IS NULL
        ORDER BY (last_recovery_at IS NULL) DESC, last_recovery_at DESC
        LIMIT 100`,
    )
      .bind(clientId)
      .all();
    rows = (results || []) as unknown as SequenceRow[];
  } catch (err) {
    console.error('handleListRecoverySequenceStates SELECT failed', err);
    rows = [];
  }

  const data = rows.map((r) => {
    let attempts: RecoveryAttempt[] = [];
    if (r.recovery_attempts_json) {
      try {
        const parsed = JSON.parse(r.recovery_attempts_json);
        if (Array.isArray(parsed)) attempts = parsed as RecoveryAttempt[];
      } catch {
        attempts = [];
      }
    }
    const sentCount = Number(r.recovery_email_sent_count || 0);
    return {
      id: r.id,
      cart_token: r.cart_token,
      customer_id: r.customer_id,
      recovery_email_sent_count: sentCount,
      last_recovery_at: r.last_recovery_at,
      recovery_discount_code: r.recovery_discount_code,
      recovery_completed_at: r.recovery_completed_at,
      attempts,
      next_recovery_due_at: computeNextDueAt(r.last_recovery_at, sentCount),
    };
  });

  return json({ data });
}

/**
 * PUT /api/ecommerce/carts/:cartId/recovery-config — pilote la séquence par
 * cart (skip step / mark recovered manually / override coupon).
 *
 * Capability `clients.manage` (mutation). Body :
 *   - recovery_email_sent_count?: number   ⇒ skip step (force compteur).
 *   - recovery_completed_at?: string|null  ⇒ mark recovered manually
 *                                            (string="now"/ISO ⇒ datetime('now'),
 *                                             null ⇒ NULL, undefined ⇒ no-op).
 *   - recovery_discount_code?: string|null ⇒ override coupon manuel.
 *
 * UPDATE carts WHERE id = ? AND client_id = ? (bornage strict defense-in-
 * depth IDOR). Audit log : 'cart_recovery_config_updated' avec diff.
 *
 * Contrat FIGÉ : handleUpdateRecoveryConfig(request, env, auth, cartId) -> Response.
 */
export async function handleUpdateRecoveryConfig(
  request: Request,
  env: Env,
  auth: Auth,
  cartId: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // Parse body (best-effort).
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Vérifie l'existence du panier dans le tenant (defense-in-depth IDOR).
  const cart = (await env.DB.prepare(
    'SELECT id FROM carts WHERE id = ? AND client_id = ? LIMIT 1',
  )
    .bind(cartId, clientId)
    .first()) as { id: string } | null;
  if (!cart) return json({ error: 'Panier introuvable' }, 404);

  // Construction dynamique du SET (uniquement les champs fournis).
  const sets: string[] = [];
  const binds: unknown[] = [];
  const diff: Record<string, unknown> = {};

  if (typeof body.recovery_email_sent_count === 'number') {
    const v = Math.max(0, Math.min(3, Math.floor(body.recovery_email_sent_count)));
    sets.push('recovery_email_sent_count = ?');
    binds.push(v);
    diff.recovery_email_sent_count = v;
  }

  if ('recovery_completed_at' in body) {
    const raw = body.recovery_completed_at;
    if (raw === null) {
      sets.push('recovery_completed_at = NULL');
      diff.recovery_completed_at = null;
    } else if (typeof raw === 'string' && raw.length > 0) {
      // "now" ⇒ datetime('now') ; sinon on stocke la string telle quelle.
      if (raw === 'now') {
        sets.push("recovery_completed_at = datetime('now')");
        diff.recovery_completed_at = 'now';
      } else {
        sets.push('recovery_completed_at = ?');
        binds.push(raw);
        diff.recovery_completed_at = raw;
      }
    }
  }

  if ('recovery_discount_code' in body) {
    const raw = body.recovery_discount_code;
    if (raw === null) {
      sets.push('recovery_discount_code = NULL');
      diff.recovery_discount_code = null;
    } else if (typeof raw === 'string') {
      sets.push('recovery_discount_code = ?');
      binds.push(raw);
      diff.recovery_discount_code = raw;
    }
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ à mettre à jour' }, 400);
  }

  // updated_at systématique pour cohérence (déclenche aussi les éventuels
  // observateurs côté cron qui trient par updated_at).
  sets.push("updated_at = datetime('now')");

  try {
    await env.DB.prepare(
      `UPDATE carts SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...binds, cartId, clientId)
      .run();
  } catch (err) {
    console.error('handleUpdateRecoveryConfig UPDATE failed', cartId, err);
    return json({ error: 'Mise à jour échouée' }, 500);
  }

  await audit(
    env,
    auth.userId,
    'cart_recovery_config_updated',
    'cart',
    cartId,
    diff,
  );

  return json({ data: { id: cartId, updated: true } });
}

/**
 * POST /api/recovery/cron/scan — admin-trigger du cron multi-touch
 * (déclenché manuellement, scheduled() Phase future).
 *
 * Capability `clients.manage` (mutation interne admin). Délègue à
 * processRecoverySequence(env) (lib A2). Réponse :
 * `{ data: { processed, sent } }`.
 *
 * Contrat FIGÉ : handleCronScan(env, auth) -> Response.
 */
export async function handleCronScan(
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  let result: { processed: number; sent: number } = { processed: 0, sent: 0 };
  try {
    result = await processRecoverySequence(env);
  } catch (err) {
    console.error('handleCronScan processRecoverySequence failed', err);
  }

  await audit(
    env,
    auth.userId,
    'recovery_cron_manual_trigger',
    'cart_recovery',
    'cron',
    { processed: result.processed, sent: result.sent },
  );

  return json({ data: result });
}

// ── PUBLIC handler (1) ─────────────────────────────────────────────────────

/**
 * GET /api/recovery/:cartToken/:step — landing page panier post-relance.
 *
 * PUBLIC : visiteur anonyme cliquant lien email → reposition cart en 'active'
 * + redirect vers le checkout storefront avec le coupon courant. Le lookup
 * via cart_token (unique global) rend le cross-tenant impossible.
 *
 * Logique :
 *   1. SELECT cart par cart_token. 404 si introuvable.
 *   2. Valider step ∈ {1,2,3} sinon 400.
 *   3. 410 Gone si step > recovery_email_sent_count (jamais envoyée).
 *   4. Si recovery_completed_at IS NOT NULL → redirect direct vers checkout
 *      (sans réappliquer le coupon — idempotence).
 *   5. Sinon : reposition status='active' + updated_at=now ; marque
 *      attempts[step-1].clicked_at = now dans recovery_attempts_json.
 *   6. Build redirect ${origin}/storefront/checkout?cart=token[&coupon=code].
 *
 * Contrat FIGÉ : handleRecoveryLandingPage(request, env, cartToken, step) -> Response.
 */
export async function handleRecoveryLandingPage(
  request: Request,
  env: Env,
  cartToken: string,
  step: string,
): Promise<Response> {
  // 1. Lookup cart (best-effort).
  type CartRow = {
    id: string;
    client_id: string;
    status: string;
    recovery_discount_code: string | null;
    recovery_email_sent_count: number | null;
    recovery_completed_at: string | null;
    recovery_attempts_json: string | null;
  };
  let cart: CartRow | null = null;
  try {
    cart = (await env.DB.prepare(
      `SELECT id, client_id, status, recovery_discount_code,
              recovery_email_sent_count, recovery_completed_at,
              recovery_attempts_json
         FROM carts
        WHERE cart_token = ?
        LIMIT 1`,
    )
      .bind(cartToken)
      .first()) as CartRow | null;
  } catch {
    cart = null;
  }
  if (!cart) return json({ error: 'Panier introuvable' }, 404);

  // 2. Validation step.
  if (step !== '1' && step !== '2' && step !== '3') {
    return json({ error: 'Step invalide' }, 400);
  }
  const stepNum = parseInt(step, 10) as 1 | 2 | 3;

  // 3. Step jamais envoyé ⇒ 410 Gone.
  const sentCount = Number(cart.recovery_email_sent_count || 0);
  if (stepNum > sentCount) {
    return json({ error: 'Lien expiré ou jamais envoyé' }, 410);
  }

  // Détermine l'origin pour la redirect.
  const url = new URL(request.url);
  const origin = url.origin;
  const couponCode = (cart.recovery_discount_code || '').toString();

  // 4. Déjà complété ⇒ redirect direct sans réappliquer coupon (idempotent).
  if (cart.recovery_completed_at) {
    const redirectUrl = `${origin}/storefront/checkout?cart=${encodeURIComponent(cartToken)}`;
    return new Response(null, { status: 302, headers: { Location: redirectUrl } });
  }

  // 5. Repositionne le panier en 'active' (best-effort).
  try {
    await env.DB.prepare(
      `UPDATE carts
          SET status = 'active', updated_at = datetime('now')
        WHERE id = ? AND recovery_completed_at IS NULL`,
    )
      .bind(cart.id)
      .run();
  } catch (err) {
    console.error('handleRecoveryLandingPage status flip failed', cart.id, err);
  }

  // Marque la tentative comme cliquée dans le journal JSON (best-effort).
  try {
    let attempts: RecoveryAttempt[] = [];
    if (cart.recovery_attempts_json) {
      try {
        const parsed = JSON.parse(cart.recovery_attempts_json);
        if (Array.isArray(parsed)) attempts = parsed as RecoveryAttempt[];
      } catch {
        attempts = [];
      }
    }

    // Timestamp ISO via DB pour cohérence avec les autres écritures.
    let nowIso = '';
    try {
      const r = (await env.DB.prepare(
        "SELECT datetime('now') AS now",
      ).first()) as { now: string } | null;
      nowIso = r?.now || '';
    } catch {
      nowIso = '';
    }
    if (!nowIso) nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Marque la PREMIÈRE tentative non-cliquée du step demandé (anti-spam :
    // si l'user clique plusieurs fois, on ne stamp qu'une fois).
    let mutated = false;
    for (const a of attempts) {
      if (a.step === stepNum && !a.clicked_at) {
        a.clicked_at = nowIso;
        mutated = true;
        break;
      }
    }

    if (mutated) {
      await env.DB.prepare(
        `UPDATE carts
            SET recovery_attempts_json = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
        .bind(JSON.stringify(attempts), cart.id)
        .run();
    }
  } catch (err) {
    console.error('handleRecoveryLandingPage clicked stamp failed', cart.id, err);
  }

  // 6. Build redirect + coupon si présent.
  const redirectUrl =
    `${origin}/storefront/checkout?cart=${encodeURIComponent(cartToken)}` +
    (couponCode ? `&coupon=${encodeURIComponent(couponCode)}` : '');

  return new Response(null, { status: 302, headers: { Location: redirectUrl } });
}

// ── Cron handler (1) ────────────────────────────────────────────────────────

/**
 * Cron périodique : scan paniers éligibles à la prochaine touche selon
 * RECOVERY_DELAYS_MIN (1h/24h/72h). Wrapper best-effort de
 * lib/abandoned-cart-recovery.ts:processRecoverySequence.
 *
 * Idempotent : recordRecoveryAttempt incrémente compteur ATOMICALLY (anti-
 * course concurrente). Batch borné LIMIT 50 (pattern
 * `ecommerce-cart-recovery.ts:detectAbandonedCarts`).
 *
 * Contrat FIGÉ : runRecoverySequenceCron(env) -> Promise<{ processed, sent }>.
 */
export async function runRecoverySequenceCron(
  env: Env,
): Promise<{ processed: number; sent: number }> {
  try {
    return await processRecoverySequence(env);
  } catch (err) {
    console.error('runRecoverySequenceCron failed', err);
    return { processed: 0, sent: 0 };
  }
}
