// ── Expéditions — Sprint E5 M1 (2026-05-16) ─────────────────────────────────
//
// Backend expéditions du module Boutique (B2). Une expédition (shipment) est
// une TRACE PURE d'un envoi (total ou partiel) d'une commande :
//   - Création + lignes (quel order_item, quelle quantité).
//   - Machine à états PROPRE au shipment (preparing→shipped→in_transit→
//     delivered/failed), DISTINCTE de la machine commande E3.
//   - Recalcul déterministe de orders.fulfillment_status (E1) : SUM des
//     quantités expédiées vs SUM des quantités commandées.
//   - Pont COD → livraison : à `delivered`, si une ligne COD pending existe,
//     délègue 100 % à recordPaymentTransition (E4) — ZÉRO réimplémentation
//     financière / stock.
//
// Invariants stricts (NON négociables) :
//   - Shipment ≠ stock : AUCUN import inventory. Le stock est déjà concrétisé
//     au `paid` (E3) — créer/livrer une expédition ne le touche jamais.
//   - La machine commande E3 (preparing→shipped→delivered) n'est PAS dupliquée
//     ici : E5 gère uniquement shipments.status + recalcul fulfillment_status.
//     Le passage du statut commande reste piloté par handleUpdateOrderStatus.
//   - COD-livraison 100 % délégué à recordPaymentTransition (idempotent via
//     commitOrderSale !paid_at — rejeu = no-op total).
//   - Multi-tenant STRICT : WHERE client_id résolu via getClientModules.
//   - Gating requireModule('ecommerce') hérité du bloc /api/ecommerce/*.
//
// Conventions DB : id/created_at/updated_at via DEFAULT côté schéma
// (lower(hex(randomblob(16))) / datetime('now')) — on ne les bind PAS ici.

import type { Env } from './types';
import type { Shipment, ShipmentStatus } from '../lib/types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { recordPaymentTransition } from './ecommerce-payments';

type Auth = { userId: string; role: string };

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

// ════════════════════════════════════════════════════════════════════════════
// Recalcul déterministe de orders.fulfillment_status (E1) — JAMAIS via la
// machine commande. SUM(shipment_items.quantity) vs SUM(order_items.quantity).
//   0           → 'unfulfilled'
//   0 < x < tot → 'partial'
//   x >= tot    → 'fulfilled'
// UPDATE ciblé idempotent (recalculé à chaque mutation d'expédition).
// ════════════════════════════════════════════════════════════════════════════

