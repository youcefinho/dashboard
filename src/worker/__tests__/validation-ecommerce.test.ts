// ════════════════════════════════════════════════════════════
// S3 M2 — Tests d'INTÉGRATION de la validation e-commerce
// ════════════════════════════════════════════════════════════
//
// M1 (validation-layer.test.ts) prouve déjà les schémas en isolation.
// Ici on prouve l'INTÉGRATION early-return dans les handlers durcis M2 :
//
//  1. Payload LÉGITIME réel → le handler PROCÈDE (pas de 400 VALIDATION ;
//     status 2xx, ou au pire une 4xx/409 MÉTIER — jamais code:'VALIDATION').
//  2. Payload INVALIDE (requis absent / type faux) → 400 avec corps
//     { error:<string>, code:'VALIDATION' } (rétro-compat front M1).
//  3. Non-régression : la garde multi-tenant S2 (resolveVariant /
//     variantInTenant) reste en place — la validation s'AJOUTE avant,
//     n'enlève rien.
//
// Déterministe, environment:'node'. Mock D1 partagé (_helpers.createMockD1).

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import {
  handleCreateOrder,
  handleCreateManualOrder,
  handleUpdateOrderStatus,
} from '../ecommerce-orders';
import { handleCreateProduct, handleUpdateProduct } from '../ecommerce-products';
import { handleAdjustInventory } from '../ecommerce-inventory';
import { handleAddCartItem } from '../ecommerce-cart';
import { handleCreateReturn } from '../ecommerce-returns';

type Env = { DB: MockD1 };

const AUTH = { userId: 'user-A', role: 'admin' };
const CLIENT = 'client-A';

function env(db: MockD1): Env {
  return { DB: db };
}

/** getClientModules : résout le tenant CLIENT + module ecommerce actif. */
function seedTenant(db: MockD1) {
  db.seed('from users where id', [{ client_id: CLIENT }]);
  db.seed('modules_json from clients', [{ modules_json: '["ecommerce"]' }]);
}

function req(body: unknown): Request {
  return new Request('https://x/api/ecommerce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Lit le corps JSON et confirme une 400 de validation normalisée M1. */
async function expectValidation400(res: Response) {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: unknown; code: unknown };
  expect(typeof body.error).toBe('string');
  expect((body.error as string).length).toBeGreaterThan(0);
  expect(body.code).toBe('VALIDATION');
}

/** Confirme que la réponse n'est PAS une 400 de validation (handler a procédé). */
async function expectNotValidation(res: Response) {
  if (res.status === 400) {
    const body = (await res.clone().json().catch(() => ({}))) as { code?: unknown };
    expect(body.code).not.toBe('VALIDATION');
  } else {
    expect(res.status).not.toBe(400);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2.1 — ecommerce-orders.ts
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateOrder — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('payload invalide (items absent) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleCreateOrder(req({ email: 'a@b.ca' }), env(db) as never, AUTH);
    await expectValidation400(res);
    // La logique métier ne doit pas avoir tenté d'écrire la commande.
    const wrote = db.calls.some((c) => /insert into orders/i.test(c.sql));
    expect(wrote).toBe(false);
  });

  it('payload invalide (body non-JSON) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleCreateOrder(req('{pas du json'), env(db) as never, AUTH);
    await expectValidation400(res);
  });

  it('payload légitime → handler procède (création commande, 201)', async () => {
    seedTenant(db);
    // createOrderCore : résolution variante (JOIN products) + counters.
    db.seed('from product_variants v', [{
      variant_id: 'v-1', variant_title: 'M', sku: 'S-1',
      price_override: 1999, product_id: 'p-1', product_title: 'T-shirt', base_price: 1999,
    }]);
    db.seed('returning next_number', [{ next_number: 1002 }]);
    db.seed('from inventory where variant_id', [{
      id: 'inv-1', variant_id: 'v-1', quantity: 50, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    }]);
    const res = await handleCreateOrder(
      req({ email: 'client@boutique.qc.ca', items: [{ variant_id: 'v-1', quantity: 2 }] }),
      env(db) as never, AUTH,
    );
    await expectNotValidation(res);
    expect(res.status).toBe(201);
  });
});

