// ════════════════════════════════════════════════════════════════════════════
// Sprint 38 — Gift cards cron : handleRunGiftCardExpiryCron (Agent C3)
// ════════════════════════════════════════════════════════════════════════════
//
// Source : gift-cards.ts (Agent A3 — handleRunGiftCardExpiryCron ~:585).
//
// Comportement OBSERVABLE testé (status + body + effets D1 via db.calls).
//
// ⚠ LIMITE MOCK D1 (figée _helpers.ts) : pas d'UNIQUE / FK / .changes ; .run()
// renvoie toujours {changes:1}. On prouve la LOGIQUE APPLICATIVE :
//   - sélection cartes échues (status='active' + expires_at IS NOT NULL + <now)
//   - UPDATE par carte (status='expired', balance=0)
//   - INSERT ledger gift_card_transactions (type='expire', amount=-remaining)
//   - best-effort : si UPDATE d'une carte throw, on continue avec les suivantes
//   - capability 'clients.manage' obligatoire (403 sinon)

import { describe, it, expect } from 'vitest';
import { handleRunGiftCardExpiryCron } from '../gift-cards';
import { createMockD1, type MockD1, type MockStatement } from './_helpers';
import { ecomEnv } from './_ecommerce-fixtures';

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

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}

// ════════════════════════════════════════════════════════════════════════════
// Cas 1 — rien à expirer
// ════════════════════════════════════════════════════════════════════════════

