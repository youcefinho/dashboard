// ── Sprint E7 M2 — Panier abandonné : détection + récupération ──────────────
//
// Détection (cron) : carts.status='active' inactifs depuis > TTL config
//   → status='abandoned' + abandoned_at. Idempotent (jamais converted/recovered
//   ni active modifié récemment).
// Récupération (HTTP) : panier abandonné → relance UNE seule fois.
//   - Si le client est rattaché à un lead CRM (getLinkedLeadForCustomer, E1) :
//     autoEnrollForTrigger('cart_abandoned', leadId) — réutilise Sprint 46
//     workflows.ts SANS modification (0 duplication de logique).
//   - Sinon : notification simple (createNotification helper Sprint 46).
//   Anti-spam : garde carts.recovered_at IS NULL ⇒ set recovered_at à la 1re
//   relance. Rejeu = no-op (recovered:false).
//
// Conventions : multi-tenant strict, additif/non destructif, batch borné
// (LIMIT 50 pattern processWorkflowQueue), TTL via customer_segment_config
// (pas de magic number — réutilise getSegmentConfig de ecommerce-rfm.ts).

import type { Env } from './types';
import type { AbandonedCart } from '../lib/types';
import { json, createNotification } from './helpers';
import { getClientModules } from './modules';
import { getSegmentConfig } from './ecommerce-rfm';
import { getLinkedLeadForCustomer } from './customer-reconcile';
import { autoEnrollForTrigger } from './workflows';

type Auth = { userId: string; role: string };

// ── M2.3 — Détection batch (cron) ───────────────────────────────────────────

/**
 * Marque les paniers 'active' inactifs (updated_at < now − TTL) comme
 * 'abandoned'. TTL par tenant via customer_segment_config (défaut 1440 min).
 *
 * Idempotent : ne touche QUE active→abandoned (jamais converted / recovered /
 * déjà abandoned). Garde-fou : un panier modifié récemment (dans le TTL) est
 * laissé tel quel — on n'abandonne jamais un panier encore « chaud ».
 *
 * Batch borné LIMIT 50 par tenant (pattern processWorkflowQueue) ; le cron
 * repasse régulièrement pour la couverture progressive.
 *
 * Contrat FIGÉ : detectAbandonedCarts(env) -> { abandoned }.
 */
export async function detectAbandonedCarts(
  env: Env,
): Promise<{ abandoned: number }> {
  // Tenants ayant des paniers actifs candidats (les plus anciens d'abord).
  const { results: tenantRows } = await env.DB.prepare(
    `SELECT DISTINCT client_id
       FROM carts
      WHERE status = 'active'
      ORDER BY client_id
      LIMIT 50`,
  ).all();

  const tenants = (tenantRows || []) as Array<{ client_id: string }>;
  let abandoned = 0;

  for (const t of tenants) {
    try {
      const config = await getSegmentConfig(env, t.client_id);
      const ttl = config.abandoned_cart_ttl_minutes; // minutes, > 0 garanti

      // active → abandoned : updated_at strictement plus vieux que le TTL.
      // datetime('now', '-N minutes') = même horloge que les DEFAULT colonnes.
      const res = await env.DB.prepare(
        `UPDATE carts
            SET status = 'abandoned',
                abandoned_at = datetime('now'),
                updated_at = datetime('now')
          WHERE client_id = ?
            AND status = 'active'
            AND updated_at < datetime('now', ?)`,
      )
        .bind(t.client_id, `-${ttl} minutes`)
        .run();

      abandoned += (res.meta?.changes as number) || 0;
    } catch (err) {
      console.error('detectAbandonedCarts failed', t.client_id, err);
    }
  }

  return { abandoned };
}

// ── Sprint E9 M1 — Win-back (cron) ──────────────────────────────────────────

