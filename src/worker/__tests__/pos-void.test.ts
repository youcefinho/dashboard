// ════════════════════════════════════════════════════════════════════════════
// Sprint S37 — POS handleVoidPosTransaction : gardes + cascade (Agent C3)
// ════════════════════════════════════════════════════════════════════════════
//
// Comportement OBSERVABLE testé (status + body + effets D1 via db.calls).
// Source de vérité = pos-transactions.ts (handleVoidPosTransaction ~:509).
//
// ⚠️ LIMITE MOCK D1 (figée S2, _helpers.ts) : pas d'UNIQUE/FK/INSERT OR IGNORE,
// .run() renvoie toujours {changes:1}. On prouve la LOGIQUE APPLICATIVE :
//   - guard 404 (transaction_not_found),
//   - guard 409 (already_voided),
//   - guard 403 (capability manquante — requireCapability),
//   - cascade cash sans order_id (UPDATE pos_transactions + UPDATE pos_sessions),
//   - cascade avec order_id (refund + restock + UPDATE pos_sessions).

import { describe, it, expect } from 'vitest';
import { handleVoidPosTransaction } from '../pos-transactions';
import {
  ecomEnv,
  seedTenant,
  createMockD1,
  type MockD1,
} from './_ecommerce-fixtures';

const CLIENT = 'client-A';
const TX_ID = 'tx-1';
const SESSION_ID = 's1';

type Auth = {
  userId: string;
  role: string;
  capabilities?: Set<string>;
};

function makeAuth(caps: string[] = ['clients.manage']): Auth {
  return {
    userId: 'user-A',
    role: 'admin',
    capabilities: new Set(caps),
  };
}

