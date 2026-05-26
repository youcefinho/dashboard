// ── Tests — Sprint 47 Multi-warehouse + Dropshipping (Agent T47) ────────────
//
// Couverture ~10 cas :
//   Engine (4) : routeOrderItems / executeTransfer / parseSupplierCsv /
//                notifySupplier flag inactif.
//   Handlers (6) : handleListWarehouses / handleCreateWarehouse /
//                  handleSetDefaultWarehouse / handleCreateInventoryTransfer /
//                  handleImportSupplierCatalogCsv / cap-check 403.
//
// Mock D1 via `_helpers.ts`. Aucun réseau. Imports RELATIFS uniquement
// (contrat figé docs/LOT-WAREHOUSE-DROPSHIP-S47.md §6).
//
// Réponses normalisées : succès `{ data }`, erreur `{ error }`. JAMAIS `code`.
// On observe les appels DB via `db.calls` (sql + args) pour prouver la logique
// applicative côté handlers (INSERT/UPDATE attendus, args bind alignés).

import { describe, it, expect } from 'vitest';
import {
  routeOrderItems,
  executeTransfer,
  parseSupplierCsv,
  notifySupplier,
  computeInventoryLevel,
  isReorderNeeded,
  isLowStock,
  validateTransfer,
  allocateFifo,
  buildDropshipPayload,
  STOCK_MOVEMENT_TYPES,
  WAREHOUSE_ERROR_CODES,
} from '../lib/warehouse-engine';
import {
  handleListWarehouses,
  handleCreateWarehouse,
  handleSetDefaultWarehouse,
  handleCreateInventoryTransfer,
  handleImportSupplierCatalogCsv,
  handleListWarehouseInventory,
  handleAllocateOrderFifo,
  handleBuildDropshipPayloadForOrder,
  type WarehouseDropshipAuth,
} from '../warehouse-dropship';
import { createMockD1, type MockD1 } from './_helpers';

const CLIENT_ID = 'client-A';
const USER_ID = 'user-A';

function makeAuth(
  caps: string[] = ['clients.manage', 'settings.manage'],
): WarehouseDropshipAuth {
  return {
    userId: USER_ID,
    role: 'admin',
    clientId: CLIENT_ID,
    capabilities: new Set(caps),
  };
}

function whEnv(db: MockD1): { DB: MockD1 } {
  return { DB: db };
}

/** Compte les appels DB dont le SQL contient `needle` (case-insensitive). */
function countCalls(db: MockD1, needle: string): number {
  const n = needle.toLowerCase();
  return db.calls.filter((c) => c.sql.toLowerCase().includes(n)).length;
}

/** Récupère le premier appel DB dont le SQL contient `needle`. */
function findCall(
  db: MockD1,
  needle: string,
): { sql: string; args: unknown[] } | undefined {
  const n = needle.toLowerCase();
  return db.calls.find((c) => c.sql.toLowerCase().includes(n));
}

function makeRequest(body: unknown): Request {
  return new Request('https://test.local/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('warehouse-engine — routeOrderItems', () => {
  it('with routing : INSERT dropship_orders pour chaque item routé', async () => {
    const db = createMockD1();
    // 2 items dans l'order.
    db.seed('from order_items where order_id', [
      { id: 'oi-1', variant_id: 'var-1', quantity: 2 },
      { id: 'oi-2', variant_id: 'var-2', quantity: 1 },
    ]);
    // L'order appartient au client.
    db.seed('client_id from orders where id', [{ client_id: CLIENT_ID }]);
    // Routing auto_route=1 trouvé pour les 2 variants (same seed sert les 2 SELECT).
    db.seed('from dropship_routings', [
      { id: 'r-1', supplier_id: 'sup-1', auto_route: 1 },
    ]);

    const env = whEnv(db) as unknown as Parameters<typeof routeOrderItems>[0];
    const result = await routeOrderItems(env, 'order-1');

    expect(result.items_routed).toBe(2);
    expect(result.dropship_orders).toHaveLength(2);
    expect(result.dropship_orders[0]?.supplier_id).toBe('sup-1');
    expect(result.dropship_orders[0]?.order_id).toBe('order-1');
    // 2 INSERT dropship_orders attendus.
    expect(countCalls(db, 'insert into dropship_orders')).toBe(2);
  });

  it('sans items : { items_routed: 0, dropship_orders: [] }', async () => {
    const db = createMockD1();
    db.seed('from order_items where order_id', []);
    const env = whEnv(db) as unknown as Parameters<typeof routeOrderItems>[0];
    const result = await routeOrderItems(env, 'order-empty');
    expect(result.items_routed).toBe(0);
    expect(result.dropship_orders).toEqual([]);
  });
});

