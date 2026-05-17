// ── _ecommerce-fixtures.ts — helpers fixtures e-commerce (Sprint S5 M1) ──────
//
// ⚠️ SIGNATURE FIGÉE — consommée par les Managers M2 (payments/refunds sandbox)
// et M3 (channel-sync / inventory-cart-returns). NE PAS dévier des signatures
// déclarées ici une fois publiées.
//
// Principe : chaque seedX() programme dans le mock D1 (createMockD1 de
// _helpers.ts, FIGÉ S2 — non modifié) les lignes que les SELECT RÉELS du code
// de prod vont lire. Les sous-chaînes SQL ciblées ci-dessous ont été relevées
// VERBATIM dans le code prod :
//
//   - modules.ts getClientModules :
//       'SELECT client_id FROM users WHERE id = ?'        → 'from users where id'
//       'SELECT modules_json FROM clients WHERE id = ?'   → 'modules_json from clients'
//   - ecommerce-orders.ts createOrderCore :
//       'SELECT v.id ... FROM product_variants v JOIN products p ...'
//                                                          → 'from product_variants v'
//       'SELECT id, status, paid_at, cancelled_at FROM orders WHERE id = ?'
//                                                          → 'from orders where id'
//       'SELECT variant_id, quantity FROM order_items WHERE order_id = ?'
//                                                          → 'from order_items where order_id'
//   - ecommerce-inventory.ts ensureInventory :
//       'SELECT * FROM inventory WHERE variant_id = ?'      → 'from inventory where variant_id'
//   - ecommerce-payments.ts :
//       'SELECT id, status, provider_ref FROM payments WHERE client_id = ? ...'
//                                                          → 'from payments where'
//   - ecommerce-refunds.ts :
//       'SELECT ... FROM refunds WHERE client_id = ? ...'   → 'from refunds where'
//
// Le mock D1 ne simule PAS UNIQUE / FK / INSERT OR IGNORE / meta.changes
// (.run() renvoie toujours {changes:1}). L'idempotence côté DB n'est donc PAS
// prouvable ici : on prouve la LOGIQUE APPLICATIVE en seedant l'état « déjà
// présent » (ex. paid_at non nul) via ces fixtures. Limite documentée dans
// docs/TEST-COVERAGE-ecommerce.md.

import { createMockD1, type MockD1 } from './_helpers';

const DEFAULT_CLIENT = 'client-A';

/**
 * Env minimal accepté par les handlers e-commerce (ils n'utilisent que `DB`).
 * Typé large volontairement : les handlers attendent `Env`, on fournit DB mock.
 */
export function ecomEnv(db: MockD1): { DB: MockD1 } {
  return { DB: db };
}

/**
 * Seed la résolution du tenant : `getClientModules` lit users.client_id puis
 * clients.modules_json. Module 'ecommerce' actif pour que le gating amont
 * (requireModule, géré par worker.ts) laisse passer si appelé.
 *
 * NOTE : `createOrderCore` reçoit déjà `clientId` en argument et n'appelle PAS
 * resolveClientId — seedTenant est requis pour les WRAPPERS HTTP
 * (handleCreateOrder / handleUpdateOrderStatus) qui résolvent le tenant.
 */
export function seedTenant(db: MockD1, clientId: string = DEFAULT_CLIENT): void {
  db.seed('from users where id', [{ client_id: clientId }]);
  db.seed('modules_json from clients', [{ modules_json: '["ecommerce"]' }]);
}

/**
 * Seed une variante résolvable par createOrderCore (JOIN product_variants /
 * products) + son inventaire. `priceOverride` : `null` ⇒ base_price utilisé ;
 * une valeur (même 0) ⇒ prend le pas (le code teste `price_override != null`).
 * `stock` (défaut 9999, large = jamais en rupture sauf si on veut tester 409).
 *
 * ⚠️ Le mock D1 résout par SOUS-CHAÎNE 1er-match : un seul jeu de variant /
 * inventory à la fois. Pour tester plusieurs variantes distinctes, seeder la
 * dernière voulue ou empiler les lignes (ex. items résolus séquentiellement
 * renvoient la même row — suffisant pour les calculs de subtotal/snapshots).
 */
