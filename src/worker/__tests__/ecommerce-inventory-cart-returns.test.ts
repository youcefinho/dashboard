// ── Tests inventaire (séquence) + panier + retours — Sprint S5 M3.C4 ────────
//
// Couvre, en LECTURE SEULE (0 modif prod) :
//   - ecommerce-inventory.ts : séquence NOMINALE reserveStock → commitSale →
//     releaseStock + garde multi-tenant S2 (clientId fourni mismatch → refus /
//     absent → rétro-compat OK). ⚠️ CAS NOUVEAUX — complément
//     NON-chevauchant à ecommerce-multitenant.inventory.test.ts (S2) qui teste
//     handleGetInventory/handleAdjustInventory/handleListMovements + reserve/
//     commit isolés. Ici : la SÉQUENCE chaînée + releaseStock (non couvert S2).
//   - ecommerce-cart.ts : handleConvertCart (cart → createOrderCore, panier
//     marqué 'converted' au succès ; panier vide / déjà converti / sans email).
//   - ecommerce-returns.ts : handleCreateReturn (création valide statut
//     'pending', AUCUN refund ; cas invalides : commande introuvable, retour
//     vide, article hors commande, article non livré).
//
// ⚠️ LIMITE MOCK D1 (RAPPORT M3, pas le doc partagé) : pas de simulation
// UNIQUE/FK/INSERT OR IGNORE/meta.changes (.run() → {changes:1}). On prouve la
// LOGIQUE APPLICATIVE via l'état seedé + l'observation de db.calls/retours.
// Le mock résout les SELECT par sous-chaîne (1er match). Run réel = Rochdi.
//
// Déterministe, environment:'node'. createMockD1 + fixtures M1 FIGÉES (non
// mutées). seedVariant/seedTenant réutilisés tels quels.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockD1,
  type MockD1,
  ecomEnv,
  seedTenant,
  seedVariant,
} from './_ecommerce-fixtures';
import {
  reserveStock,
  commitSale,
  releaseStock,
} from '../ecommerce-inventory';
import { handleConvertCart } from '../ecommerce-cart';
import { handleCreateReturn } from '../ecommerce-returns';

const CLIENT_A = 'client-A';
const CLIENT_B = 'client-B';
const AUTH = { userId: 'user-A', role: 'admin' };

function called(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}
function callsMatching(db: MockD1, re: RegExp) {
  return db.calls.filter((c) => re.test(c.sql));
}

// ════════════════════════════════════════════════════════════════════════════
// M3.C4a — Séquence inventaire reserve → commit → release (CAS NOUVEAUX)
// ════════════════════════════════════════════════════════════════════════════
// Non couvert par S2 : S2 teste reserve/commit ISOLÉS. Ici on enchaîne les 3
// helpers sur la même variante et on valide les effets D1 attendus à chaque
// étape (UPDATE inventory + INSERT inventory_movements typé).

