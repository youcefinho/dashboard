// ════════════════════════════════════════════════════════════════════════════
// Sprint 38 — Loyalty cron : expirePendingPoints + handleRunExpiryCron (C3)
// ════════════════════════════════════════════════════════════════════════════
//
// Comportement OBSERVABLE testé : valeur de retour + effets D1 via db.calls.
// Sources :
//   - lib/loyalty-engine.ts (Agent A2)        : expirePendingPoints, recomputeState
//   - loyalty.ts (Agent A4)                   : handleRunExpiryCron
//
// ⚠ LIMITE MOCK D1 (figée _helpers.ts) : pas d'UNIQUE / FK / .changes ; .run()
// renvoie toujours {changes:1}. On prouve la LOGIQUE APPLICATIVE :
//   - sélection earn expirables (filtre type='earn' + expires_at <= asOf + NOT IN)
//   - insertion compensatoire type='expire' avec points négatifs (1 par row)
//   - recomputeState appelé par customer impacté (capture SELECT balance + lifetime)
//   - idempotence rerun : NOT IN sous-requête → 0 nouvelle row
//   - itération multi-program (handleRunExpiryCron)
//   - capability 'settings.manage' obligatoire (403 sinon)

import { describe, it, expect } from 'vitest';
import {
  expirePendingPoints,
  recomputeState,
} from '../lib/loyalty-engine';
import { handleRunExpiryCron } from '../loyalty';
import { createMockD1, type MockD1 } from './_helpers';
import { seedTenant, ecomEnv } from './_ecommerce-fixtures';

const CLIENT = 'client-A';
const PROGRAM = 'prog-1';
const AS_OF = '2026-05-24T00:00:00Z';

type Auth = {
  userId: string;
  role: string;
  capabilities?: Set<string>;
};

function makeAuth(caps: string[] = ['settings.manage']): Auth {
  return {
    userId: 'user-A',
    role: 'admin',
    capabilities: new Set(caps),
  };
}

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}

// ════════════════════════════════════════════════════════════════════════════
// expirePendingPoints — engine direct (Agent A2)
// ════════════════════════════════════════════════════════════════════════════