async function recalcFulfillment(
  env: Env, clientId: string, orderId: string,
): Promise<void> {
  const ordered = (await env.DB.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS n FROM order_items WHERE order_id = ?',
  ).bind(orderId).first()) as { n: number } | null;

  // Quantités expédiées : on ne compte que les lignes des shipments du tenant
  // (jointure client_id) et on EXCLUT les expéditions 'failed' (un envoi en
  // échec ne fulfill rien).
  const shipped = (await env.DB.prepare(
    `SELECT COALESCE(SUM(si.quantity), 0) AS n
       FROM shipment_items si
       JOIN shipments s ON s.id = si.shipment_id
      WHERE s.order_id = ? AND s.client_id = ? AND s.status != 'failed'`,
  ).bind(orderId, clientId).first()) as { n: number } | null;

  const totalOrdered = ordered?.n ?? 0;
  const totalShipped = shipped?.n ?? 0;

  let next: 'unfulfilled' | 'partial' | 'fulfilled';
  if (totalShipped <= 0) next = 'unfulfilled';
  else if (totalShipped >= totalOrdered && totalOrdered > 0) next = 'fulfilled';
  else next = 'partial';

  await env.DB.prepare(
    `UPDATE orders SET fulfillment_status = ?, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(next, orderId, clientId).run();
}

/** Charge un shipment + ses lignes (multi-tenant). */
async function loadShipment(
  env: Env, clientId: string, shipmentId: string,
): Promise<Shipment | null> {
  const s = (await env.DB.prepare(
    'SELECT * FROM shipments WHERE id = ? AND client_id = ?',
  ).bind(shipmentId, clientId).first()) as Shipment | null;
  if (!s) return null;
  const { results } = await env.DB.prepare(
    'SELECT * FROM shipment_items WHERE shipment_id = ? ORDER BY created_at ASC',
  ).bind(shipmentId).all();
  return { ...s, items: (results || []) as Shipment['items'] };
}

// ════════════════════════════════════════════════════════════════════════════
// M1.2 — POST /api/ecommerce/orders/:id/shipments  (création total/partiel)
// ════════════════════════════════════════════════════════════════════════════

interface OrderRow {
  id: string;
  status: string;
  cancelled_at: string | null;
}

interface OrderItemRow {
  id: string;
  quantity: number;
}

/**
 * Crée une expédition (totale ou partielle) pour une commande.
 *
 * Garde-fou 409 (miroir handleInitPayment) : commande 'cancelled'/'pending'
 * ou cancelled_at non null ⇒ refus (on n'expédie pas une commande annulée ou
 * non encore acceptée). Insère shipment + shipment_items, puis recalcule
 * orders.fulfillment_status de façon déterministe. NE touche PAS le stock.
 */
export async function handleCreateShipment(
  request: Request, env: Env, auth: Auth, orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const order = (await env.DB.prepare(
    'SELECT id, status, cancelled_at FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as OrderRow | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  if (order.status === 'cancelled' || order.cancelled_at) {
    return json(
      { error: 'Commande annulée', message: "Impossible d'expédier une commande annulée." },
      409,
    );
  }
  if (order.status === 'pending') {
    return json(
      {
        error: 'Commande non réglée',
        message: "Impossible d'expédier une commande encore en attente (non réglée).",
      },
      409,
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return json(
      { error: 'Expédition vide', message: 'Précise au moins une ligne à expédier.' },
      400,
    );
  }

  // Lignes de commande valides (multi-tenant via la jointure sur order_id).
  const { results: oiResults } = await env.DB.prepare(
    'SELECT id, quantity FROM order_items WHERE order_id = ?',
  ).bind(orderId).all();
  const orderItems = (oiResults || []) as OrderItemRow[];
  const byId = new Map(orderItems.map((oi) => [oi.id, oi.quantity]));

  // Quantités déjà expédiées par order_item (hors expéditions 'failed') pour
  // refuser une sur-expédition (somme > quantité commandée).
  const { results: shippedResults } = await env.DB.prepare(
    `SELECT si.order_item_id AS oid, COALESCE(SUM(si.quantity), 0) AS n
       FROM shipment_items si
       JOIN shipments s ON s.id = si.shipment_id
      WHERE s.order_id = ? AND s.client_id = ? AND s.status != 'failed'
      GROUP BY si.order_item_id`,
  ).bind(orderId, clientId).all();
  const alreadyShipped = new Map(
    (shippedResults || []).map((r) => [
      (r as { oid: string }).oid,
      (r as { n: number }).n,
    ]),
  );

  const validated: Array<{ order_item_id: string; quantity: number }> = [];
  for (const raw of rawItems) {
    const r = raw as { order_item_id?: string; quantity?: unknown };
    const oid = (r?.order_item_id || '').toString();
    const qty = Math.max(1, Math.round(Number(r?.quantity) || 0));
    if (!oid || qty < 1) {
      return json(
        {
          error: 'Ligne invalide',
          message: "Chaque ligne doit cibler un article de la commande avec une quantité ≥ 1.",
        },
        400,
      );
    }
    if (!byId.has(oid)) {
      return json(
        {
          error: 'Article hors commande',
          message: "Un article à expédier n'appartient pas à cette commande.",
        },
        404,
      );
    }
    const ordered = byId.get(oid) ?? 0;
    const prior = alreadyShipped.get(oid) ?? 0;
    if (prior + qty > ordered) {
      return json(
        {
          error: 'Quantité dépassée',
          message: `La quantité expédiée dépasserait la quantité commandée pour un article (commandé ${ordered}, déjà expédié ${prior}).`,
        },
        409,
      );
    }
    validated.push({ order_item_id: oid, quantity: qty });
  }

  const carrier = body.carrier ? String(body.carrier).slice(0, 120) : null;
  const trackingNumber = body.tracking_number ? String(body.tracking_number).slice(0, 200) : null;
  const trackingUrl = body.tracking_url ? String(body.tracking_url).slice(0, 500) : null;
  const note = body.note ? String(body.note).slice(0, 2000) : null;

  // id/created_at/updated_at via DEFAULT schéma — on lit l'id généré en retour.
  const inserted = (await env.DB.prepare(
    `INSERT INTO shipments
       (client_id, order_id, status, carrier, tracking_number, tracking_url, note)
     VALUES (?, ?, 'preparing', ?, ?, ?, ?)
     RETURNING id`,
  ).bind(clientId, orderId, carrier, trackingNumber, trackingUrl, note).first() as
    | { id: string }
    | null);
  const shipmentId = inserted?.id;
  if (!shipmentId) return json({ error: "Échec création de l'expédition" }, 500);

  for (const v of validated) {
    await env.DB.prepare(
      `INSERT INTO shipment_items (shipment_id, order_item_id, quantity)
       VALUES (?, ?, ?)`,
    ).bind(shipmentId, v.order_item_id, v.quantity).run();
  }

  // Recalcul déterministe fulfillment_status (jamais via machine commande).
  await recalcFulfillment(env, clientId, orderId);

  await audit(env, auth.userId, 'create', 'order', orderId, {
    shipment: shipmentId, lines: validated.length, carrier,
  });

  const shipment = await loadShipment(env, clientId, shipmentId);
  return json({ data: shipment }, 201);
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — list / get / updateStatus
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/ecommerce/orders/:id/shipments — multi-tenant. */
export async function handleListShipments(
  env: Env, auth: Auth, orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const order = await env.DB.prepare(
    'SELECT id FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT * FROM shipments
      WHERE order_id = ? AND client_id = ?
      ORDER BY created_at ASC`,
  ).bind(orderId, clientId).all();
  const shipments = (results || []) as Shipment[];

  // Hydrate les lignes par expédition (peu de shipments par commande).
  for (const s of shipments) {
    const { results: items } = await env.DB.prepare(
      'SELECT * FROM shipment_items WHERE shipment_id = ? ORDER BY created_at ASC',
    ).bind(s.id).all();
    s.items = (items || []) as Shipment['items'];
  }

  return json({ data: shipments });
}

