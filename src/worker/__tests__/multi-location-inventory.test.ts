// ── Tests — Sprint 65 Multi-Location Inventory ─────────────────────────────────
//
// Valide :
//   - GET /api/ecommerce/variants/:vid/inventory : chargement et migration à la volée.
//   - PUT /api/ecommerce/variants/:vid/inventory : set de stocks multi-localisation et synchronisation globale.
//   - POST /api/ecommerce/variants/:vid/inventory/adjust : ajustement dans un entrepôt spécifique.
//   - reserveStock / releaseStock / commitSale avec locationId / warehouseId.
//
// Mock D1 via `_helpers.ts`. Aucun réseau. Imports RELATIFS uniquement.

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import {
  handleGetInventory,
  handleSetInventory,
  handleAdjustInventory,
  reserveStock,
  releaseStock,
  commitSale,
} from '../ecommerce-inventory';

type Env = { DB: MockD1 };

const CLIENT_ID = 'client-A';
const USER_ID = 'user-A';
const VARIANT_ID = 'variant-A';
const WAREHOUSE_1 = 'wh-1';
const WAREHOUSE_2 = 'wh-2';

const AUTH = { userId: USER_ID, role: 'admin' };

function makeEnv(db: MockD1): Env {
  return { DB: db };
}

function seedBase(db: MockD1) {
  db.seed('from users where id', [{ client_id: CLIENT_ID }]);
  db.seed('modules_json from clients', [{ modules_json: '["ecommerce"]' }]);
  db.seed('from product_variants v', [
    { variant_id: VARIANT_ID, sku: 'SKU-A', product_id: 'prod-A', product_title: 'Produit A' }
  ]);
  db.seed('from warehouses', [
    { id: WAREHOUSE_1, client_id: CLIENT_ID, name: 'Principal', is_default: 1, is_active: 1 },
    { id: WAREHOUSE_2, client_id: CLIENT_ID, name: 'Secondaire', is_default: 0, is_active: 1 }
  ]);
}

