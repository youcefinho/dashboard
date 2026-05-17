// ── Isolation multi-tenant : inventaire / mouvements — Sprint S2 M2 ─────────
//
// Vérifie que le durcissement défensif n'introduit AUCUNE fuite ni
// sur-restriction. `inventory` / `inventory_movements` n'ont PAS de colonne
// client_id : l'isolation passe par la chaîne
//   product_variants v → products p WHERE p.client_id = ?
// matérialisée par resolveVariant. Ces tests valident :
//   1. Tenant A ne peut PAS lire/écrire l'inventaire d'un variant du tenant B
//      (resolveVariant renvoie 0 ligne → 404, aucune écriture inventory).
//   2. Non-régression : un tenant légitime sur SA variante passe (200).
//   3. Les helpers stock exposés (reserveStock/commitSale) refusent un
//      clientId qui ne possède pas la variante (défense en profondeur), et
//      passent en rétro-compat quand clientId absent.
//
// Déterministe, environment:'node'. Mock D1 partagé (_helpers.createMockD1).

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import {
  handleGetInventory,
  handleAdjustInventory,
  handleListMovements,
  reserveStock,
  commitSale,
} from '../ecommerce-inventory';

type Env = { DB: MockD1 };

const AUTH_A = { userId: 'user-A', role: 'admin' };
const CLIENT_A = 'client-A';
const CLIENT_B = 'client-B';
const VARIANT_OF_B = 'variant-belongs-to-B';
const VARIANT_OF_A = 'variant-belongs-to-A';

function env(db: MockD1): Env {
  return { DB: db };
}

/**
 * Programme le mock pour que :
 *  - getClientModules (users / clients) résolve le tenant `clientId`.
 *  - resolveVariant ne renvoie une ligne QUE si la variante demandée
 *    appartient au tenant (ici : seul VARIANT_OF_A est "à" client-A).
 */
function seedTenant(db: MockD1, opts: { ownsVariant: boolean }) {
  // getClientModules : SELECT client_id FROM users WHERE id = ?
  db.seed('from users where id', [{ client_id: CLIENT_A }]);
  db.seed('modules_json from clients', [{ modules_json: '["ecommerce"]' }]);
  // resolveVariant : JOIN products p ... WHERE v.id = ? AND p.client_id = ?
  // Réel : 0 ligne si le tenant ne possède pas la variante.
  db.seed(
    'from product_variants v',
    opts.ownsVariant
      ? [{ variant_id: VARIANT_OF_A, sku: 'SKU-A', product_id: 'prod-A', product_title: 'Produit A' }]
      : [],
  );
  // inventory existant (utilisé seulement si on dépasse le gate).
  db.seed('from inventory where variant_id', [
    {
      id: 'inv-1', variant_id: VARIANT_OF_A, quantity: 10, reserved: 0,
      low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
      location: null, updated_at: null, last_low_stock_alert_at: null,
    },
  ]);
  db.seed('count(*) as n from inventory_movements', [{ n: 0 }]);
}

describe('multi-tenant inventory — isolation cross-tenant (A ne voit pas B)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('GET inventory : variant du tenant B → 404, aucune écriture inventory', async () => {
    seedTenant(db, { ownsVariant: false }); // A ne possède pas la variante
    const res = await handleGetInventory(env(db), AUTH_A, VARIANT_OF_B);
    expect(res.status).toBe(404);

    // Aucune écriture sur inventory (le gate resolveVariant a bloqué AVANT).
    const wrote = db.calls.some(
      (c) => /insert .*into inventory|update inventory/i.test(c.sql),
    );
    expect(wrote).toBe(false);
  });

  it('POST adjust : variant du tenant B → 404, aucun mouvement inséré', async () => {
    seedTenant(db, { ownsVariant: false });
    const req = new Request('https://x/adjust', {
      method: 'POST', body: JSON.stringify({ delta: 5 }),
    });
    // signature : (request, env, auth, variantId)
    const res = await handleAdjustInventory(req, env(db), AUTH_A, VARIANT_OF_B);
    expect(res.status).toBe(404);

    const wroteMovement = db.calls.some(
      (c) => /insert into inventory_movements/i.test(c.sql),
    );
    expect(wroteMovement).toBe(false);
  });

  it('GET movements : variant du tenant B → 404, pas de lecture movements', async () => {
    seedTenant(db, { ownsVariant: false });
    const res = await handleListMovements(
      env(db), AUTH_A, VARIANT_OF_B, new URL('https://x/m'),
    );
    expect(res.status).toBe(404);
    const readMovements = db.calls.some(
      (c) => /select \* from inventory_movements/i.test(c.sql),
    );
    expect(readMovements).toBe(false);
  });
});

describe('multi-tenant inventory — non-régression (tenant légitime passe)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('GET inventory : variant du tenant A → 200 (aucune sur-restriction)', async () => {
    seedTenant(db, { ownsVariant: true });
    const res = await handleGetInventory(env(db), AUTH_A, VARIANT_OF_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { variant_id: string } };
    expect(body.data.variant_id).toBe(VARIANT_OF_A);

    // Le gate a bien filtré par client_id (chaîne products.client_id).
    const gate = db.calls.find((c) => /from product_variants v/i.test(c.sql));
    expect(gate?.args).toContain(CLIENT_A);
  });

  it('POST adjust : variant du tenant A → 200 + mouvement tracé', async () => {
    seedTenant(db, { ownsVariant: true });
    const req = new Request('https://x/adjust', {
      method: 'POST', body: JSON.stringify({ delta: 3, reason: 'restock' }),
    });
    const res = await handleAdjustInventory(req, env(db), AUTH_A, VARIANT_OF_A);
    expect(res.status).toBe(200);
    const wroteMovement = db.calls.some(
      (c) => /insert into inventory_movements/i.test(c.sql),
    );
    expect(wroteMovement).toBe(true);
  });
});

describe('multi-tenant inventory — helpers stock exposés (défense en profondeur)', () => {
  let db: MockD1;
  beforeEach(() => {
    db = createMockD1();
  });

  it('reserveStock refuse si clientId fourni ne possède PAS la variante', async () => {
    db.seed('from product_variants v', []); // variant pas au tenant
    const r = await reserveStock(env(db) as never, VARIANT_OF_B, 2, {
      clientId: CLIENT_B, type: 'order', id: 'o1',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('tenant_mismatch');
    // Aucune écriture inventory (refus AVANT ensureInventory).
    const wrote = db.calls.some((c) => /update inventory|insert .*inventory/i.test(c.sql));
    expect(wrote).toBe(false);
  });

  it('commitSale rétro-compat : sans clientId, comportement inchangé (passe)', async () => {
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-1', variant_id: VARIANT_OF_A, quantity: 10, reserved: 2,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);
    const r = await commitSale(env(db) as never, VARIANT_OF_A, 1, {
      type: 'order', id: 'o1',
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('reserveStock passe quand clientId fourni POSSÈDE la variante', async () => {
    db.seed('from product_variants v', [
      { variant_id: VARIANT_OF_A, sku: 'S', product_id: 'p', product_title: 'T' },
    ]);
    db.seed('from inventory where variant_id', [
      {
        id: 'inv-1', variant_id: VARIANT_OF_A, quantity: 10, reserved: 0,
        low_stock_threshold: 5, track_inventory: 1, allow_backorder: 0,
        location: null, updated_at: null, last_low_stock_alert_at: null,
      },
    ]);
    const r = await reserveStock(env(db) as never, VARIANT_OF_A, 2, {
      clientId: CLIENT_A,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});