/**
 * Enrôle les clients e-comm INACTIFS depuis N jours dans les workflows
 * actifs sur le trigger 'win_back' (moteur Sprint 46 réutilisé, 0
 * duplication). Inactif = a déjà commandé (last_order_at non NULL) mais
 * dernière commande plus vieille que le seuil.
 *
 * NE TOUCHE PAS le chemin 'cart_abandoned' E7 (detectAbandonedCarts +
 * handleRecoverCart) : fonction PARALLÈLE additive.
 *
 * Idempotent : la garde anti-doublon de autoEnroll (un seul enrollment
 * actif par (workflow, customer)) évite le re-spam. Best-effort : aucune
 * erreur ne remonte. Batch borné LIMIT 50/tenant (pattern
 * detectAbandonedCarts / processWorkflowQueue).
 *
 * Contrat : detectWinBackCustomers(env, inactiveDays?) -> { enrolled }.
 */
export async function detectWinBackCustomers(
  env: Env,
  inactiveDays = 60,
): Promise<{ enrolled: number }> {
  const days = Math.max(1, Math.floor(inactiveDays));
  let enrolled = 0;

  // Skip rapide : aucun workflow win_back actif ⇒ rien à faire.
  const wf = await env.DB.prepare(
    "SELECT 1 FROM workflows WHERE is_active = 1 AND trigger_type = 'win_back' LIMIT 1",
  ).first();
  if (!wf) return { enrolled: 0 };

  const { results } = await env.DB.prepare(
    `SELECT id, client_id
       FROM customers
      WHERE last_order_at IS NOT NULL
        AND last_order_at < datetime('now', ?)
      ORDER BY last_order_at ASC
      LIMIT 50`,
  )
    .bind(`-${days} days`)
    .all();

  for (const c of (results || []) as Array<{ id: string }>) {
    try {
      await autoEnrollForTrigger(env, 'win_back', { customerId: c.id });
      enrolled += 1;
    } catch (err) {
      console.error('detectWinBackCustomers failed', c.id, err);
    }
  }

  return { enrolled };
}

// ── HTTP : liste des paniers abandonnés ─────────────────────────────────────

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

/**
 * GET /api/ecommerce/carts/abandoned
 * Liste les paniers abandonnés du tenant (non encore récupérés en tête).
 * Réponse : AbandonedCart[] (subtotal/items agrégés depuis cart_items).
 *
 * Contrat FIGÉ : handleListAbandonedCarts(env, auth) -> Response.
 */