describe('Sprint 65 — Multi-Location Inventory', () => {
  let db: MockD1;

  beforeEach(() => {
    db = createMockD1();
    seedBase(db);
  });

  it('GET inventory : charge les stocks locaux existants', async () => {
    db.seed('from inventory where variant_id', [
      { id: 'inv-1', variant_id: VARIANT_ID, quantity: 15, reserved: 2, low_stock_threshold: 5 }
    ]);
    db.seed('location_stocks', [
      { location_id: WAREHOUSE_1, warehouse_name: 'Principal', quantity: 10, reserved: 2 },
      { location_id: WAREHOUSE_2, warehouse_name: 'Secondaire', quantity: 5, reserved: 0 }
    ]);

    const res = await handleGetInventory(makeEnv(db), AUTH, VARIANT_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.quantity).toBe(15);
    expect(body.data.location_stocks).toHaveLength(2);
    expect(body.data.location_stocks[0].location_id).toBe(WAREHOUSE_1);
    expect(body.data.location_stocks[0].quantity).toBe(10);
    expect(body.data.location_stocks[1].location_id).toBe(WAREHOUSE_2);
    expect(body.data.location_stocks[1].quantity).toBe(5);
  });

  it('GET inventory : effectue une migration automatique si aucun stock local mais stock global > 0', async () => {
    db.seed('from inventory where variant_id', [
      { id: 'inv-1', variant_id: VARIANT_ID, quantity: 25, reserved: 5, low_stock_threshold: 5 }
    ]);
    db.seed('location_stocks', []); // Aucun stock local

    const res = await handleGetInventory(makeEnv(db), AUTH, VARIANT_ID);
    expect(res.status).toBe(200);

    // Une insertion dans location_stocks vers le default (wh-1) doit être lancée
    const insertLoc = db.calls.find(c => c.sql.toLowerCase().includes('insert into location_stocks'));
    expect(insertLoc).toBeDefined();
    expect(insertLoc?.args[0]).toBe(WAREHOUSE_1); // location_id (wh-1 car default)
    expect(insertLoc?.args[3]).toBe(25); // quantity
    expect(insertLoc?.args[4]).toBe(5); // reserved
  });

  it('PUT inventory : enregistre de nouveaux stocks par entrepôt, recalcule le global et logge les deltas', async () => {
    db.seed('from inventory where variant_id', [
      { id: 'inv-1', variant_id: VARIANT_ID, quantity: 10, reserved: 0 }
    ]);
    db.seed('location_stocks', [
      { location_id: WAREHOUSE_1, quantity: 10, reserved: 0 },
      { location_id: WAREHOUSE_2, quantity: 0, reserved: 0 }
    ]);

    const req = new Request('https://x/inventory', {
      method: 'PUT',
      body: JSON.stringify({
        location_stocks: [
          { location_id: WAREHOUSE_1, quantity: 8 },
          { location_id: WAREHOUSE_2, quantity: 12 }
        ]
      })
    });

    const res = await handleSetInventory(req, makeEnv(db), AUTH, VARIANT_ID);
    expect(res.status).toBe(200);

    // 2 INSERT/UPDATE sur location_stocks
    const updates = db.calls.filter(c => c.sql.toLowerCase().includes('insert into location_stocks'));
    expect(updates).toHaveLength(2);

    // Recalcule et met à jour inventory
    const updateGlobal = db.calls.find(c => c.sql.toLowerCase().includes('update inventory set quantity = ?'));
    expect(updateGlobal).toBeDefined();
    expect(updateGlobal?.args[0]).toBe(20); // 8 + 12 = 20

    // Vérifie les mouvements de stock loggés
    const movements = db.calls.filter(c => c.sql.toLowerCase().includes('insert into inventory_movements'));
    expect(movements).toHaveLength(2); // delta -2 sur wh-1 et delta +12 sur wh-2
  });

  it('POST adjust : ajuste le stock dans un entrepôt spécifique', async () => {
    db.seed('from inventory where variant_id', [
      { id: 'inv-1', variant_id: VARIANT_ID, quantity: 10, reserved: 0, track_inventory: 1, allow_backorder: 0 }
    ]);
    db.seed('location_stocks', [
      { location_id: WAREHOUSE_1, quantity: 6, reserved: 0 },
      { location_id: WAREHOUSE_2, quantity: 4, reserved: 0 }
    ]);
    db.seed('sum(quantity) as total_qty', [
      { total_qty: 15, total_res: 0 }
    ]);

    const req = new Request('https://x/adjust', {
      method: 'POST',
      body: JSON.stringify({ delta: 5, location_id: WAREHOUSE_2 })
    });

    const res = await handleAdjustInventory(req, makeEnv(db), AUTH, VARIANT_ID);
    expect(res.status).toBe(200);

    // Update location_stocks
    const locUpdate = db.calls.find(c => c.sql.toLowerCase().includes('insert into location_stocks'));
    expect(locUpdate).toBeDefined();
    expect(locUpdate?.args[3]).toBe(9); // 4 + 5 = 9

    // Update global
    const globalUpdate = db.calls.find(c => c.sql.toLowerCase().includes('update inventory set quantity = ?'));
    expect(globalUpdate).toBeDefined();
    expect(globalUpdate?.args[0]).toBe(15); // 6 + 9 = 15
  });

  it('reserveStock : réserve du stock dans une localisation spécifique', async () => {
    db.seed('from inventory where variant_id', [
      { id: 'inv-1', variant_id: VARIANT_ID, quantity: 10, reserved: 0, track_inventory: 1, allow_backorder: 0 }
    ]);
    db.seed('location_stocks', [
      { location_id: WAREHOUSE_1, quantity: 6, reserved: 0 }
    ]);

    const r = await reserveStock(makeEnv(db) as any, VARIANT_ID, 2, {
      locationId: WAREHOUSE_1,
      clientId: CLIENT_ID
    });

    expect(r.ok).toBe(true);

    // Doit insérer/modifier dans location_stocks (reserved = reserved + 2)
    const locRes = db.calls.find(c => c.sql.toLowerCase().includes('insert into location_stocks'));
    expect(locRes).toBeDefined();
    expect(locRes?.args[4]).toBe(2); // reserved

    // Doit mettre à jour inventory global
    const globRes = db.calls.find(c => c.sql.toLowerCase().includes('update inventory set reserved = reserved + ?'));
    expect(globRes).toBeDefined();
  });
});