describe('inventaire — séquence nominale reserve → commit → release', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('reserveStock : incrémente reserved + mouvement "reservation" (delta négatif), quantity inchangée', async () => {
    seedVariant(db, { variantId: 'v-seq', basePrice: 1000, stock: 50 });

    const r = await reserveStock(ecomEnv(db) as never, 'v-seq', 4, {
      type: 'order', id: 'ord-1', by: 'user-A',
    });

    expect(r.ok).toBe(true);
    expect(r.available).toBe(50 - 4); // 50 dispo - 4 réservés
    // reserved += n (quantity NON touchée — réservation ≠ vente).
    expect(called(db, /update inventory set reserved = reserved \+ \?/i)).toBe(true);
    expect(called(db, /update inventory set quantity/i)).toBe(false);
    const mv = callsMatching(db, /insert into inventory_movements/i);
    expect(mv.length).toBe(1);
    expect(mv[0].sql).toMatch(/'reservation'/i);
    // delta informatif négatif sur le disponible.
    expect(mv[0].args).toContain(-4);
  });

  it('commitSale : décrémente quantity ET reserved, mouvement "sale"', async () => {
    // Stock avec une réservation préexistante (étape post-reserve simulée).
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-seq', variant_id: 'v-seq', quantity: 50, reserved: 4,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await commitSale(ecomEnv(db) as never, 'v-seq', 4, {
      type: 'order', id: 'ord-1',
    });

    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(50 - 4);
    // quantity = ? , reserved = reserved - ? (libère la réserve concrétisée).
    expect(called(db, /update inventory\s+set quantity = \?, reserved = reserved - \?/i)).toBe(true);
    const mv = callsMatching(db, /insert into inventory_movements/i);
    expect(mv.length).toBe(1);
    expect(mv[0].sql).toMatch(/'sale'/i);
  });

  it('releaseStock : décrémente reserved (annulation), mouvement "return", borne >= 0', async () => {
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-seq', variant_id: 'v-seq', quantity: 50, reserved: 4,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await releaseStock(ecomEnv(db) as never, 'v-seq', 4, {
      type: 'order', id: 'ord-1',
    });

    expect(r.ok).toBe(true);
    expect(r.reserved).toBe(0); // 4 - 4
    expect(called(db, /update inventory set reserved = reserved - \?/i)).toBe(true);
    const mv = callsMatching(db, /insert into inventory_movements/i);
    expect(mv.length).toBe(1);
    expect(mv[0].sql).toMatch(/'return'/i);
  });

  it('releaseStock borne : libérer plus que réservé ne descend jamais reserved < 0', async () => {
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-seq', variant_id: 'v-seq', quantity: 50, reserved: 2,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await releaseStock(ecomEnv(db) as never, 'v-seq', 10, {
      type: 'order', id: 'ord-1',
    });

    expect(r.ok).toBe(true);
    // release = min(10, reserved=2) = 2 → reserved final 0 (jamais négatif).
    expect(r.reserved).toBe(0);
  });

  it('reserveStock refuse si available < qty, track on, backorder off (insufficient)', async () => {
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-low', variant_id: 'v-low', quantity: 3, reserved: 0,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await reserveStock(ecomEnv(db) as never, 'v-low', 10);

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient');
    expect(r.available).toBe(3);
    // Refus AVANT toute écriture (pas d'UPDATE/INSERT inventory).
    expect(called(db, /update inventory|insert into inventory_movements/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3.C4b — Garde multi-tenant S2 sur la SÉQUENCE (cas NOUVEAUX, non dupliqués)
// ════════════════════════════════════════════════════════════════════════════
// S2 teste reserveStock/commitSale isolés. Ici : commitSale + releaseStock avec
// clientId (mismatch → refus / propriétaire → passe / absent → rétro-compat).

describe('inventaire — garde tenant S2 sur commit/release (séquence)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('commitSale : clientId fourni ne possède PAS la variante → tenant_mismatch, aucune écriture', async () => {
    // guardStockTenant → assertVariantTenant → resolveVariant : 0 ligne.
    db.seed('from product_variants v', []);

    const r = await commitSale(ecomEnv(db) as never, 'v-de-B', 2, {
      clientId: CLIENT_B, type: 'order', id: 'o1',
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('tenant_mismatch');
    // Refus AVANT ensureInventory : aucune écriture inventory.
    expect(called(db, /update inventory|insert into inventory_movements/i)).toBe(false);
  });

  it('releaseStock : clientId fourni ne possède PAS la variante → tenant_mismatch', async () => {
    db.seed('from product_variants v', []);

    const r = await releaseStock(ecomEnv(db) as never, 'v-de-B', 1, {
      clientId: CLIENT_B,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('tenant_mismatch');
    expect(called(db, /update inventory|insert into inventory_movements/i)).toBe(false);
  });

  it('releaseStock : clientId propriétaire → passe (aucune sur-restriction)', async () => {
    // resolveVariant renvoie une ligne (variante du tenant A).
    db.seed('from product_variants v', [
      { variant_id: 'v-A', sku: 'S', product_id: 'p', product_title: 'T' },
    ]);
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-A', variant_id: 'v-A', quantity: 10, reserved: 3,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await releaseStock(ecomEnv(db) as never, 'v-A', 2, {
      clientId: CLIENT_A,
    });

    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.reserved).toBe(1); // 3 - 2
  });

  it('commitSale : clientId absent → rétro-compat, comportement inchangé (passe)', async () => {
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-A', variant_id: 'v-A', quantity: 10, reserved: 2,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);

    const r = await commitSale(ecomEnv(db) as never, 'v-A', 1, {
      type: 'order', id: 'o1', // pas de clientId → garde court-circuitée
    });

    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3.C4c — handleConvertCart : cart → commande (RÉUTILISE createOrderCore)
// ════════════════════════════════════════════════════════════════════════════

describe('handleConvertCart — conversion panier → commande', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
    seedTenant(db, CLIENT_A);
  });

  function req(body: Record<string, unknown>) {
    return new Request('https://x/cart/c1/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('panier actif avec lignes + email → createOrderCore appelé, panier marqué converted', async () => {
    // SELECT ... FROM carts WHERE id = ? AND client_id = ?
    db.seed('from carts', [
      { id: 'c1', client_id: CLIENT_A, customer_id: null, token: 'tok', status: 'active' },
    ]);
    // SELECT ci.variant_id, ci.quantity FROM cart_items ci JOIN ...
    db.seed('from cart_items ci', [{ variant_id: 'v-1', quantity: 2 }]);
    // createOrderCore résout la variante (JOIN product_variants v) + inventory.
    seedVariant(db, { variantId: 'v-1', basePrice: 2000, stock: 100 });

    const res = await handleConvertCart(req({ email: 'acheteur@demo.com' }), ecomEnv(db) as never, AUTH, 'c1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { order_id: string } };
    expect(body.data.order_id).toBeTruthy();
    // createOrderCore a inséré une commande (preuve indirecte d'invocation).
    expect(called(db, /insert into orders/i)).toBe(true);
    // Succès → panier passé en 'converted'.
    expect(
      called(db, /update carts\s+set status = 'converted'/i),
    ).toBe(true);
  });

  it('panier introuvable (autre tenant) → 404, createOrderCore non appelé', async () => {
    db.seed('from carts', []);

    const res = await handleConvertCart(req({ email: 'x@y.com' }), ecomEnv(db) as never, AUTH, 'c1');

    expect(res.status).toBe(404);
    expect(called(db, /insert into orders/i)).toBe(false);
  });

  it('panier déjà converti → 409, pas de nouvelle commande', async () => {
    db.seed('from carts', [
      { id: 'c1', client_id: CLIENT_A, customer_id: null, token: 'tok', status: 'converted' },
    ]);

    const res = await handleConvertCart(req({ email: 'x@y.com' }), ecomEnv(db) as never, AUTH, 'c1');

    expect(res.status).toBe(409);
    expect(called(db, /insert into orders/i)).toBe(false);
  });

  it('panier vide → 400 (panier non corrompu, createOrderCore non appelé)', async () => {
    db.seed('from carts', [
      { id: 'c1', client_id: CLIENT_A, customer_id: null, token: 'tok', status: 'active' },
    ]);
    db.seed('from cart_items ci', []); // aucune ligne

    const res = await handleConvertCart(req({ email: 'x@y.com' }), ecomEnv(db) as never, AUTH, 'c1');

    expect(res.status).toBe(400);
    expect(called(db, /insert into orders/i)).toBe(false);
    expect(called(db, /update carts\s+set status = 'converted'/i)).toBe(false);
  });

  it('aucun email résoluble → 400', async () => {
    db.seed('from carts', [
      { id: 'c1', client_id: CLIENT_A, customer_id: null, token: 'tok', status: 'active' },
    ]);
    db.seed('from cart_items ci', [{ variant_id: 'v-1', quantity: 1 }]);

    const res = await handleConvertCart(req({}), ecomEnv(db) as never, AUTH, 'c1');

    expect(res.status).toBe(400);
    expect(called(db, /insert into orders/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M3.C4d — handleCreateReturn : demande de retour (statut pending, 0 refund)
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateReturn — création RMA valide & cas invalides', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
    seedTenant(db, CLIENT_A);
  });

  function req(body: Record<string, unknown>) {
    return new Request('https://x/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('retour valide (article livré) → 201 statut pending, AUCUN refund déclenché', async () => {
    // SELECT id, client_id FROM orders WHERE id = ? AND client_id = ?
    db.seed('from orders where id', [
      { id: 'o1', client_id: CLIENT_A },
    ]);
    // SELECT id, quantity FROM order_items WHERE order_id = ?
    db.seed('from order_items where order_id', [{ id: 'oi-1', quantity: 3 }]);
    // SUM(shipment_items) livrés : oi-1 livré en 3 (>= demandé).
    db.seed('from shipment_items si', [{ oid: 'oi-1', n: 3 }]);
    // INSERT ... RETURNING id
    db.seed('into return_requests', [{ id: 'rma-1' }]);
    // loadReturn : SELECT ... FROM return_requests WHERE id = ? AND client_id = ?
    db.seed('from return_requests where id = ? and client_id', [
      {
        id: 'rma-1', client_id: CLIENT_A, order_id: 'o1', status: 'pending',
        reason: 'defective', region_snapshot: null,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      },
    ]);
    db.seed('from rma_items where return_request_id', [
      { id: 'ri-1', return_request_id: 'rma-1', order_item_id: 'oi-1', quantity: 2, restock: 0 },
    ]);

    const res = await handleCreateReturn(
      req({
        order_id: 'o1',
        items: [{ order_item_id: 'oi-1', quantity: 2 }],
        reason: 'defective',
      }),
      ecomEnv(db) as never,
      AUTH,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('pending');
    // Création RMA : INSERT return_requests + INSERT rma_items.
    expect(called(db, /insert into return_requests/i)).toBe(true);
    expect(called(db, /insert into rma_items/i)).toBe(true);
    // ⚠️ GARDE ANTI-ABUS : AUCUN refund à la création (refund = transition
    // 'received' seulement, hors scope handleCreateReturn).
    expect(called(db, /insert into refunds|update .*financial_status/i)).toBe(false);
  });

  it('commande introuvable (autre tenant) → 404', async () => {
    db.seed('from orders where id', []);

    const res = await handleCreateReturn(
      req({ order_id: 'o-inconnu', items: [{ order_item_id: 'oi-1', quantity: 1 }] }),
      ecomEnv(db) as never,
      AUTH,
    );

    expect(res.status).toBe(404);
    expect(called(db, /insert into return_requests/i)).toBe(false);
  });

  it('retour vide (aucun item) → 400', async () => {
    db.seed('from orders where id', [
      { id: 'o1', client_id: CLIENT_A },
    ]);

    const res = await handleCreateReturn(
      req({ order_id: 'o1', items: [] }),
      ecomEnv(db) as never,
      AUTH,
    );

    expect(res.status).toBe(400);
    expect(called(db, /insert into return_requests/i)).toBe(false);
  });

  it('article hors commande → 404 (anti-abus : ligne pas dans order_items)', async () => {
    db.seed('from orders where id', [
      { id: 'o1', client_id: CLIENT_A },
    ]);
    // order_items ne contient PAS l'order_item_id demandé.
    db.seed('from order_items where order_id', [{ id: 'oi-AUTRE', quantity: 5 }]);
    db.seed('from shipment_items si', [{ oid: 'oi-AUTRE', n: 5 }]);

    const res = await handleCreateReturn(
      req({ order_id: 'o1', items: [{ order_item_id: 'oi-INEXISTANT', quantity: 1 }] }),
      ecomEnv(db) as never,
      AUTH,
    );

    expect(res.status).toBe(404);
    expect(called(db, /insert into return_requests/i)).toBe(false);
  });

  it('article non livré (demandé > livré) → 409 (anti-abus)', async () => {
    db.seed('from orders where id', [
      { id: 'o1', client_id: CLIENT_A },
    ]);
    db.seed('from order_items where order_id', [{ id: 'oi-1', quantity: 5 }]);
    // Livré 1 seul, on en demande 3 → refus 409.
    db.seed('from shipment_items si', [{ oid: 'oi-1', n: 1 }]);

    const res = await handleCreateReturn(
      req({ order_id: 'o1', items: [{ order_item_id: 'oi-1', quantity: 3 }] }),
      ecomEnv(db) as never,
      AUTH,
    );

    expect(res.status).toBe(409);
    expect(called(db, /insert into return_requests/i)).toBe(false);
  });
});