describe('handleCreateManualOrder — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('payload invalide (email absent) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleCreateManualOrder(
      req({ items: [{ variant_id: 'v-1' }] }), env(db) as never, AUTH,
    );
    await expectValidation400(res);
  });

  it('payload légitime (sans customer_id) → procède (201)', async () => {
    seedTenant(db);
    db.seed('from product_variants v', [{
      variant_id: 'v-2', variant_title: '', sku: '',
      price_override: null, product_id: 'p-2', product_title: 'Mug', base_price: 1200,
    }]);
    db.seed('returning next_number', [{ next_number: 1010 }]);
    db.seed('from inventory where variant_id', [{
      id: 'inv-2', variant_id: 'v-2', quantity: 10, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    }]);
    const res = await handleCreateManualOrder(
      req({ email: 'manuel@interne.ca', items: [{ variant_id: 'v-2', quantity: 1 }], note: 'Tel' }),
      env(db) as never, AUTH,
    );
    await expectNotValidation(res);
    expect(res.status).toBe(201);
  });
});

describe('handleUpdateOrderStatus — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('statut inconnu → 400 code VALIDATION (pas de lecture commande)', async () => {
    seedTenant(db);
    const res = await handleUpdateOrderStatus(
      req({ status: 'zzz' }), env(db) as never, AUTH, 'order-1',
    );
    await expectValidation400(res);
    const readOrder = db.calls.some((c) => /from orders where id/i.test(c.sql));
    expect(readOrder).toBe(false);
  });

  it('statut valide → handler procède (transition métier appliquée)', async () => {
    seedTenant(db);
    // Commande en 'pending' → transition légale pending→paid.
    db.seed('id, status, paid_at, cancelled_at from orders', [
      { id: 'order-1', status: 'pending', paid_at: null, cancelled_at: null },
    ]);
    db.seed('variant_id, quantity from order_items', []);
    db.seed('customer_id from orders', [{ customer_id: null }]);
    const res = await handleUpdateOrderStatus(
      req({ status: 'paid' }), env(db) as never, AUTH, 'order-1',
    );
    await expectNotValidation(res);
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2.2 — ecommerce-products.ts
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateProduct — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('payload invalide (titre absent) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleCreateProduct(
      req({ description: 'sans titre' }), env(db) as never, AUTH,
    );
    await expectValidation400(res);
    const wrote = db.calls.some((c) => /insert into products/i.test(c.sql));
    expect(wrote).toBe(false);
  });

  it('payload légitime (titre seul) → procède (201)', async () => {
    seedTenant(db);
    // uniqueSlug : aucun produit existant avec ce slug.
    db.seed('id from products where client_id = ? and slug', []);
    const res = await handleCreateProduct(
      req({ title: 'Nouveau produit' }), env(db) as never, AUTH,
    );
    await expectNotValidation(res);
    expect(res.status).toBe(201);
  });
});

describe('handleUpdateProduct — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('404 produit-introuvable conservé AVANT validation (ordre préservé)', async () => {
    seedTenant(db);
    db.seed('id, title from products where id', []); // produit absent
    const res = await handleUpdateProduct(
      req({ status: 'archived' }), env(db) as never, AUTH, 'prod-x',
    );
    expect(res.status).toBe(404);
  });

  it('produit présent + champ invalide (status hors enum) → 400 VALIDATION', async () => {
    seedTenant(db);
    db.seed('id, title from products where id', [{ id: 'prod-1', title: 'Ancien' }]);
    const res = await handleUpdateProduct(
      req({ status: 'pas-un-statut' }), env(db) as never, AUTH, 'prod-1',
    );
    await expectValidation400(res);
  });

  it('produit présent + payload légitime → procède (200)', async () => {
    seedTenant(db);
    db.seed('id, title from products where id', [{ id: 'prod-1', title: 'Ancien' }]);
    const res = await handleUpdateProduct(
      req({ status: 'archived' }), env(db) as never, AUTH, 'prod-1',
    );
    await expectNotValidation(res);
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — inventory / cart / returns (coexistence garde multi-tenant S2)
// ════════════════════════════════════════════════════════════════════════════

describe('handleAdjustInventory — validation + garde S2 préservée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('gate S2 PASSE puis delta invalide (0) → 400 code VALIDATION', async () => {
    seedTenant(db);
    // resolveVariant : la variante appartient au tenant (gate S2 passé).
    db.seed('from product_variants v', [
      { variant_id: 'v-1', sku: 'S', product_id: 'p', product_title: 'T' },
    ]);
    const res = await handleAdjustInventory(
      req({ delta: 0 }), env(db) as never, AUTH, 'v-1',
    );
    await expectValidation400(res);
    // Validation s'ajoute APRÈS le gate tenant : aucun mouvement écrit.
    const wrote = db.calls.some((c) => /insert into inventory_movements/i.test(c.sql));
    expect(wrote).toBe(false);
  });

  it('garde S2 d’abord : variante hors tenant → 404 (jamais 400 validation)', async () => {
    seedTenant(db);
    db.seed('from product_variants v', []); // variante PAS au tenant
    const res = await handleAdjustInventory(
      req({ delta: 5 }), env(db) as never, AUTH, 'v-foreign',
    );
    expect(res.status).toBe(404);
  });

  it('payload légitime + variante du tenant → procède (200, mouvement tracé)', async () => {
    seedTenant(db);
    db.seed('from product_variants v', [
      { variant_id: 'v-1', sku: 'S', product_id: 'p', product_title: 'T' },
    ]);
    db.seed('from inventory where variant_id', [{
      id: 'inv-1', variant_id: 'v-1', quantity: 10, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    }]);
    const res = await handleAdjustInventory(
      req({ delta: 3, reason: 'restock' }), env(db) as never, AUTH, 'v-1',
    );
    await expectNotValidation(res);
    expect(res.status).toBe(200);
    const wrote = db.calls.some((c) => /insert into inventory_movements/i.test(c.sql));
    expect(wrote).toBe(true);
  });
});

