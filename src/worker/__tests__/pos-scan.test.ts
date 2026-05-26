// ── POS scan + create transaction handler tests — Sprint 37 (2026-05-24) ───-
//
// Tests vitest des handlers AUTHED `handleScanBarcode` + `handleCreatePosTransaction`
// (Agent A4 — `src/worker/pos-transactions.ts`).
//
// Couvre les 6 cas figés du contrat Sprint 37 :
//   1. handleScanBarcode 200 sur barcode valide
//   2. handleScanBarcode 404 sur barcode inconnu
//   3. handleScanBarcode 404 cross-tenant (IDOR defense-in-depth)
//   4. handleCreatePosTransaction 409 session non-open
//   5. handleCreatePosTransaction succès cash + change correct
//   6. handleCreatePosTransaction 400 insufficient tender cash + INSERT jamais appelé
//
// Mocks D1 sur env.DB.prepare + mocks des deps `createOrderCore`/`commitOrderSale`
// (réutilise le helper `_helpers.createMockD1` existant — pattern figé S2/S3).
// Aucun réseau, aucun I/O réel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (avant import du SUT) ─────────────────────────────────-

vi.mock('../ecommerce-orders', () => ({
  createOrderCore: vi.fn(),
  commitOrderSale: vi.fn(),
}));

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async (_env: any, _userId: string) => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../lib/pos-receipt', () => ({
  buildReceiptPdfStub: vi.fn(async () => new Uint8Array([0x25, 0x50])),
  uploadReceiptToR2: vi.fn(async () => null),
}));

// Import du SUT APRÈS les mocks (vi.mock est hoisté mais sécurité).
import {
  handleScanBarcode,
  handleCreatePosTransaction,
} from '../pos-transactions';
import { createOrderCore, commitOrderSale } from '../ecommerce-orders';
import { getClientModules } from '../modules';

// ── helpers locaux ─────────────────────────────────────────────────────────-