describe('handleRunGiftCardExpiryCron — A3', () => {
  it("rien à expirer : SELECT vide → expired_count=0, aucun UPDATE/INSERT", async () => {
    const db = createMockD1();
    // Pas de seed sur "from gift_cards" + "status = 'active'" → SELECT vide.

    const req = new Request('https://x/api/gift-cards/cron/expire', {
      method: 'POST',
    });
    const res = await handleRunGiftCardExpiryCron(
      req,
      ecomEnv(db) as never,
      makeAuth(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { expired_count?: number } };
    expect(body.data?.expired_count).toBe(0);

    // Aucun UPDATE gift_cards ni INSERT gift_card_transactions ne doit
    // avoir été tenté (boucle vide).
    expect(hasCall(db, /update gift_cards\s+set\s+status\s*=\s*'expired'/i)).toBe(
      false,
    );
    expect(
      hasCall(db, /insert\s+into\s+gift_card_transactions/i),
    ).toBe(false);
  });

  it('expire 3 cartes : 3 UPDATE status + 3 INSERT type=expire (montants -100/-200/-50)', async () => {
    const db = createMockD1();

    // Cibles : seed sur "from gift_cards" — SQL contient
    // "FROM gift_cards WHERE status = 'active' AND expires_at IS NOT NULL ...".
    db.seed("from gift_cards\n       where status = 'active'", [
      { id: 'gc-1', client_id: 'client-A', current_balance_cents: 100 },
      { id: 'gc-2', client_id: 'client-A', current_balance_cents: 200 },
      { id: 'gc-3', client_id: 'client-B', current_balance_cents: 50 },
    ]);

    const req = new Request('https://x/api/gift-cards/cron/expire', {
      method: 'POST',
    });
    const res = await handleRunGiftCardExpiryCron(
      req,
      ecomEnv(db) as never,
      makeAuth(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { expired_count?: number } };
    expect(body.data?.expired_count).toBe(3);

    // 3 UPDATE gift_cards SET status='expired'.
    expect(countCalls(db, /update gift_cards\s+set\s+status\s*=\s*'expired'/i)).toBe(
      3,
    );
    // 3 INSERT gift_card_transactions.
    const inserts = db.calls.filter((c) =>
      /insert\s+into\s+gift_card_transactions/i.test(c.sql),
    );
    expect(inserts.length).toBe(3);
    // Chaque INSERT a 'expire' littéral dans le SQL.
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/'expire'/i);
    }

    // amounts négatifs : -100, -200, -50 (en cents, restant débité).
    const insertedAmounts = inserts
      .map((ins) => ins.args.find((a) => typeof a === 'number' && a < 0))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(insertedAmounts).toEqual([-200, -100, -50]);

    // Chaque UPDATE doit cibler le tenant correct (id, client_id en bindings).
    const updates = db.calls.filter((c) =>
      /update gift_cards\s+set\s+status\s*=\s*'expired'/i.test(c.sql),
    );
    const targetedCards = updates
      .map((u) => u.args.find((a) => typeof a === 'string' && a.startsWith('gc-')))
      .sort();
    expect(targetedCards).toEqual(['gc-1', 'gc-2', 'gc-3']);
  });

  it("best-effort par row : si UPDATE 2ème carte throw, on continue (expired_count=2)", async () => {
    // ── Mock D1 custom qui throw sur la 2ème occurrence de UPDATE gift_cards ──
    const seeds: Array<{ needle: string; rows: unknown[] }> = [
      {
        needle: "from gift_cards\n       where status = 'active'".toLowerCase(),
        rows: [
          { id: 'gc-1', client_id: 'client-A', current_balance_cents: 100 },
          { id: 'gc-2', client_id: 'client-A', current_balance_cents: 200 },
          { id: 'gc-3', client_id: 'client-A', current_balance_cents: 50 },
        ],
      },
    ];
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    let updateCount = 0;

    function resolveRows(sql: string): unknown[] {
      const lower = sql.toLowerCase();
      for (const s of seeds) {
        if (lower.includes(s.needle)) return s.rows;
      }
      return [];
    }

    const db: MockD1 = {
      calls,
      defaultRows: [],
      seed() {
        /* not used here — seeds injected via closure */
      },
      prepare(sql: string): MockStatement {
        let boundArgs: unknown[] = [];
        const stmt: MockStatement = {
          bind(...args: unknown[]) {
            boundArgs = args;
            return stmt;
          },
          all() {
            calls.push({ sql, args: boundArgs });
            return { results: resolveRows(sql) };
          },
          first() {
            calls.push({ sql, args: boundArgs });
            const r = resolveRows(sql);
            return r.length ? r[0] : null;
          },
          run() {
            calls.push({ sql, args: boundArgs });
            // Intercepte UPDATE gift_cards SET status='expired' → throw sur 2ème occurrence.
            if (/update gift_cards\s+set\s+status\s*=\s*'expired'/i.test(sql)) {
              updateCount++;
              if (updateCount === 2) {
                throw new Error('Simulated D1 failure on 2nd card UPDATE');
              }
            }
            return { success: true, meta: { changes: 1, last_row_id: 1 } };
          },
        };
        return stmt;
      },
    };

    const req = new Request('https://x/api/gift-cards/cron/expire', {
      method: 'POST',
    });
    const res = await handleRunGiftCardExpiryCron(
      req,
      ecomEnv(db) as never,
      makeAuth(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { expired_count?: number } };
    // gc-1 OK + gc-2 FAIL (catch silently) + gc-3 OK = 2 expirées.
    expect(body.data?.expired_count).toBe(2);

    // 3 UPDATE tentés (le 2ème a throw mais a bien été appelé).
    expect(countCalls(db, /update gift_cards\s+set\s+status\s*=\s*'expired'/i)).toBe(
      3,
    );
    // Seuls les INSERTs des cartes réussies sont effectués (2 — pas 3).
    expect(countCalls(db, /insert\s+into\s+gift_card_transactions/i)).toBe(2);
  });

  it('403 si capability "clients.manage" manquante', async () => {
    const db = createMockD1();
    db.seed("from gift_cards\n       where status = 'active'", [
      { id: 'gc-1', client_id: 'client-A', current_balance_cents: 100 },
    ]);

    const req = new Request('https://x/api/gift-cards/cron/expire', {
      method: 'POST',
    });
    const res = await handleRunGiftCardExpiryCron(
      req,
      ecomEnv(db) as never,
      makeAuth([]),
    );

    expect(res.status).toBe(403);
    // Court-circuit cap → aucun SELECT, UPDATE ou INSERT.
    expect(hasCall(db, /from gift_cards/i)).toBe(false);
    expect(hasCall(db, /update gift_cards/i)).toBe(false);
    expect(hasCall(db, /insert\s+into\s+gift_card_transactions/i)).toBe(false);
  });
});