describe('expirePendingPoints — engine A2', () => {
  it('rien à expirer : SELECT vide → expired=0, aucun INSERT', async () => {
    const db = createMockD1();
    // Pas de seed sur "and type = 'earn'" → results = [] (defaultRows).

    const result = await expirePendingPoints(
      db as unknown as D1Database,
      PROGRAM,
      AS_OF,
    );

    expect(result.ok).toBe(true);
    expect(result.expiredEntries).toBe(0);
    // Aucune INSERT loyalty_ledger ne doit être tentée.
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(false);
    // Aucun recomputeState (pas de customer touché).
    expect(hasCall(db, /from loyalty_customer_state/i)).toBe(false);
  });

  it('expire 3 entries : 3 INSERT type=expire négatifs + recomputeState par customer', async () => {
    const db = createMockD1();

    // 3 earn expirés — 2 customers distincts (cust-1 ×2, cust-2 ×1).
    db.seed("and type = 'earn'", [
      { id: 'led-A', client_id: CLIENT, customer_id: 'cust-1', points: 100 },
      { id: 'led-B', client_id: CLIENT, customer_id: 'cust-1', points: 200 },
      { id: 'led-C', client_id: CLIENT, customer_id: 'cust-2', points: 50 },
    ]);
    // recomputeState lit balance + lifetime + tier_thresholds_json + state.
    db.seed('as balance', [{ balance: -350 }]);
    db.seed('as lifetime', [{ lifetime: 0 }]);
    db.seed('tier_thresholds_json', [{ tier_thresholds_json: null }]);
    db.seed('from loyalty_customer_state', [
      { id: 'state-row', client_id: CLIENT, current_tier: 'bronze' },
    ]);

    const result = await expirePendingPoints(
      db as unknown as D1Database,
      PROGRAM,
      AS_OF,
    );

    expect(result.ok).toBe(true);
    expect(result.expiredEntries).toBe(3);

    // ── 3 INSERT loyalty_ledger compensatoires (type='expire') ──────────────
    const inserts = db.calls.filter((c) =>
      /insert\s+into\s+loyalty_ledger/i.test(c.sql),
    );
    expect(inserts.length).toBe(3);

    // Chaque INSERT a 'expire' littéral dans le SQL + amounts -100/-200/-50.
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/'expire'/i);
    }
    const insertedPoints = inserts
      .map((ins) => ins.args.find((a) => typeof a === 'number' && a < 0))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(insertedPoints).toEqual([-200, -100, -50]);

    // source_order_id pointe vers le ledger entry d'origine (traçabilité).
    const ledgerIds = inserts
      .map((ins) => ins.args.find((a) => typeof a === 'string' && a.startsWith('led-')))
      .sort();
    expect(ledgerIds).toEqual(['led-A', 'led-B', 'led-C']);

    // ── recomputeState appelé par customer impacté (Set → cust-1 + cust-2 = 2) ─
    // Chaque recomputeState fait 1 SELECT balance + 1 SELECT lifetime + 1 SELECT
    // program + 1 SELECT state + 1 UPDATE state.
    expect(countCalls(db, /as balance/i)).toBe(2);
    expect(countCalls(db, /as lifetime/i)).toBe(2);
    expect(countCalls(db, /update loyalty_customer_state/i)).toBe(2);
  });

  it('idempotence rerun : NOT IN sous-requête filtre les déjà expirées', async () => {
    const db = createMockD1();

    // Premier run : 2 earn expirables.
    db.seed("and type = 'earn'", [
      { id: 'led-A', client_id: CLIENT, customer_id: 'cust-1', points: 100 },
      { id: 'led-B', client_id: CLIENT, customer_id: 'cust-1', points: 50 },
    ]);
    db.seed('as balance', [{ balance: -150 }]);
    db.seed('as lifetime', [{ lifetime: 0 }]);
    db.seed('tier_thresholds_json', [{ tier_thresholds_json: null }]);
    db.seed('from loyalty_customer_state', [
      { id: 'state-1', client_id: CLIENT, current_tier: 'bronze' },
    ]);

    const r1 = await expirePendingPoints(
      db as unknown as D1Database,
      PROGRAM,
      AS_OF,
    );
    expect(r1.ok).toBe(true);
    expect(r1.expiredEntries).toBe(2);
    const insertsAfterRun1 = countCalls(db, /insert\s+into\s+loyalty_ledger/i);
    expect(insertsAfterRun1).toBe(2);

    // Vérifie que le SELECT contient bien le filtre NOT IN sous-requête sur
    // type='expire' (la sémantique d'idempotence — sans ce filtre, rerun
    // ré-expirerait les mêmes entries).
    const earnSelect = db.calls.find(
      (c) =>
        /from loyalty_ledger/i.test(c.sql) &&
        /and type = 'earn'/i.test(c.sql),
    );
    expect(earnSelect).toBeTruthy();
    expect(earnSelect!.sql).toMatch(/not\s+in/i);
    expect(earnSelect!.sql).toMatch(/type\s*=\s*'expire'/i);

    // ── Deuxième run : on simule l'effet du filtre NOT IN en seedant []
    //    (en prod réelle, les led-A/led-B seraient maintenant exclus par le
    //    NOT IN car des rows 'expire' avec source_order_id IN ('led-A','led-B')
    //    existent désormais).
    const db2 = createMockD1();
    // SELECT retourne [] (pas de seed sur "and type = 'earn'").
    const r2 = await expirePendingPoints(
      db2 as unknown as D1Database,
      PROGRAM,
      AS_OF,
    );
    expect(r2.ok).toBe(true);
    expect(r2.expiredEntries).toBe(0);
    // 0 nouvelle insertion sur 2ème run.
    expect(countCalls(db2, /insert\s+into\s+loyalty_ledger/i)).toBe(0);
  });

  it('recomputeState — agrégats balance + lifetime + UPDATE state', async () => {
    // Test ciblé sur l'helper exposé pour valider la chaîne SQL.
    const db = createMockD1();
    db.seed('as balance', [{ balance: 250 }]);
    db.seed('as lifetime', [{ lifetime: 500 }]);
    db.seed('tier_thresholds_json', [
      { tier_thresholds_json: '{"bronze":0,"silver":500}' },
    ]);
    db.seed('from loyalty_customer_state', [
      { id: 'state-X', client_id: CLIENT, current_tier: 'bronze' },
    ]);

    const r = await recomputeState(
      db as unknown as D1Database,
      PROGRAM,
      'cust-X',
    );
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(250);
    // lifetime 500 ≥ silver(500) → tier='silver'.
    expect(r.tier).toBe('silver');

    const updateState = db.calls.find((c) =>
      /update loyalty_customer_state/i.test(c.sql),
    );
    expect(updateState).toBeTruthy();
    // Args ordre : balance, lifetime, tier, tierChanged?1:0, now, now, stateId.
    expect(updateState!.args[0]).toBe(250);
    expect(updateState!.args[1]).toBe(500);
    expect(updateState!.args[2]).toBe('silver');
    expect(updateState!.args[6]).toBe('state-X');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// handleRunExpiryCron — handler HTTP (Agent A4)
// ════════════════════════════════════════════════════════════════════════════

describe('handleRunExpiryCron — handler A4', () => {
  it('itère tous les programmes du tenant (expirePendingPoints 1× par program)', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);
    // 2 programmes pour ce tenant.
    db.seed('select id from loyalty_programs', [
      { id: 'prog-1' },
      { id: 'prog-2' },
    ]);
    // Pour chacun, le SELECT earn expirables retourne 1 row.
    db.seed("and type = 'earn'", [
      { id: 'led-A', client_id: CLIENT, customer_id: 'cust-1', points: 75 },
    ]);
    // recomputeState dependencies (mêmes seeds pour les 2 programs — le mock
    // matche par sous-chaîne, donc 1ère ligne returned consistante).
    db.seed('as balance', [{ balance: 0 }]);
    db.seed('as lifetime', [{ lifetime: 0 }]);
    db.seed('tier_thresholds_json', [{ tier_thresholds_json: null }]);
    db.seed('from loyalty_customer_state', [
      { id: 'state-row', client_id: CLIENT, current_tier: 'bronze' },
    ]);

    const req = new Request('https://x/api/loyalty/cron/expire-points', {
      method: 'POST',
    });
    const res = await handleRunExpiryCron(req, ecomEnv(db) as never, makeAuth());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { expired_count?: number; programs_processed?: number };
    };
    // Chaque programme expire 1 entry → total 2.
    expect(body.data?.expired_count).toBe(2);
    expect(body.data?.programs_processed).toBe(2);

    // 2 INSERT compensatoires (1 par program).
    expect(countCalls(db, /insert\s+into\s+loyalty_ledger/i)).toBe(2);
    // SELECT loyalty_programs WHERE client_id appelé 1 fois (au scan initial).
    expect(countCalls(db, /select id from loyalty_programs/i)).toBe(1);
  });

  it('403 si capability "settings.manage" manquante', async () => {
    const db = createMockD1();
    seedTenant(db, CLIENT);

    const req = new Request('https://x/api/loyalty/cron/expire-points', {
      method: 'POST',
    });
    const res = await handleRunExpiryCron(req, ecomEnv(db) as never, makeAuth([]));

    expect(res.status).toBe(403);
    // Court-circuit cap → aucun SELECT loyalty_programs.
    expect(hasCall(db, /select id from loyalty_programs/i)).toBe(false);
    // Aucune INSERT expire.
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(false);
  });
});
