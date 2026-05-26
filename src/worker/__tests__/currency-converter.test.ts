// ── Tests — Currency Converter (Sprint 39 — Agent C1) ─────────────────────
//
// Couvre la lib pure `convertCents` + le résolveur cache D1 `getRate` de
// `src/worker/lib/currency-converter.ts` (A1).
//
// Stratégie :
//   - `convertCents` : pure, aucun I/O → assertions directes.
//   - `getRate` : mock D1 ad-hoc local (le helper figé `_helpers.ts` n'a pas
//     `.batch()`, requis par le chemin (3) INSERT). Pattern calqué sur
//     provisioning.test.ts. Mock `global.fetch` pour zéro réseau réel.
//
// Six cas (cf. contrat C1) :
//   1. convertCents identity (rate ignoré si fromCur === toCur)
//   2. convertCents EUR→CAD multiplication
//   3. convertCents rate invalide (NaN) → 0
//   4. getRate cache fresh hit (fetch JAMAIS appelé)
//   5. getRate cache miss → fetch ECB + INSERT currency_rates
//   6. getRate identity from === to (source: 'identity')

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertCents, getRate } from '../lib/currency-converter';
import type { Env } from '../types';

// ── Mock D1 ad-hoc (avec `.batch()`) ──────────────────────────────────────
// Le helper figé `_helpers.ts` n'expose pas `.batch()` — pattern emprunté à
// provisioning.test.ts:5-43. On enregistre tous les SQL+binds pour assertions.

interface RecordedStmt {
  sql: string;
  args: any[];
}

interface MockDb {
  calls: RecordedStmt[];
  batchStmts: RecordedStmt[][];
  prepare: (sql: string) => any;
  batch: ReturnType<typeof vi.fn>;
  /** Programme la 1re row renvoyée par .first() pour un SELECT contenant `needle`. */
  seedFirst: (needle: string, row: any | null) => void;
}

function makeDb(): MockDb {
  const seeds: Array<{ needle: string; row: any | null }> = [];
  const calls: RecordedStmt[] = [];
  const batchStmts: RecordedStmt[][] = [];

  const db: MockDb = {
    calls,
    batchStmts,
    seedFirst(needle: string, row: any | null) {
      seeds.push({ needle: needle.toLowerCase(), row });
    },
    prepare(sql: string) {
      const rec: RecordedStmt = { sql, args: [] };
      const stmt: any = {
        _rec: rec,
        bind(...args: any[]) {
          rec.args = args;
          return stmt;
        },
        async first() {
          calls.push(rec);
          const lower = sql.toLowerCase();
          for (const s of seeds) {
            if (lower.includes(s.needle)) return s.row;
          }
          return null;
        },
        async all() {
          calls.push(rec);
          return { results: [] };
        },
        async run() {
          calls.push(rec);
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        },
      };
      return stmt;
    },
    batch: vi.fn(async (stmts: any[]) => {
      batchStmts.push(stmts.map((s) => ({ sql: s._rec.sql, args: s._rec.args })));
      return stmts.map(() => ({ success: true }));
    }),
  };

  return db;
}

function makeEnv(db: MockDb): Env {
  return { DB: db } as unknown as Env;
}

// ── convertCents (pure) ────────────────────────────────────────────────────

describe('convertCents', () => {
  it('identity : fromCur === toCur ⇒ retourne amountCents brut (rate ignoré)', () => {
    // Rate=1.5 ne doit JAMAIS être appliqué quand from===to (court-circuit).
    expect(convertCents(1000, 'CAD', 'CAD', 1.5)).toBe(1000);
  });

  it('EUR→CAD : 10000 cents × 1.5 ⇒ 15000 cents (Math.round, pas floor)', () => {
    expect(convertCents(10000, 'EUR', 'CAD', 1.5)).toBe(15000);
  });

  it('rate invalide (NaN) ⇒ retourne 0 (refus silencieux)', () => {
    expect(convertCents(1000, 'EUR', 'CAD', NaN)).toBe(0);
  });
});

// ── getRate (cache D1 + fetch ECB) ─────────────────────────────────────────

describe('getRate', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Réinitialiser fetch entre chaque test pour éviter fuite cross-it.
    globalThis.fetch = originalFetch;
  });

  it('cache D1 fresh <24h ⇒ hit servi sans appel fetch', async () => {
    const db = makeDb();
    const env = makeEnv(db);

    // Cache fresh : seed la première lookup (SELECT ... WHERE base/quote + fetched_at >...).
    db.seedFirst('from currency_rates', {
      rate: 1.5,
      source: 'ecb',
      fetched_at: '2026-05-24T00:00:00Z',
    });

    // Spy fetch : doit rester intact (jamais appelé).
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await getRate(env, 'EUR', 'CAD');

    expect(result.rate).toBe(1.5);
    expect(result.source).toBe('ecb');
    expect(result.fetched_at).toBe('2026-05-24T00:00:00Z');
    expect(fetchSpy).not.toHaveBeenCalled();
    // Une seule requête D1 (SELECT fresh), pas de fetch ni de fallback stale.
    expect(db.calls).toHaveLength(1);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('cache miss ⇒ fetch ECB + INSERT currency_rates pour chaque paire', async () => {
    const db = makeDb();
    const env = makeEnv(db);

    // Pas de seed → first() renvoie null sur la lookup cache.

    // Mock fetch : Frankfurter renvoie { rates: { CAD: 1.5 } } pour base=EUR.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { amount: 1, base: 'EUR', date: '2026-05-24', rates: { CAD: 1.5 } };
      },
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await getRate(env, 'EUR', 'CAD');

    expect(result.rate).toBe(1.5);
    expect(result.source).toBe('ecb');
    expect(typeof result.fetched_at).toBe('string');

    // fetch a bien été appelé (URL Frankfurter avec base=EUR).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('api.frankfurter.app/latest');
    expect(calledUrl).toContain('base=EUR');

    // batch() appelé avec ≥1 INSERT currency_rates (paire EUR→CAD).
    expect(db.batch).toHaveBeenCalledTimes(1);
    const batch = db.batchStmts[0];
    expect(batch.length).toBeGreaterThanOrEqual(1);
    const insert = batch.find((s) => /insert\s+into\s+currency_rates/i.test(s.sql));
    expect(insert).toBeDefined();
    // Bindings ordre : (from, quote, rate, fetchedAt) — cf. A1 §(3).
    expect(insert!.args[0]).toBe('EUR');
    expect(insert!.args[1]).toBe('CAD');
    expect(insert!.args[2]).toBe(1.5);
  });

  it('identity from === to ⇒ { rate: 1, source: \'identity\' } sans I/O', async () => {
    const db = makeDb();
    const env = makeEnv(db);

    // Sentinel : fetch ne doit jamais être appelé.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await getRate(env, 'CAD', 'CAD');

    expect(result.rate).toBe(1);
    expect(result.source).toBe('identity');
    expect(typeof result.fetched_at).toBe('string');
    // Aucune I/O (D1 ni fetch).
    expect(db.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });
});