function makeAuth(overrides: Partial<{ userId: string; capabilities: Set<string> }> = {}) {
  return {
    userId: 'u_cashier_1',
    role: 'admin',
    clientId: 'cli_A',
    // Bypass `resolveCapabilities` en fournissant le Set directement.
    capabilities: new Set(['clients.manage']),
    ...overrides,
  } as any;
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-définir getClientModules par défaut (clearAllMocks reset les impl).
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: 'cli_A',
    modules: [] as any,
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. handleScanBarcode — 200 sur barcode valide
// ═══════════════════════════════════════════════════════════════════════════

describe('handleScanBarcode', () => {
  it('retourne 200 + unit_price_cents === 1500 sur barcode valide', async () => {
    const db = createMockD1();
    db.seed('from product_variants', [
      {
        variant_id: 'v1',
        product_id: 'p1',
        sku: 'SKU-1',
        barcode: '1234567890',
        price_cents: 1500,
        variant_title: 'Small',
        product_title: 'Test Product',
        in_stock: 10,
        base_price: 1500,
      },
    ]);
    const env = makeEnv(db);
    const res = await handleScanBarcode(env, makeAuth(), '1234567890');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.unit_price_cents).toBe(1500);
    expect(body.data.variant.id).toBe('v1');
    expect(body.data.variant.barcode).toBe('1234567890');
    expect(body.data.in_stock).toBe(10);
    // Vérifie que le bind contient bien le barcode + clientId pour bornage tenant.
    const scanCall = db.calls.find((c) => c.sql.toLowerCase().includes('from product_variants'));
    expect(scanCall?.args).toEqual(['1234567890', 'cli_A']);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. handleScanBarcode — 404 barcode inconnu
  // ═══════════════════════════════════════════════════════════════════════════

  it('retourne 404 barcode_not_found si lookup vide', async () => {
    const db = createMockD1();
    // Aucun seed → defaultRows = [] → first() retourne null.
    const env = makeEnv(db);
    const res = await handleScanBarcode(env, makeAuth(), '9999999999');
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('barcode_not_found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. handleScanBarcode — 404 cross-tenant (IDOR defense-in-depth)
  // ═══════════════════════════════════════════════════════════════════════════

  it('retourne 404 cross-tenant : barcode existe pour cli_B mais auth=cli_A', async () => {
    // Sémantique : le WHERE `p.client_id = ?` filtre côté SQL. Le mock D1
    // simule ce filtre en ne seedant PAS de ligne (la prepared statement
    // recevrait bien `cli_A` en bind mais le row n'existe que pour `cli_B`).
    const db = createMockD1();
    // Pas de seed pour 'from product_variants' → résultat vide.
    const env = makeEnv(db);
    const res = await handleScanBarcode(env, makeAuth(), '1234567890');
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe('barcode_not_found');
    // Confirme que le bind contient bien cli_A (bornage tenant strict).
    const scanCall = db.calls.find((c) => c.sql.toLowerCase().includes('from product_variants'));
    expect(scanCall?.args).toContain('cli_A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. handleCreatePosTransaction — session non-open → 409
// ═══════════════════════════════════════════════════════════════════════════

describe('handleCreatePosTransaction', () => {
  it('retourne 409 session_not_open si pos_sessions vide (ou status closed)', async () => {
    const db = createMockD1();
    // Aucun seed pour 'from pos_sessions' → first() retourne null → 409.
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        session_id: 'sess1',
        cart: [{ variant_id: 'v1', quantity: 1 }],
        payment: { method: 'cash', tendered_cents: 2000 },
      }),
    });
    const res = await handleCreatePosTransaction(req, env, auth);
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe('session_not_open');
    // createOrderCore NE DOIT PAS être invoqué si la session est fermée.
    expect(createOrderCore).not.toHaveBeenCalled();
    expect(commitOrderSale).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. handleCreatePosTransaction — succès cash + change_due_cents = 851
  // ═══════════════════════════════════════════════════════════════════════════

  it('200 cash success : change_due_cents = 851 + INSERT pos_transactions appelé', async () => {
    const db = createMockD1();
    db.seed('from pos_sessions', [
      {
        id: 'sess1',
        status: 'open',
        client_id: 'cli_A',
        register_id: 'reg1',
      },
    ]);
    db.seed('from pos_registers', [
      { id: 'reg1', name: 'Caisse 1', default_tax_region: 'qc' },
    ]);
    // Pour le bloc reçu best-effort (peut échouer silencieusement).
    db.seed('from clients', [{ name: 'Boutique Test' }]);
    db.seed('from order_items', []);

    vi.mocked(createOrderCore).mockResolvedValueOnce({
      id: 'ord_x',
      order_number: 'ON-1',
      subtotal_cents: 1000,
      tps_cents: 50,
      tvq_cents: 99,
      total_cents: 1149,
    } as any);
    vi.mocked(commitOrderSale).mockResolvedValueOnce(undefined as any);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        session_id: 'sess1',
        cart: [{ variant_id: 'v1', quantity: 1 }],
        payment: { method: 'cash', tendered_cents: 2000 },
      }),
    });
    const res = await handleCreatePosTransaction(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.change_due_cents).toBe(851); // 2000 - 1149
    expect(body.data.order_id).toBe('ord_x');
    expect(body.data.order_number).toBe('ON-1');
    expect(body.data.totals.total_cents).toBe(1149);

    // commitOrderSale doit avoir été invoqué (concrétisation vente).
    expect(commitOrderSale).toHaveBeenCalledTimes(1);

    // INSERT pos_transactions doit avoir été appelé.
    const insertTx = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into pos_transactions'),
    );
    expect(insertTx).toBeDefined();
    // Le bind doit contenir : tx_id, sessionId, clientId, orderId, method, total, tendered, change, ref, cashier.
    expect(insertTx?.args).toContain('sess1');
    expect(insertTx?.args).toContain('cli_A');
    expect(insertTx?.args).toContain('ord_x');
    expect(insertTx?.args).toContain('cash');
    expect(insertTx?.args).toContain(1149); // amount_cents
    expect(insertTx?.args).toContain(2000); // tendered_cents
    expect(insertTx?.args).toContain(851);  // change_due_cents
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. handleCreatePosTransaction — insufficient tender cash → 400 + JAMAIS INSERT
  // ═══════════════════════════════════════════════════════════════════════════

  it('400 insufficient_tender si tendered_cents=500 < total=1149 + INSERT jamais appelé', async () => {
    const db = createMockD1();
    db.seed('from pos_sessions', [
      {
        id: 'sess1',
        status: 'open',
        client_id: 'cli_A',
        register_id: 'reg1',
      },
    ]);
    db.seed('from pos_registers', [
      { id: 'reg1', name: 'Caisse 1', default_tax_region: 'qc' },
    ]);

    vi.mocked(createOrderCore).mockResolvedValueOnce({
      id: 'ord_x',
      order_number: 'ON-2',
      subtotal_cents: 1000,
      tps_cents: 50,
      tvq_cents: 99,
      total_cents: 1149,
    } as any);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        session_id: 'sess1',
        cart: [{ variant_id: 'v1', quantity: 1 }],
        payment: { method: 'cash', tendered_cents: 500 },
      }),
    });
    const res = await handleCreatePosTransaction(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('insufficient_tender');

    // commitOrderSale NE DOIT PAS être appelé (validation paiement échoue
    // avant le commit).
    expect(commitOrderSale).not.toHaveBeenCalled();

    // INSERT pos_transactions JAMAIS appelé (court-circuit avant écriture).
    const insertTx = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into pos_transactions'),
    );
    expect(insertTx).toBeUndefined();
  });
});