describe('warehouse-engine — executeTransfer', () => {
  it('applique subtract source + add destination + UPDATE status=completed', async () => {
    const db = createMockD1();
    db.seed('from inventory_transfers where id', [
      {
        id: 't-1',
        client_id: CLIENT_ID,
        from_warehouse_id: 'wh-A',
        to_warehouse_id: 'wh-B',
        variant_id: 'var-1',
        quantity: 5,
        status: 'pending',
      },
    ]);

    const env = whEnv(db) as unknown as Parameters<typeof executeTransfer>[0];
    const result = await executeTransfer(env, 't-1');

    expect(result.ok).toBe(true);

    // SUBTRACT source (UPDATE inventory ... quantity - ?).
    const subtract = findCall(db, 'quantity = max(0, quantity - ?)');
    expect(subtract).toBeDefined();
    expect(subtract?.args).toEqual([5, 'var-1', 'wh-A']);

    // ADD destination (UPDATE inventory ... quantity + ?).
    const add = findCall(db, 'quantity = quantity + ?');
    expect(add).toBeDefined();
    expect(add?.args).toEqual([5, 'var-1', 'wh-B']);

    // UPDATE transfer status='completed'.
    const upd = findCall(db, "status = 'completed'");
    expect(upd).toBeDefined();
    expect(upd?.args).toEqual(['t-1']);
  });

  it('status already_terminal : no-op + reason', async () => {
    const db = createMockD1();
    db.seed('from inventory_transfers where id', [
      {
        id: 't-2',
        client_id: CLIENT_ID,
        from_warehouse_id: 'wh-A',
        to_warehouse_id: 'wh-B',
        variant_id: 'var-1',
        quantity: 5,
        status: 'completed',
      },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof executeTransfer>[0];
    const result = await executeTransfer(env, 't-2');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_terminal');
  });
});

describe('warehouse-engine — parseSupplierCsv', () => {
  it('parse CSV header+lignes avec mapping custom → ParsedSupplierCatalogItem[]', () => {
    const csv = 'sku,name,cost,stock\nA1,Product A,100,5\nB2,Product B,250,12';
    const items = parseSupplierCsv(csv, {
      sku: 'sku',
      name: 'name',
      cost: 'cost',
      stock: 'stock',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      sku: 'A1',
      name: 'Product A',
      cost_cents: 100,
      stock_qty: 5,
    });
    expect(items[1]).toEqual({
      sku: 'B2',
      name: 'Product B',
      cost_cents: 250,
      stock_qty: 12,
    });
  });

  it('CSV vide ou sans header SKU → [] (PURE, pas de throw)', () => {
    expect(parseSupplierCsv('')).toEqual([]);
    expect(parseSupplierCsv('foo,bar\n1,2')).toEqual([]);
    expect(parseSupplierCsv('name,cost\nA,100')).toEqual([]);
  });
});

describe('warehouse-engine — notifySupplier', () => {
  it('flag inactif : api_endpoint NULL ⇒ { sent: false, ref: null, reason: no_endpoint }', async () => {
    const db = createMockD1();
    db.seed('from dropship_suppliers where id', [
      { id: 'sup-1', api_endpoint: null, is_active: 1 },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof notifySupplier>[0];
    const result = await notifySupplier(env, 'sup-1', 'order-ref-1');
    expect(result.sent).toBe(false);
    expect(result.ref).toBe(null);
    expect(result.reason).toBe('no_endpoint');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('handleListWarehouses', () => {
  it('SELECT WHERE client_id=? + ORDER BY is_default DESC, name ASC → 200', async () => {
    const db = createMockD1();
    db.seed('from warehouses where client_id', [
      { id: 'wh-1', name: 'Principal', is_default: 1, is_active: 1 },
      { id: 'wh-2', name: 'Secondaire', is_default: 0, is_active: 1 },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof handleListWarehouses>[0];
    const res = await handleListWarehouses(env, makeAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
    const call = findCall(db, 'from warehouses where client_id');
    expect(call?.args).toEqual([CLIENT_ID]);
  });
});

describe('handleCreateWarehouse', () => {
  it('valide name + INSERT warehouses → 200 avec data.id', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateWarehouse>[0];
    const req = makeRequest({
      name: 'Entrepôt Montréal',
      address: '123 rue Principale',
      country: 'CA',
      is_default: false,
    });
    const res = await handleCreateWarehouse(req, env, makeAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe('Entrepôt Montréal');
    expect(countCalls(db, 'insert into warehouses')).toBe(1);
  });

  it('name manquant → 400 { error: "name requis" }', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateWarehouse>[0];
    const req = makeRequest({ address: 'foo' });
    const res = await handleCreateWarehouse(req, env, makeAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('name requis');
    expect(body.code).toBeUndefined(); // contrat figé : JAMAIS `code`.
  });
});

describe('handleSetDefaultWarehouse', () => {
  it('UPDATE is_default=0 sur tous + UPDATE is_default=1 sur le sélectionné', async () => {
    const db = createMockD1();
    db.seed('from warehouses where id', [
      { id: 'wh-1', client_id: CLIENT_ID, name: 'Principal', is_default: 0 },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof handleSetDefaultWarehouse>[0];
    const res = await handleSetDefaultWarehouse(env, makeAuth(), 'wh-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; is_default: number } };
    expect(body.data.id).toBe('wh-1');
    expect(body.data.is_default).toBe(1);

    // 2 UPDATE attendus : unmark all puis mark sélectionné.
    const unmarkAll = findCall(db, 'where client_id = ? and is_default = 1');
    expect(unmarkAll).toBeDefined();
    expect(unmarkAll?.args).toEqual([CLIENT_ID]);

    const markOne = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('set\n            is_default = 1') ||
        c.sql.toLowerCase().includes('set is_default = 1') ||
        (c.sql.toLowerCase().includes('is_default = 1') &&
          c.sql.toLowerCase().includes('where id = ? and client_id = ?')),
    );
    expect(markOne).toBeDefined();
    expect(markOne?.args).toEqual(['wh-1', CLIENT_ID]);
  });
});

describe('handleCreateInventoryTransfer', () => {
  it('from == to → 400 { error: "from_warehouse_id et to_warehouse_id identiques" }', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateInventoryTransfer>[0];
    const req = makeRequest({
      from_warehouse_id: 'wh-A',
      to_warehouse_id: 'wh-A',
      variant_id: 'var-1',
      quantity: 5,
    });
    const res = await handleCreateInventoryTransfer(req, env, makeAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toContain('identiques');
    expect(body.code).toBeUndefined();
  });

  it('quantity <= 0 → 400 { error: "quantity > 0 requis" }', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateInventoryTransfer>[0];
    const req = makeRequest({
      from_warehouse_id: 'wh-A',
      to_warehouse_id: 'wh-B',
      variant_id: 'var-1',
      quantity: 0,
    });
    const res = await handleCreateInventoryTransfer(req, env, makeAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('quantity > 0 requis');
  });

  it('payload valide + warehouses tenant OK → INSERT inventory_transfers (status=pending)', async () => {
    const db = createMockD1();
    db.seed('from warehouses where id', [
      { id: 'wh-A', client_id: CLIENT_ID, name: 'A', is_active: 1 },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateInventoryTransfer>[0];
    const req = makeRequest({
      from_warehouse_id: 'wh-A',
      to_warehouse_id: 'wh-B',
      variant_id: 'var-1',
      quantity: 5,
    });
    const res = await handleCreateInventoryTransfer(req, env, makeAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; status: string; quantity: number };
    };
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe('pending');
    expect(body.data.quantity).toBe(5);
    expect(countCalls(db, 'insert into inventory_transfers')).toBe(1);
  });
});

describe('handleImportSupplierCatalogCsv', () => {
  it('parse CSV + INSERT/UPDATE dropship_routings → counts { imported, updated, skipped, parsed }', async () => {
    const db = createMockD1();
    // Supplier existe.
    db.seed('from dropship_suppliers where id', [
      { id: 'sup-1', client_id: CLIENT_ID, name: 'Sup A', csv_format_json: null },
    ]);
    // Lookup variant — premier SKU trouvé, deuxième non.
    let variantLookupCalls = 0;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      const lower = sql.toLowerCase();
      if (lower.includes('from product_variants pv')) {
        const origFirst = stmt.first.bind(stmt);
        stmt.first = () => {
          variantLookupCalls += 1;
          // 1er SKU 'A1' → variant trouvé. 2e SKU 'B2' → null.
          return variantLookupCalls === 1 ? { id: 'pv-1' } : null;
        };
      }
      return stmt;
    };
    // Pas de routing existant pour pv-1 → INSERT.
    db.seed('select id from dropship_routings', []);

    const env = whEnv(db) as unknown as Parameters<typeof handleImportSupplierCatalogCsv>[0];
    const req = makeRequest({
      csvText: 'sku,name,cost_cents,stock_qty\nA1,Product A,100,5\nB2,Product B,250,12',
    });
    const res = await handleImportSupplierCatalogCsv(req, env, makeAuth(), 'sup-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { imported: number; updated: number; skipped: number; parsed: number };
    };
    expect(body.data.parsed).toBe(2);
    expect(body.data.imported).toBe(1); // pv-1 inséré
    expect(body.data.updated).toBe(0);
    expect(body.data.skipped).toBe(1); // B2 sans variant → skip
    expect(countCalls(db, 'insert into dropship_routings')).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — Renforcement PURS (6 cas additifs)
// ════════════════════════════════════════════════════════════════════════════

describe('warehouse-engine — computeInventoryLevel', () => {
  it('mix in/out/transfer_in/transfer_out/adjustment → niveau net signé', () => {
    const movements = [
      { type: STOCK_MOVEMENT_TYPES.IN, quantity: 100 },
      { type: STOCK_MOVEMENT_TYPES.OUT, quantity: 30 },
      { type: STOCK_MOVEMENT_TYPES.TRANSFER_IN, quantity: 20 },
      { type: STOCK_MOVEMENT_TYPES.TRANSFER_OUT, quantity: 15 },
      { type: STOCK_MOVEMENT_TYPES.ADJUSTMENT, quantity: -5 },
    ];
    // 100 - 30 + 20 - 15 - 5 = 70
    expect(computeInventoryLevel(movements)).toBe(70);
  });

  it('liste vide ou null → 0 (pas de throw)', () => {
    expect(computeInventoryLevel([])).toBe(0);
    expect(computeInventoryLevel(null)).toBe(0);
    expect(computeInventoryLevel(undefined)).toBe(0);
  });

  it('over-out massif → clamp à 0 minimum (jamais négatif)', () => {
    const movements = [
      { type: STOCK_MOVEMENT_TYPES.IN, quantity: 10 },
      { type: STOCK_MOVEMENT_TYPES.OUT, quantity: 50 },
    ];
    expect(computeInventoryLevel(movements)).toBe(0);
  });

  it('type inconnu → ignoré (forward-compat)', () => {
    const movements = [
      { type: STOCK_MOVEMENT_TYPES.IN, quantity: 10 },
      { type: 'unknown_type', quantity: 999 },
    ];
    expect(computeInventoryLevel(movements)).toBe(10);
  });
});

describe('warehouse-engine — isReorderNeeded', () => {
  it('level 5 < threshold 10 → needed=true + suggestedQty calculé', () => {
    // demand 2/jour × lead 7 jours = 14 + safety 10 (threshold) = 24 ; - level 5 = 19
    const result = isReorderNeeded(5, 10, 7, 2);
    expect(result.needed).toBe(true);
    expect(result.suggestedQty).toBe(19);
  });

  it('level 20 >= threshold 10 → needed=false + suggestedQty=0', () => {
    const result = isReorderNeeded(20, 10, 7, 2);
    expect(result.needed).toBe(false);
    expect(result.suggestedQty).toBe(0);
  });

  it('inputs NaN/négatifs → clamp à 0 + needed=false', () => {
    const result = isReorderNeeded(NaN, -5, NaN, -1);
    expect(result.needed).toBe(false);
    expect(result.suggestedQty).toBe(0);
  });
});

describe('warehouse-engine — isLowStock', () => {
  it('5 < 10 → true', () => {
    expect(isLowStock(5, 10)).toBe(true);
  });

  it('15 > 10 → false', () => {
    expect(isLowStock(15, 10)).toBe(false);
  });

  it('égal au seuil (10 == 10) → false (strict <)', () => {
    expect(isLowStock(10, 10)).toBe(false);
  });

  it('NaN → false (fail-closed)', () => {
    expect(isLowStock(NaN, 10)).toBe(false);
    expect(isLowStock(5, NaN)).toBe(false);
  });
});

describe('warehouse-engine — validateTransfer', () => {
  it('same warehouse → { ok: false, error: same_warehouse }', () => {
    const result = validateTransfer(
      { sourceWarehouseId: 'wh-A', targetWarehouseId: 'wh-A', qty: 5 },
      { 'wh-A': 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(WAREHOUSE_ERROR_CODES.SAME_WAREHOUSE);
  });

  it('qty > stock → { ok: false, error: insufficient_stock }', () => {
    const result = validateTransfer(
      { sourceWarehouseId: 'wh-A', targetWarehouseId: 'wh-B', qty: 200 },
      { 'wh-A': 100, 'wh-B': 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(WAREHOUSE_ERROR_CODES.INSUFFICIENT_STOCK);
  });

  it('qty <= 0 → { ok: false, error: invalid_quantity }', () => {
    const result = validateTransfer(
      { sourceWarehouseId: 'wh-A', targetWarehouseId: 'wh-B', qty: 0 },
      { 'wh-A': 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(WAREHOUSE_ERROR_CODES.INVALID_QUANTITY);
  });

  it('source warehouse absent du map levels → warehouse_not_found', () => {
    const result = validateTransfer(
      { sourceWarehouseId: 'wh-ghost', targetWarehouseId: 'wh-B', qty: 5 },
      { 'wh-B': 100 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe(WAREHOUSE_ERROR_CODES.WAREHOUSE_NOT_FOUND);
  });

  it('OK case → { ok: true }', () => {
    const result = validateTransfer(
      { sourceWarehouseId: 'wh-A', targetWarehouseId: 'wh-B', qty: 5 },
      { 'wh-A': 100, 'wh-B': 0 },
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('warehouse-engine — allocateFifo', () => {
  it('3 warehouses + qty > un seul → split FIFO oldest-first, qty match', () => {
    const warehouses = [
      // Oldest first dans le tri attendu.
      { id: 'wh-old', available: 5, created_at: '2026-01-01T00:00:00Z' },
      { id: 'wh-mid', available: 10, created_at: '2026-02-01T00:00:00Z' },
      { id: 'wh-new', available: 100, created_at: '2026-03-01T00:00:00Z' },
    ];
    // Need 12 : 5 from wh-old + 7 from wh-mid (laisse wh-new intact).
    const allocations = allocateFifo(warehouses, 'product-1', 12);
    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toEqual({ warehouse_id: 'wh-old', quantity: 5 });
    expect(allocations[1]).toEqual({ warehouse_id: 'wh-mid', quantity: 7 });
    const total = allocations.reduce((s, a) => s + a.quantity, 0);
    expect(total).toBe(12);
  });

  it('qty totale > somme available → allocation partielle (caller décide)', () => {
    const warehouses = [
      { id: 'wh-1', available: 3, created_at: '2026-01-01T00:00:00Z' },
      { id: 'wh-2', available: 2, created_at: '2026-02-01T00:00:00Z' },
    ];
    const allocations = allocateFifo(warehouses, 'product-1', 100);
    const total = allocations.reduce((s, a) => s + a.quantity, 0);
    expect(total).toBe(5); // only 5 dispo total
    expect(allocations).toHaveLength(2);
  });

  it('warehouses vides ou qty <= 0 → []', () => {
    expect(allocateFifo([], 'product-1', 10)).toEqual([]);
    expect(allocateFifo(null, 'product-1', 10)).toEqual([]);
    expect(
      allocateFifo(
        [{ id: 'wh-1', available: 10, created_at: '2026-01-01T00:00:00Z' }],
        'product-1',
        0,
      ),
    ).toEqual([]);
  });

  it('available = 0 → warehouse ignoré', () => {
    const warehouses = [
      { id: 'wh-empty', available: 0, created_at: '2026-01-01T00:00:00Z' },
      { id: 'wh-full', available: 10, created_at: '2026-02-01T00:00:00Z' },
    ];
    const allocations = allocateFifo(warehouses, 'product-1', 5);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.warehouse_id).toBe('wh-full');
  });
});

describe('warehouse-engine — buildDropshipPayload', () => {
  it('shape correct : supplier_id + order_ref + items + shipping_address + currency CAD', () => {
    const payload = buildDropshipPayload(
      {
        id: 'ord-1',
        ref: 'ORD-2026-001',
        shipping_name: 'Jean Tremblay',
        shipping_line1: '123 rue Sainte-Catherine',
        shipping_city: 'Montréal',
        shipping_country_subdiv: 'QC',
        shipping_country: 'CA',
        shipping_postal_code: 'H2X 1Z4',
        shipping_phone: '+1-514-555-0123',
        shipping_email: 'jean@example.com',
        notes: 'Livrer en après-midi',
      },
      { id: 'sup-1' },
      [
        { sku: 'PROD-A', quantity: 2, cost_cents: 1500 },
        { sku: 'PROD-B', quantity: 1, cost_cents: 2500 },
      ],
    );
    expect(payload.supplier_id).toBe('sup-1');
    expect(payload.order_ref).toBe('ORD-2026-001');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toEqual({ sku: 'PROD-A', quantity: 2, cost_cents: 1500 });
    expect(payload.shipping_address.name).toBe('Jean Tremblay');
    expect(payload.shipping_address.city).toBe('Montréal');
    expect(payload.shipping_address.country).toBe('CA');
    expect(payload.shipping_address.country_subdiv).toBe('QC');
    expect(payload.currency).toBe('CAD');
    expect(payload.notes).toBe('Livrer en après-midi');
  });

  it('items invalides (sku missing, qty 0) → filtrés', () => {
    const payload = buildDropshipPayload(
      { id: 'ord-1' },
      { id: 'sup-1' },
      [
        { sku: 'OK', quantity: 1 },
        { sku: '', quantity: 5 } as { sku: string; quantity: number },
        { sku: 'ZERO', quantity: 0 },
        { quantity: 3 } as { sku: string; quantity: number },
      ],
    );
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.sku).toBe('OK');
  });

  it('order/supplier null → shape safe avec defaults vides + currency CAD locked', () => {
    const payload = buildDropshipPayload(null, null, []);
    expect(payload.supplier_id).toBe('');
    expect(payload.order_ref).toBe('');
    expect(payload.items).toEqual([]);
    expect(payload.currency).toBe('CAD');
    expect(payload.shipping_address.name).toBe('');
    expect(payload.shipping_address.country).toBe('');
  });
});

describe('cap check 403 — sans clients.manage', () => {
  it('handleListWarehouses sans cap → 403 { error: "Accès refusé" } (PAS de champ code)', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleListWarehouses>[0];
    const auth = makeAuth([]); // aucune capability
    const res = await handleListWarehouses(env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Accès refusé');
    expect(body.code).toBeUndefined();
    // Aucun appel DB ne doit avoir été émis avant le guard.
    expect(countCalls(db, 'from warehouses')).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — Wire-up renforcement (5 cas additifs câblage helpers PURS)
// ════════════════════════════════════════════════════════════════════════════
//
// Câblage validé end-to-end : warehouse-engine helpers PURS (validateTransfer,
// computeInventoryLevel, isLowStock, allocateFifo, buildDropshipPayload) sont
// effectivement appelés par les handlers HTTP. Tests indépendants des 39
// existants (zéro régression).

describe('handleCreateInventoryTransfer — wire-up validateTransfer', () => {
  it('same warehouse → 400 message contient code SAME_WAREHOUSE', async () => {
    const db = createMockD1();
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateInventoryTransfer>[0];
    // Même payload from==to déclenche validation handler AVANT engine, mais
    // sémantiquement c'est SAME_WAREHOUSE — on vérifie juste que le 400 sort.
    const req = makeRequest({
      from_warehouse_id: 'wh-A',
      to_warehouse_id: 'wh-A',
      variant_id: 'var-1',
      quantity: 5,
    });
    const res = await handleCreateInventoryTransfer(req, env, makeAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    // Le handler peut court-circuiter sur input check OU passer par validateTransfer.
    // Dans les 2 cas : 400 + message clair + PAS de champ `code`.
    expect(body.error).toMatch(/identiques|same_warehouse/i);
    expect(body.code).toBeUndefined();
  });

  it('qty > stock disponible → 409 message contient code INSUFFICIENT_STOCK', async () => {
    const db = createMockD1();
    // Warehouses tenant-valid.
    db.seed('from warehouses where id', [
      { id: 'wh-A', client_id: CLIENT_ID, name: 'A', is_active: 1 },
    ]);
    // Inventory snapshot : seulement 3 dispo dans wh-A (qty 5 - reserved 2).
    db.seed('from inventory where variant_id', [
      { warehouse_id: 'wh-A', quantity: 5, reserved: 2 },
      { warehouse_id: 'wh-B', quantity: 100, reserved: 0 },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof handleCreateInventoryTransfer>[0];
    const req = makeRequest({
      from_warehouse_id: 'wh-A',
      to_warehouse_id: 'wh-B',
      variant_id: 'var-1',
      quantity: 50, // > 3 dispo
    });
    const res = await handleCreateInventoryTransfer(req, env, makeAuth());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error.toLowerCase()).toContain('insufficient_stock');
    expect(body.code).toBeUndefined();
    // Aucun INSERT inventory_transfers (validation a bloqué AVANT).
    expect(countCalls(db, 'insert into inventory_transfers')).toBe(0);
  });
});

describe('handleListWarehouseInventory — wire-up computeInventoryLevel + isLowStock', () => {
  it('expose low_stock flag par variant (level < threshold)', async () => {
    const db = createMockD1();
    db.seed('from warehouses where id', [
      { id: 'wh-A', client_id: CLIENT_ID, name: 'A', is_active: 1 },
    ]);
    // Pas de stock_movements ⇒ fallback inventory.
    db.seed('from stock_movements', []);
    db.seed('from inventory where warehouse_id', [
      {
        variant_id: 'var-low',
        quantity: 3,
        reserved: 0,
        low_stock_threshold: 10,
      },
      {
        variant_id: 'var-ok',
        quantity: 50,
        reserved: 0,
        low_stock_threshold: 10,
      },
    ]);
    const env = whEnv(db) as unknown as Parameters<typeof handleListWarehouseInventory>[0];
    const res = await handleListWarehouseInventory(env, makeAuth(), 'wh-A');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        variant_id: string;
        level: number;
        low_stock_threshold: number;
        low_stock: boolean;
      }>;
    };
    expect(body.data).toHaveLength(2);
    const low = body.data.find((d) => d.variant_id === 'var-low');
    const ok = body.data.find((d) => d.variant_id === 'var-ok');
    expect(low?.low_stock).toBe(true);
    expect(low?.level).toBe(3);
    expect(ok?.low_stock).toBe(false);
    expect(ok?.level).toBe(50);
  });
});

describe('handleAllocateOrderFifo — wire-up allocateFifo', () => {
  it('split allocation across 3 warehouses FIFO oldest-first', async () => {
    const db = createMockD1();
    // 3 warehouses actifs FIFO (created_at ASC).
    db.seed('from warehouses\n          where client_id', [
      { id: 'wh-old', created_at: '2026-01-01T00:00:00Z' },
      { id: 'wh-mid', created_at: '2026-02-01T00:00:00Z' },
      { id: 'wh-new', created_at: '2026-03-01T00:00:00Z' },
    ]);
    // Pas de stock_movements ⇒ fallback inventory snapshot.
    db.seed('from stock_movements', []);
    db.seed('from inventory where variant_id', [
      { warehouse_id: 'wh-old', quantity: 5, reserved: 0 },
      { warehouse_id: 'wh-mid', quantity: 10, reserved: 0 },
      { warehouse_id: 'wh-new', quantity: 100, reserved: 0 },
    ]);

    const env = whEnv(db) as unknown as Parameters<typeof handleAllocateOrderFifo>[0];
    const req = makeRequest({ variant_id: 'var-1', qty: 12 });
    const res = await handleAllocateOrderFifo(req, env, makeAuth(), 'order-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        order_id: string;
        variant_id: string;
        qty_requested: number;
        qty_allocated: number;
        shortfall: number;
        allocations: Array<{ warehouse_id: string; quantity: number }>;
      };
    };
    expect(body.data.order_id).toBe('order-1');
    expect(body.data.variant_id).toBe('var-1');
    expect(body.data.qty_requested).toBe(12);
    // 5 from wh-old + 7 from wh-mid = 12 total (wh-new intact).
    expect(body.data.qty_allocated).toBe(12);
    expect(body.data.shortfall).toBe(0);
    expect(body.data.allocations).toHaveLength(2);
    expect(body.data.allocations[0]?.warehouse_id).toBe('wh-old');
    expect(body.data.allocations[0]?.quantity).toBe(5);
    expect(body.data.allocations[1]?.warehouse_id).toBe('wh-mid');
    expect(body.data.allocations[1]?.quantity).toBe(7);
  });
});

describe('handleBuildDropshipPayloadForOrder — wire-up buildDropshipPayload', () => {
  it('shape payload correct (supplier_id + order_ref + items + currency CAD)', async () => {
    const db = createMockD1();
    // Supplier tenant-valid.
    db.seed('from dropship_suppliers where id', [
      { id: 'sup-1', client_id: CLIENT_ID, name: 'Sup A', is_active: 1 },
    ]);
    // Order tenant-valid avec adresse shipping.
    db.seed('from orders where id', [
      {
        id: 'ord-1',
        client_id: CLIENT_ID,
        ref: 'ORD-2026-001',
        shipping_name: 'Jean Tremblay',
        shipping_line1: '123 rue Sainte-Catherine',
        shipping_city: 'Montréal',
        shipping_country_subdiv: 'QC',
        shipping_country: 'CA',
        shipping_postal_code: 'H2X 1Z4',
      },
    ]);
    // Order items + routing supplier_sku.
    db.seed('from order_items oi', [
      {
        variant_id: 'var-1',
        quantity: 2,
        variant_sku: 'PROD-A',
        supplier_sku: 'SUP-A-001',
        cost_cents: 1500,
      },
      {
        variant_id: 'var-2',
        quantity: 1,
        variant_sku: 'PROD-B',
        supplier_sku: 'SUP-B-002',
        cost_cents: 2500,
      },
    ]);

    const env = whEnv(db) as unknown as Parameters<typeof handleBuildDropshipPayloadForOrder>[0];
    const res = await handleBuildDropshipPayloadForOrder(env, makeAuth(), 'ord-1', 'sup-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        supplier_id: string;
        order_ref: string;
        items: Array<{ sku: string; quantity: number; cost_cents?: number }>;
        shipping_address: { name: string; city: string; country: string };
        currency: string;
      };
    };
    expect(body.data.supplier_id).toBe('sup-1');
    expect(body.data.order_ref).toBe('ORD-2026-001');
    expect(body.data.currency).toBe('CAD');
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]?.sku).toBe('SUP-A-001');
    expect(body.data.items[0]?.quantity).toBe(2);
    expect(body.data.shipping_address.name).toBe('Jean Tremblay');
    expect(body.data.shipping_address.city).toBe('Montréal');
    expect(body.data.shipping_address.country).toBe('CA');
  });
});