/** GET /api/ecommerce/shipments/:sid — multi-tenant. */
export async function handleGetShipment(
  env: Env, auth: Auth, shipmentId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const shipment = await loadShipment(env, clientId, shipmentId);
  if (!shipment) return json({ error: 'Expédition introuvable' }, 404);
  return json({ data: shipment });
}

// Machine à états PROPRE au shipment — DISTINCTE de la machine commande E3.
// 'shipped'/'in_transit' peuvent encore basculer en 'failed' (envoi perdu).
// 'delivered'/'failed' = états terminaux du shipment.
const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  preparing: ['shipped', 'failed'],
  shipped: ['in_transit', 'delivered', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: [],
};

interface ShipmentStatusRow {
  id: string;
  order_id: string;
  status: ShipmentStatus;
  shipped_at: string | null;
  delivered_at: string | null;
}

/**
 * PATCH /api/ecommerce/shipments/:sid/status  body { status }
 * Transition validée par la machine PROPRE au shipment (409 FR si invalide).
 * Horodate shipped_at (→shipped) / delivered_at (→delivered). À 'delivered',
 * déclenche le pont COD-livraison (markCodCollectedOnDelivery, idempotent).
 *
 * NE duplique PAS la machine commande E3 : seul shipments.status est mis à
 * jour ici + recalcul déterministe de orders.fulfillment_status. Le passage
 * du statut commande (preparing→shipped→delivered) reste piloté par E3.
 */