export function seedVariant(
  db: MockD1,
  o: {
    variantId: string;
    clientId?: string;
    basePrice: number;
    priceOverride?: number | null;
    stock?: number;
  },
): void {
  const stock = o.stock ?? 9999;
  db.seed('from product_variants v', [
    {
      variant_id: o.variantId,
      variant_title: `Variante ${o.variantId}`,
      sku: `SKU-${o.variantId}`,
      price_override: o.priceOverride ?? null,
      product_id: `prod-${o.variantId}`,
      product_title: `Produit ${o.variantId}`,
      base_price: o.basePrice,
    },
  ]);
  db.seed('from inventory where variant_id', [
    {
      id: `inv-${o.variantId}`,
      variant_id: o.variantId,
      quantity: stock,
      reserved: 0,
      low_stock_threshold: 5,
      track_inventory: 1,
      allow_backorder: 0,
      location: null,
      updated_at: null,
    },
  ]);
}

/**
 * Seed une commande lisible par handleUpdateOrderStatus / commitOrderSale
 * (SELECT id, status, paid_at, cancelled_at FROM orders WHERE id = ?) et par
 * handleGetOrder / handleListOrders (SELECT * FROM orders WHERE id = ?).
 *
 * `status` (défaut 'pending'). Pour prouver les gardes idempotentes, passer
 * un état « déjà » concrétisé via paid_at/cancelled_at (cf. seedOrderState).
 */
export function seedOrder(
  db: MockD1,
  o: {
    orderId: string;
    clientId?: string;
    status?: string;
    total?: number;
    customerId?: string;
    externalId?: string;
  },
): void {
  const row = {
    id: o.orderId,
    client_id: o.clientId ?? DEFAULT_CLIENT,
    customer_id: o.customerId ?? null,
    order_number: '#1001',
    status: o.status ?? 'pending',
    financial_status: 'unpaid',
    fulfillment_status: 'unfulfilled',
    subtotal_cents: o.total ?? 0,
    tps_cents: 0,
    tvq_cents: 0,
    shipping_cents: 0,
    discount_cents: 0,
    total_cents: o.total ?? 0,
    email: 'client@example.com',
    note: '',
    source: 'web',
    external_id: o.externalId ?? null,
    paid_at: null,
    cancelled_at: null,
    created_at: '2026-01-01 00:00:00',
  };
  db.seed('from orders where id', [row]);
}

/**
 * Seed un paiement lisible par ecommerce-payments.ts (lookup idempotency_key /
 * provider_ref). Utilisé par M2 (sandbox payments) — fixture figée ici.
 */
export function seedPayment(
  db: MockD1,
  o: {
    paymentId: string;
    orderId: string;
    status?: string;
    provider?: string;
    idempotencyKey?: string;
  },
): void {
  db.seed('from payments where', [
    {
      id: o.paymentId,
      order_id: o.orderId,
      client_id: DEFAULT_CLIENT,
      status: o.status ?? 'pending',
      provider: o.provider ?? 'sandbox',
      provider_ref: `pi_${o.paymentId}`,
      idempotency_key: o.idempotencyKey ?? null,
      amount_cents: 0,
    },
  ]);
}

/**
 * Seed un remboursement lisible par ecommerce-refunds.ts (lookup
 * idempotency_key / agrégat par order_id). Utilisé par M2 (sandbox refunds).
 */
export function seedRefund(
  db: MockD1,
  o: {
    refundId: string;
    orderId: string;
    amount: number;
    status?: string;
  },
): void {
  db.seed('from refunds where', [
    {
      id: o.refundId,
      order_id: o.orderId,
      client_id: DEFAULT_CLIENT,
      amount_cents: o.amount,
      status: o.status ?? 'succeeded',
      idempotency_key: null,
    },
  ]);
}

// ── Helpers de commodité (au-delà de la signature figée, additifs) ───────────

/**
 * Variante de seedOrder posant explicitement paid_at / cancelled_at pour
 * prouver les GARDES applicatives idempotentes (le code relit-il l'existant
 * avant de re-commit/re-release ?). Le mock ne simule pas l'idempotence DB ;
 * cette fixture matérialise l'état « déjà concrétisé » côté lecture.
 */
export function seedOrderState(
  db: MockD1,
  o: {
    orderId: string;
    status: string;
    paidAt?: string | null;
    cancelledAt?: string | null;
    customerId?: string | null;
  },
): void {
  db.seed('from orders where id', [
    {
      id: o.orderId,
      client_id: DEFAULT_CLIENT,
      customer_id: o.customerId ?? null,
      status: o.status,
      paid_at: o.paidAt ?? null,
      cancelled_at: o.cancelledAt ?? null,
    },
  ]);
}

/** Seed les lignes d'une commande (SELECT variant_id, quantity FROM order_items). */
export function seedOrderItems(
  db: MockD1,
  lines: Array<{ variant_id: string; quantity: number }>,
): void {
  db.seed('from order_items where order_id', lines);
}

export { createMockD1, type MockD1 };