function voidReq(body: Record<string, unknown> = { reason: 'mistake' }): Request {
  return new Request(`https://x/api/pos/transactions/${TX_ID}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}

// ════════════════════════════════════════════════════════════════════════════
// C3.1 — 404 si transaction introuvable
// ════════════════════════════════════════════════════════════════════════════

describe('handleVoidPosTransaction — guards', () => {
  it('404 si tx pas trouvée (SELECT pos_transactions retourne null)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    // Pas de seed 'from pos_transactions' → first() retourne null.
    const res = await handleVoidPosTransaction(
      voidReq(),
      ecomEnv(db) as never,
      makeAuth(),
      TX_ID,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('transaction_not_found');
    // Aucun UPDATE pos_transactions ne doit être tenté.
    expect(hasCall(db, /update pos_transactions/i)).toBe(false);
  });

  it('409 si tx déjà voided (voided_at non-null)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    db.seed('from pos_transactions', [
      {
        id: TX_ID,
        session_id: SESSION_ID,
        order_id: null,
        amount_cents: 1000,
        payment_method: 'cash',
        voided_at: '2026-05-24T00:00:00Z',
      },
    ]);
    const res = await handleVoidPosTransaction(
      voidReq(),
      ecomEnv(db) as never,
      makeAuth(),
      TX_ID,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('already_voided');
    // Idempotent : ne ré-écrit pas voided_at.
    expect(hasCall(db, /update pos_transactions\s+set\s+voided_at/i)).toBe(false);
  });

  it('403 si capability "clients.manage" manquante', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    const res = await handleVoidPosTransaction(
      voidReq(),
      ecomEnv(db) as never,
      makeAuth([]), // Set vide → requireCapability renvoie 403
      TX_ID,
    );
    expect(res.status).toBe(403);
    // Aucune lecture pos_transactions : court-circuit en amont.
    expect(hasCall(db, /from pos_transactions/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C3.2 — Cascade cash sans order_id
// ════════════════════════════════════════════════════════════════════════════

describe('handleVoidPosTransaction — cascade', () => {
  it('cash sans order_id : UPDATE pos_transactions + UPDATE pos_sessions (pas de refund)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    db.seed('from pos_transactions', [
      {
        id: TX_ID,
        session_id: SESSION_ID,
        order_id: null,
        amount_cents: 1000,
        payment_method: 'cash',
        voided_at: null,
      },
    ]);

    const res = await handleVoidPosTransaction(
      voidReq({ reason: 'mistake' }),
      ecomEnv(db) as never,
      makeAuth(),
      TX_ID,
    );
    expect(res.status).toBe(200);

    // ── Mark as voided ─────────────────────────────────────────────────────
    const voidUpdate = db.calls.find((c) =>
      /update pos_transactions\s+set\s+voided_at/i.test(c.sql),
    );
    expect(voidUpdate).toBeTruthy();
    // bind order : voided_by, void_reason, id, client_id
    expect(voidUpdate!.args).toContain('user-A');
    expect(voidUpdate!.args).toContain('mistake');
    expect(voidUpdate!.args).toContain(TX_ID);
    expect(voidUpdate!.args).toContain(CLIENT);

    // ── Décrément agrégats session ─────────────────────────────────────────
    const sessionUpdate = db.calls.find((c) =>
      /update pos_sessions\s+set\s+total_sales_cents\s*=\s*total_sales_cents\s*-/i.test(
        c.sql,
      ),
    );
    expect(sessionUpdate).toBeTruthy();
    expect(sessionUpdate!.args).toContain(1000); // amount décrémenté
    expect(sessionUpdate!.args).toContain(SESSION_ID);
    expect(sessionUpdate!.args).toContain(CLIENT);

    // ── Pas de refund (pas d'order_id) ─────────────────────────────────────
    expect(hasCall(db, /insert\s+(or\s+ignore\s+)?into\s+refunds/i)).toBe(false);
    // Pas de restock non plus.
    expect(hasCall(db, /update inventory\s+set\s+quantity/i)).toBe(false);
    expect(hasCall(db, /insert into inventory_movements/i)).toBe(false);

    const body = (await res.json()) as { data?: { refund_id: string | null } };
    expect(body.data?.refund_id).toBeNull();
  });

  it('avec order_id : INSERT refunds + UPDATE inventory + INSERT inventory_movements + UPDATE pos_sessions', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    db.seed('from pos_transactions', [
      {
        id: TX_ID,
        session_id: SESSION_ID,
        order_id: 'ord_x',
        amount_cents: 1500,
        payment_method: 'cash',
        voided_at: null,
      },
    ]);
    // Seed payment pour activer la branche INSERT refunds.
    db.seed('from payments', [
      { id: 'pay-1', currency: 'CAD' },
    ]);
    // Seed order_items pour la boucle restock (needle court — mock D1 matche
    // par 1er sub-string : éviter overlap potentiel avec d'autres seeds).
    db.seed('order_items', [
      { id: 'oi-1', variant_id: 'v1', quantity: 2 },
    ]);

    const res = await handleVoidPosTransaction(
      voidReq({ reason: 'erreur caissier' }),
      ecomEnv(db) as never,
      makeAuth(),
      TX_ID,
    );
    expect(res.status).toBe(200);

    // ── Mark as voided ─────────────────────────────────────────────────────
    expect(hasCall(db, /update pos_transactions\s+set\s+voided_at/i)).toBe(true);

    // ── INSERT refunds (avec payment_id résolu) ────────────────────────────
    const refundInsert = db.calls.find((c) =>
      /insert\s+(or\s+ignore\s+)?into\s+refunds/i.test(c.sql),
    );
    expect(refundInsert).toBeTruthy();
    expect(refundInsert!.args).toContain('ord_x');
    expect(refundInsert!.args).toContain('pay-1');
    expect(refundInsert!.args).toContain(1500); // amount_cents
    expect(refundInsert!.args).toContain('CAD');

    // ── Restock : UPDATE inventory pour la ligne (variant_id, quantity) ────
    const invUpdate = db.calls.find((c) =>
      /update inventory\s+set\s+quantity\s*=\s*coalesce/i.test(c.sql),
    );
    expect(invUpdate).toBeTruthy();
    expect(invUpdate!.args).toContain(2);    // quantity
    expect(invUpdate!.args).toContain('v1'); // variant_id

    // ── INSERT inventory_movements reason='return' ─────────────────────────
    const movInsert = db.calls.find((c) =>
      /insert into inventory_movements/i.test(c.sql),
    );
    expect(movInsert).toBeTruthy();
    // Le SQL contient 'return' littéral (reason hard-coded).
    expect(movInsert!.sql).toMatch(/'return'/i);
    expect(movInsert!.args).toContain('v1');
    expect(movInsert!.args).toContain(2);
    expect(movInsert!.args).toContain(TX_ID); // reference_id

    // ── UPDATE pos_sessions décrément ──────────────────────────────────────
    const sessionUpdate = db.calls.find((c) =>
      /update pos_sessions\s+set\s+total_sales_cents\s*=\s*total_sales_cents\s*-/i.test(
        c.sql,
      ),
    );
    expect(sessionUpdate).toBeTruthy();
    expect(sessionUpdate!.args).toContain(1500);

    // ── Boucle items : 1 ligne seedée → 1 UPDATE inventory + 1 INSERT mvt ─
    expect(countCalls(db, /update inventory\s+set\s+quantity/i)).toBe(1);
    expect(countCalls(db, /insert into inventory_movements/i)).toBe(1);

    const body = (await res.json()) as { data?: { refund_id: string | null } };
    expect(typeof body.data?.refund_id).toBe('string');
  });
});
