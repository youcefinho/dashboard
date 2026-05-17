// ── Isolation multi-tenant : facture commande — Sprint S2 M2 ────────────────
//
// `order_items` n'a PAS de colonne client_id : l'isolation dérive
// EXCLUSIVEMENT de l'order parent validé `WHERE id = ? AND client_id = ?`.
// Ces tests valident :
//   1. Une commande d'un autre tenant → 404, items JAMAIS lus (gate order
//      bloque AVANT la lecture order_items).
//   2. Non-régression : la facture d'une commande du tenant courant rend
//      normalement (200) avec ses items (aucune sur-restriction).
//   3. order_items est relié à l'id de l'order VÉRIFIÉ (pas l'orderId brut
//      d'URL non re-validé).
//
// Déterministe, environment:'node'. Mock D1 partagé (_helpers.createMockD1).

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import { handleGetOrderInvoice } from '../ecommerce-invoice';

type Env = { DB: MockD1 };

const AUTH_A = { userId: 'user-A', role: 'admin' };
const CLIENT_A = 'client-A';
const ORDER_OF_A = 'order-A-1';
const ORDER_OF_B = 'order-B-1';

function env(db: MockD1): Env {
  return { DB: db };
}

function seedClientA(db: MockD1) {
  db.seed('from users where id', [{ client_id: CLIENT_A }]);
  db.seed('modules_json from clients', [{ modules_json: '["ecommerce"]' }]);
  db.seed('name, email from clients', [{ name: 'Commerce A', email: 'a@a.ca' }]);
  db.seed('gst_number, qst_number from clients', [
    { gst_number: null, qst_number: null },
  ]);
}

describe('multi-tenant invoice — isolation cross-tenant (A ne voit pas B)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it("commande d'un autre tenant → 404, order_items JAMAIS lus", async () => {
    seedClientA(db);
    // orders WHERE id = ? AND client_id = ? → 0 ligne (B ≠ A) = comportement réel.
    db.seed('from orders where id', []);
    // Si jamais le code dépassait le gate (régression), ce seed prouverait la fuite.
    db.seed('from order_items where order_id', [
      { product_title_snapshot: 'FUITE', quantity: 9, total_cents: 999 },
    ]);

    const res = await handleGetOrderInvoice(env(db), AUTH_A, ORDER_OF_B);
    expect(res.status).toBe(404);

    // order_items NE DOIT PAS avoir été interrogé (gate order a bloqué avant).
    const readItems = db.calls.some(
      (c) => /from order_items where order_id/i.test(c.sql),
    );
    expect(readItems).toBe(false);
  });

  it('le gate order filtre bien par client_id (binds = orderId + tenant)', async () => {
    seedClientA(db);
    db.seed('from orders where id', []);
    await handleGetOrderInvoice(env(db), AUTH_A, ORDER_OF_B);

    const gate = db.calls.find(
      (c) => /from orders where id = \? and client_id = \?/i.test(c.sql),
    );
    expect(gate).toBeDefined();
    expect(gate?.args).toEqual([ORDER_OF_B, CLIENT_A]);
  });
});

describe('multi-tenant invoice — non-régression (commande du tenant rend)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('commande du tenant A → 200 + items rendus (aucune sur-restriction)', async () => {
    seedClientA(db);
    db.seed('from orders where id', [
      {
        id: ORDER_OF_A, order_number: '#1001', status: 'paid',
        financial_status: 'paid', fulfillment_status: 'fulfilled',
        client_id: CLIENT_A, customer_id: null, currency: 'CAD',
        tax_region: 'QC', subtotal_cents: 1000, tps_cents: 50,
        tvq_cents: 99, shipping_cents: 0, discount_cents: 0,
        total_cents: 1149, tax_breakdown_json: null,
        created_at: '2026-05-16', placed_at: '2026-05-16',
      },
    ]);
    db.seed('from order_items where order_id', [
      {
        product_title_snapshot: 'Produit A', variant_title_snapshot: 'M',
        sku_snapshot: 'SKU-A', unit_price_cents: 1000, quantity: 1,
        total_cents: 1000, tax_cents: 149,
      },
    ]);

    const res = await handleGetOrderInvoice(env(db), AUTH_A, ORDER_OF_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { order: { id: string }; items: { product_title: string }[] };
    };
    expect(body.data.order.id).toBe(ORDER_OF_A);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].product_title).toBe('Produit A');
  });

  it("order_items est relié à l'id de l'order vérifié (pas l'URL brute)", async () => {
    seedClientA(db);
    // L'order renvoyé porte un id canonique distinct de l'orderId d'URL.
    db.seed('from orders where id', [
      {
        id: ORDER_OF_A, order_number: '#1001', status: 'paid',
        financial_status: 'paid', fulfillment_status: 'fulfilled',
        client_id: CLIENT_A, customer_id: null, currency: 'CAD',
        tax_region: 'QC', subtotal_cents: 0, tps_cents: 0, tvq_cents: 0,
        shipping_cents: 0, discount_cents: 0, total_cents: 0,
        tax_breakdown_json: null, created_at: '2026-05-16',
      },
    ]);
    db.seed('from order_items where order_id', []);

    await handleGetOrderInvoice(env(db), AUTH_A, 'url-raw-orderid');

    const itemsCall = db.calls.find(
      (c) => /from order_items where order_id/i.test(c.sql),
    );
    expect(itemsCall).toBeDefined();
    // Lié à l'id de l'order vérifié, PAS l'orderId brut de l'URL.
    expect(itemsCall?.args).toEqual([ORDER_OF_A]);
  });
});