describe('handleAddCartItem — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('payload invalide (variant_id absent) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleAddCartItem(
      req({ quantity: 2, token: 'tok-1' }), env(db) as never, AUTH,
    );
    await expectValidation400(res);
  });

  it('payload légitime → handler procède (gate variantInTenant ensuite)', async () => {
    seedTenant(db);
    // variantInTenant : la variante appartient au tenant.
    db.seed('from product_variants v', [{ id: 'v-1' }]);
    // findActiveCart introuvable → création panier ; cart_items vide.
    db.seed('from carts', []);
    db.seed('id, quantity from cart_items', []);
    const res = await handleAddCartItem(
      req({ variant_id: 'v-1', quantity: 1, token: 'tok-1' }), env(db) as never, AUTH,
    );
    await expectNotValidation(res);
    expect(res.status).toBe(201);
  });

  it('payload légitime mais variante hors tenant → 404 (jamais 400 validation)', async () => {
    seedTenant(db);
    db.seed('from product_variants v', []); // pas au tenant
    const res = await handleAddCartItem(
      req({ variant_id: 'v-x', token: 'tok-1' }), env(db) as never, AUTH,
    );
    expect(res.status).toBe(404);
  });
});

describe('handleCreateReturn — validation intégrée', () => {
  let db: MockD1;
  beforeEach(() => { db = createMockD1(); });

  it('payload invalide (order_id absent) → 400 code VALIDATION', async () => {
    seedTenant(db);
    const res = await handleCreateReturn(
      req({ reason: 'trop petit' }), env(db) as never, AUTH,
    );
    await expectValidation400(res);
    const wrote = db.calls.some((c) => /insert into return_requests/i.test(c.sql));
    expect(wrote).toBe(false);
  });

  it('order_id présent mais commande introuvable → 404 (validation passée)', async () => {
    seedTenant(db);
    db.seed('id, client_id from orders where id', []); // commande absente
    const res = await handleCreateReturn(
      req({ order_id: 'ord-x' }), env(db) as never, AUTH,
    );
    expect(res.status).toBe(404);
  });

  it('payload légitime (order_id + items) → validation passée, logique métier ligne-à-ligne', async () => {
    seedTenant(db);
    db.seed('id, client_id from orders where id', [{ id: 'ord-1', client_id: CLIENT }]);
    db.seed('id, quantity from order_items', [{ id: 'oi-1', quantity: 3 }]);
    db.seed('from shipment_items si', [{ oid: 'oi-1', n: 3 }]);
    db.seed('returning id', [{ id: 'ret-1' }]);
    db.seed('return_request_id, order_item_id, quantity, restock', []);
    const res = await handleCreateReturn(
      req({ order_id: 'ord-1', items: [{ order_item_id: 'oi-1', quantity: 1 }], reason: 'size_fit' }),
      env(db) as never, AUTH,
    );
    await expectNotValidation(res);
    expect(res.status).toBe(201);
  });
});