export async function handleListAbandonedCarts(
  env: Env,
  auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.client_id, c.customer_id, c.status, c.currency,
            c.updated_at, c.abandoned_at, c.recovered_at,
            cu.email AS customer_email,
            COALESCE(ci.items_count, 0) AS items_count,
            COALESCE(ci.subtotal_cents, 0) AS subtotal_cents
       FROM carts c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN (
         SELECT it.cart_id,
                SUM(it.quantity) AS items_count,
                SUM(it.quantity * COALESCE(v.price_override, p.base_price, 0))
                  AS subtotal_cents
           FROM cart_items it
           LEFT JOIN product_variants v ON v.id = it.variant_id
           LEFT JOIN products p ON p.id = v.product_id
          GROUP BY it.cart_id
       ) ci ON ci.cart_id = c.id
      WHERE c.client_id = ? AND c.status = 'abandoned'
      ORDER BY (c.recovered_at IS NOT NULL), c.abandoned_at DESC
      LIMIT 200`,
  )
    .bind(clientId)
    .all();

  const rows = (results || []) as Array<Record<string, unknown>>;
  const carts: AbandonedCart[] = rows.map((r) => ({
    id: String(r.id),
    client_id: String(r.client_id),
    customer_id: r.customer_id ? String(r.customer_id) : null,
    email: r.customer_email ? String(r.customer_email) : null,
    status: 'abandoned',
    items_count: Math.max(0, Math.round(Number(r.items_count) || 0)),
    subtotal_cents: Math.max(0, Math.round(Number(r.subtotal_cents) || 0)),
    currency: String(r.currency || 'CAD'),
    updated_at: String(r.updated_at || r.abandoned_at || ''),
    recovery_sent_at: r.recovered_at ? String(r.recovered_at) : null,
  }));

  return json({ data: carts });
}

// ── M2.4 — Récupération d'un panier abandonné ───────────────────────────────

/**
 * POST /api/ecommerce/carts/:id/recover
 *
 * Déclenche UNE relance pour un panier abandonné :
 *   - client lié à un lead CRM → autoEnrollForTrigger('cart_abandoned', leadId)
 *     (réutilise Sprint 46 workflows.ts, 0 modif) ;
 *   - sinon → notification simple à l'utilisateur courant.
 * Anti-spam : seulement si recovered_at IS NULL ; on pose recovered_at à la
 * 1re relance. Rejeu = no-op idempotent ⇒ { recovered:false }.
 *
 * Contrat FIGÉ : handleRecoverCart(request, env, auth, cartId) -> Response.
 */
export async function handleRecoverCart(
  request: Request,
  env: Env,
  auth: Auth,
  cartId: string,
): Promise<Response> {
  void request; // pas de body requis — signature alignée câblage M1 worker.ts
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const cart = (await env.DB.prepare(
    `SELECT id, client_id, customer_id, status, recovered_at
       FROM carts WHERE id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(cartId, clientId)
    .first()) as {
    id: string;
    client_id: string;
    customer_id: string | null;
    status: string;
    recovered_at: string | null;
  } | null;

  if (!cart) return json({ error: 'Panier introuvable' }, 404);

  // Récupération possible uniquement sur un panier abandonné non encore relancé.
  if (cart.status !== 'abandoned') {
    return json({ data: { recovered: false, reason: 'not_abandoned' } });
  }
  if (cart.recovered_at) {
    // Anti-spam : déjà relancé ⇒ no-op idempotent.
    return json({ data: { recovered: false, reason: 'already_recovered' } });
  }

  // Pose recovered_at de façon atomique-conditionnelle (garde anti-course :
  // ne marque QUE si encore NULL — deux appels concurrents ⇒ un seul gagne).
  const claim = await env.DB.prepare(
    `UPDATE carts
        SET recovered_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ? AND client_id = ?
        AND status = 'abandoned' AND recovered_at IS NULL`,
  )
    .bind(cartId, clientId)
    .run();

  if (((claim.meta?.changes as number) || 0) === 0) {
    // Un autre appel a gagné la course ⇒ no-op idempotent.
    return json({ data: { recovered: false, reason: 'already_recovered' } });
  }

  // Déclenche la relance (best-effort : la garde recovered_at est déjà posée).
  let channel: 'workflow' | 'notification' = 'notification';
  try {
    let leadId: string | null = null;
    if (cart.customer_id) {
      const lead = await getLinkedLeadForCustomer(env, cart.customer_id);
      leadId = lead?.id || null;
    }

    if (leadId) {
      // Réutilise le moteur Sprint 46 (aucune modif workflows.ts) : tout
      // workflow actif sur le trigger 'cart_abandoned' enrôle ce lead.
      await autoEnrollForTrigger(env, 'cart_abandoned', leadId);
      channel = 'workflow';
    } else {
      // Pas de lead rattaché ⇒ notification interne à l'opérateur courant.
      await createNotification(
        env,
        auth.userId,
        'Panier abandonné à relancer',
        'Un panier abandonné sans lead CRM lié attend une relance manuelle.',
        '🛒',
        '/ecommerce/carts/abandoned',
        clientId,
      );
      channel = 'notification';
    }
  } catch (err) {
    // La relance a échoué mais recovered_at est posé : on ne re-déclenche pas
    // (anti-spam prime). On signale l'échec sans rollback (non destructif).
    console.error('handleRecoverCart trigger failed', cartId, err);
    return json({ data: { recovered: true, channel: 'failed_trigger' } });
  }

  return json({ data: { recovered: true, channel } });
}