export async function handleUpdateShipmentStatus(
  request: Request, env: Env, auth: Auth, shipmentId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const next = String(body.status || '') as ShipmentStatus;
  const allValid: ShipmentStatus[] = ['preparing', 'shipped', 'in_transit', 'delivered', 'failed'];
  if (!allValid.includes(next)) {
    return json({ error: 'Statut invalide', message: "Statut d'expédition inconnu." }, 400);
  }

  const s = (await env.DB.prepare(
    'SELECT id, order_id, status, shipped_at, delivered_at FROM shipments WHERE id = ? AND client_id = ?',
  ).bind(shipmentId, clientId).first()) as ShipmentStatusRow | null;
  if (!s) return json({ error: 'Expédition introuvable' }, 404);

  const current = s.status;
  if (current === next) {
    return json({ error: 'Aucun changement', message: `L'expédition est déjà « ${next} ».` }, 409);
  }
  const allowed = SHIPMENT_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    return json(
      {
        error: 'Transition invalide',
        message: `Impossible de passer de « ${current} » à « ${next} ». Transitions permises : ${allowed.length ? allowed.join(', ') : 'aucune (état terminal)'}.`,
      },
      409,
    );
  }

  const sets: string[] = ['status = ?'];
  const params: unknown[] = [next];
  if (next === 'shipped' && !s.shipped_at) sets.push("shipped_at = datetime('now')");
  if (next === 'delivered') {
    if (!s.shipped_at) sets.push("shipped_at = datetime('now')");
    if (!s.delivered_at) sets.push("delivered_at = datetime('now')");
  }

  params.push(shipmentId, clientId);
  await env.DB.prepare(
    `UPDATE shipments SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();

  // Recalcul déterministe fulfillment_status (pas via machine commande E3).
  await recalcFulfillment(env, clientId, s.order_id);

  // Pont COD-livraison : à la livraison, encaisse une éventuelle ligne COD
  // (100 % délégué à recordPaymentTransition — idempotent, rejeu = no-op).
  let codCommitted = false;
  if (next === 'delivered') {
    const res = await markCodCollectedOnDelivery(env, clientId, s.order_id);
    codCommitted = res.committed;
  }

  await audit(env, auth.userId, 'update', 'order', s.order_id, {
    shipment: shipmentId, from: current, to: next, cod_committed: codCommitted,
  });

  return json({ data: { id: shipmentId, status: next, success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M1.4 — Pont COD → livraison (encaissement délégué, idempotent)
// ════════════════════════════════════════════════════════════════════════════

/**
 * À la livraison d'une commande en COD : si une ligne `payments` provider='cod'
 * status='pending_cod' existe, on considère le paiement encaissé à la remise
 * → on délègue 100 % à recordPaymentTransition(status:'paid') avec la
 * provider_ref déterministe `cod:<orderId>` (E4).
 *
 * ZÉRO réimplémentation : financial_status / stock / paid_at sont gérés par
 * commitOrderSale (via recordPaymentTransition), idempotent (no-op si
 * !paid_at déjà posé). Rejeu (re-livraison, double appel) = no-op total.
 *
 * Retourne { committed } : true si CET appel a concrétisé la vente, false si
 * pas de COD pending, ou déjà encaissé (idempotent).
 */
export async function markCodCollectedOnDelivery(
  env: Env, clientId: string, orderId: string,
): Promise<{ committed: boolean }> {
  const cod = (await env.DB.prepare(
    `SELECT id FROM payments
      WHERE client_id = ? AND order_id = ? AND provider = 'cod'
        AND status = 'pending_cod'
      LIMIT 1`,
  ).bind(clientId, orderId).first()) as { id: string } | null;

  // Pas de COD en attente (autre moyen de paiement, déjà encaissé, ou rejeu)
  // ⇒ no-op : on ne touche RIEN (idempotence garantie côté pont E4 de toute
  // façon, mais on évite un appel inutile).
  if (!cod) return { committed: false };

  // Délégation totale au pont E4 — provider_ref COD déterministe `cod:<id>`.
  return await recordPaymentTransition(env, {
    order_id: orderId,
    payment_ref: `cod:${orderId}`,
    status: 'paid',
  });
}
