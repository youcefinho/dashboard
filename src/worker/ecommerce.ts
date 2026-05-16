// ── Skeleton e-commerce API — Sprint E1 M3.1 (2026-05-16) ────────────────────
//
// Handlers CRUD squelette pour le module Boutique (B2). Fondation : vrais
// SELECT paginés multi-tenant (WHERE client_id = ?) + INSERT/UPDATE/DELETE
// minimaux sur les tables M1 (products / orders / customers).
//
// Périmètre volontairement restreint :
//  - Money toujours en cents (aucun calcul TPS/TVQ ici — c'est E3).
//  - Pas de logique métier avancée (variants, inventaire, fulfillment).
//  - Multi-tenant STRICT : client_id résolu via getClientModules (M2) qui lit
//    users.client_id (pattern projet, jamais de fuite cross-tenant).
//
// Toutes les routes sont gated par requireModule(env, userId, 'ecommerce')
// AVANT d'atteindre ces handlers (cf. src/worker.ts § E-commerce).

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import { reconcileCustomerWithLead } from './customer-reconcile';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Résout le client_id du tenant courant (réutilise le helper M2). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function parsePaging(url: URL): { limit: number; offset: number } {
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

// ── Products / Variantes / Catégories / Images ───────────────────────────────
// Sprint E2 M1 — le squelette E1 est enrichi dans ./ecommerce-products.ts
// (CRUD complet + relations + SEO + API publique). On ré-exporte pour que le
// routage worker.ts existant reste inchangé sur products, tout en bénéficiant
// des handlers enrichis. Orders / Customers ci-dessous restent intacts.

export {
  handleListProducts,
  handleGetProduct,
  handleCreateProduct,
  handleUpdateProduct,
  handleDeleteProduct,
  handleListVariants,
  handleCreateVariant,
  handleUpdateVariant,
  handleDeleteVariant,
  handleListCategories,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleSetProductCategories,
  handleListImages,
  handleAddImage,
  handleUpdateImage,
  handleDeleteImage,
  handleSetPrimaryImage,
  handlePublicListProducts,
  handlePublicGetProduct,
} from './ecommerce-products';

// Sprint E2 M2 — inventaire / mouvements / alertes (M2) + import bulk.
// Re-export pour que le routage worker.ts reste centralisé sur `ec.*`.
export {
  handleGetInventory,
  handleSetInventory,
  handleAdjustInventory,
  handleListMovements,
  handleListLowStock,
  // Helpers stock réutilisables pour E3 (commandes) — exposés proprement.
  reserveStock,
  releaseStock,
  commitSale,
} from './ecommerce-inventory';

export { handleImportProducts } from './ecommerce-import';

// ── Orders ───────────────────────────────────────────────────────────────────
// Sprint E3 M1 — le squelette E1 est enrichi dans ./ecommerce-orders.ts
// (création + line items + TPS/TVQ, lifecycle + hooks stock idempotents,
// list/get enrichis). On ré-exporte pour que le routage worker.ts reste
// centralisé sur `ec.*`. handleUpdateOrder / handleDeleteOrder ci-dessous
// restent le squelette E1 (hors scope E3 M1 — édition libre / suppression).

export {
  handleListOrders,
  handleGetOrder,
  handleCreateOrder,
  handleCreateManualOrder,
  handleUpdateOrderStatus,
  // Cœur réutilisable — M2 le consomme pour la conversion de panier.
  createOrderCore,
} from './ecommerce-orders';

// ── E3 M2 cart/invoice re-export ──────────────────────────────────────────────
// Sprint E3 M2 — panier (CRUD + conversion → commande via createOrderCore),
// historique commandes client, et données facture PDF. Ancre DISTINCTE de la
// zone orders M1 ci-dessus (append-only, aucune modif du bloc orders M1).
// Routage worker.ts reste centralisé sur `ec.*`.
export {
  handleGetCart,
  handleAddCartItem,
  handleUpdateCartItem,
  handleDeleteCartItem,
  handleConvertCart,
  handleCustomerOrders,
} from './ecommerce-cart';

export { handleGetOrderInvoice } from './ecommerce-invoice';

// ── E8 M1 — Omnicanal concurrent : canaux de vente + stratégie inventaire ─────
// Sprint E8 M1 — CRUD canaux (sales_channels) + sélecteur de stratégie
// d'inventaire multi-canal. `resolveInventoryStrategy` WRAPPE les helpers
// stock E2 (intralys_master = délégation verbatim ⇒ rétro-compat bit-pour-bit).
// Noms FIGÉS : M2 câble ces handlers dans worker.ts (routes /api/ecommerce/channels).
export {
  handleListChannels,
  handleCreateChannel,
  handleUpdateChannel,
  handleDeleteChannel,
  handleSetInventoryStrategy,
  // Sélecteur + interface stratégie — consommé par M2 (sync) / E3 hooks futurs.
  resolveInventoryStrategy,
} from './ecommerce-inventory-strategy';
export type {
  InventoryStrategy,
  InventoryStrategyKind,
  StockRef,
} from './ecommerce-inventory-strategy';

export async function handleUpdateOrder(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const okStatus = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded'];
  if (okStatus.includes(body.status as string)) { sets.push('status = ?'); params.push(body.status); }
  if (typeof body.note === 'string') { sets.push('note = ?'); params.push(sanitizeInput(body.note, 2000)); }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(id, clientId);
  const res = await env.DB.prepare(
    `UPDATE orders SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Commande introuvable' }, 404);
  return json({ data: { id, success: true } });
}

export async function handleDeleteOrder(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const res = await env.DB.prepare(
    'DELETE FROM orders WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).run();
  if (!res.meta.changes) return json({ error: 'Commande introuvable' }, 404);
  return json({ data: { success: true } });
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function handleListCustomers(env: Env, auth: Auth, url: URL): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const { limit, offset } = parsePaging(url);

  const countRow = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM customers WHERE client_id = ?',
  ).bind(clientId).first()) as { n: number } | null;

  const { results } = await env.DB.prepare(
    `SELECT * FROM customers WHERE client_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(clientId, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

export async function handleGetCustomer(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const row = await env.DB.prepare(
    'SELECT * FROM customers WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!row) return json({ error: 'Client boutique introuvable' }, 404);
  return json({ data: row });
}

export async function handleCreateCustomer(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const email = sanitizeInput((body.email as string) || '', 200).toLowerCase();
  if (!email) return json({ error: 'Le courriel du client est requis' }, 400);
  const phone = sanitizeInput((body.phone as string) || '', 50) || null;
  const firstName = sanitizeInput((body.first_name as string) || '', 100);
  const lastName = sanitizeInput((body.last_name as string) || '', 100);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO customers (id, client_id, email, phone, first_name, last_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, clientId, email, phone, firstName, lastName).run();
  } catch {
    // UNIQUE(client_id, email) probable
    return json(
      { error: 'Création impossible', message: 'Un client avec ce courriel existe déjà.' },
      409,
    );
  }

  // Réconciliation customer ↔ lead — best-effort, n'échoue jamais la création.
  try {
    await reconcileCustomerWithLead(env, clientId, { id, email, phone });
  } catch {
    // silencieux : la réconciliation est un enrichissement, pas un prérequis
  }

  return json({ data: { id, success: true } }, 201);
}

export async function handleUpdateCustomer(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.first_name === 'string') { sets.push('first_name = ?'); params.push(sanitizeInput(body.first_name, 100)); }
  if (typeof body.last_name === 'string') { sets.push('last_name = ?'); params.push(sanitizeInput(body.last_name, 100)); }
  if (typeof body.phone === 'string') { sets.push('phone = ?'); params.push(sanitizeInput(body.phone, 50)); }
  if (typeof body.accepts_marketing === 'number') { sets.push('accepts_marketing = ?'); params.push(body.accepts_marketing ? 1 : 0); }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(id, clientId);
  const res = await env.DB.prepare(
    `UPDATE customers SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Client boutique introuvable' }, 404);
  return json({ data: { id, success: true } });
}

export async function handleDeleteCustomer(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const res = await env.DB.prepare(
    'DELETE FROM customers WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).run();
  if (!res.meta.changes) return json({ error: 'Client boutique introuvable' }, 404);
  return json({ data: { success: true } });
}
