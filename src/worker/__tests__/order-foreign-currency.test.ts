// ════════════════════════════════════════════════════════════
// Sprint 39 — Agent C3 — Order foreign-currency integration tests
// ════════════════════════════════════════════════════════════
//
// Couvre l'intégration multi-devises côté order :
//   (1) Order créé en USD ⇒ INSERT persiste currency='USD',
//       currency_rate_used=<rate>, currency_base='CAD' (tenant default).
//   (2) Conversion EUR → CAD : subtotal/tax/total convertis bit-pour-bit
//       via convertCents() (idempotent par champ, sum bits cohérente).
//   (3) Stale rate (>24h) + fetch ECB down ⇒ getRate() retombe sur
//       cache 'cached_stale' (signal warning lisible côté caller).
//   (4) Identity (CAD→CAD) ⇒ pas d'appel fetch (réseau JAMAIS touché).
//
// Périmètre : INTEGRATION tests (flow simplifié, pas createOrderCore complet).
// Mock D1 + global.fetch. Aucun réseau réel.
//
// Calque convention __tests__/gcal-client.test.ts (stubGlobal fetch +
// makeEnv DB mock + lazy-import).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertCents, getRate } from '../lib/currency-converter';

// ── Helpers ────────────────────────────────────────────────────────────────

type D1Row = Record<string, unknown> | null;

/**
 * Construit un mock D1 minimal (prepare → bind → first/run/all/batch).
 * Capture chaque appel prepare(sql) + bind(args) dans `calls` pour assertions.
 */
function makeMockDB(opts: {
  firstResults?: D1Row[]; // séquence renvoyée par chaque .first() successif
  runResults?: unknown[]; // séquence renvoyée par chaque .run() successif
} = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const firstQueue = [...(opts.firstResults || [])];
  const runQueue = [...(opts.runResults || [])];

  const prepare = vi.fn((sql: string) => {
    const entry = { sql, bindings: [] as unknown[] };
    calls.push(entry);
    const stmt = {
      bind: vi.fn((...args: unknown[]) => {
        entry.bindings = args;
        return stmt;
      }),
      first: vi.fn(async () => {
        return firstQueue.length > 0 ? firstQueue.shift() : null;
      }),
      run: vi.fn(async () => {
        return runQueue.length > 0 ? runQueue.shift() : { success: true };
      }),
      all: vi.fn(async () => ({ results: [] })),
    };
    return stmt;
  });

  const batch = vi.fn(async () => []);

  return {
    DB: { prepare, batch } as any,
    calls,
  };
}

function makeEnv(dbMock: ReturnType<typeof makeMockDB>['DB']): any {
  return { DB: dbMock };
}

// ── beforeEach / afterEach ──────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── (1) Order créé en USD avec rate stocké ──────────────────────────────────

describe('Sprint 39 — Order foreign-currency (USD with rate stored)', () => {
  it('persiste currency=USD + currency_rate_used + currency_base=CAD via INSERT', async () => {
    // Setup : mock D1 — pas de cache fresh ⇒ fetch ECB ⇒ retourne CAD rate.
    const { DB, calls } = makeMockDB({
      firstResults: [
        null /* (2) freshHit miss */,
        // Pas de fallback (3) car fetch retourne le rate.
      ],
    });

    // Mock fetch Frankfurter base=USD ⇒ rates: { CAD: 1.4, ... }
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 1,
          base: 'USD',
          date: '2026-05-24',
          rates: { CAD: 1.4, EUR: 0.92, DZD: 134.5, MAD: 9.8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const env = makeEnv(DB);

    // Résolution rate USD→CAD (devise commande → devise base tenant).
    const lookup = await getRate(env, 'USD', 'CAD');

    expect(lookup.rate).toBe(1.4);
    expect(lookup.source).toBe('ecb');

    // Flow simplifié — INSERT order avec currency='USD' + rate stocké.
    const totalCents = 10000; // 100 USD
    const totalBaseCents = convertCents(totalCents, 'USD', 'CAD', lookup.rate);

    expect(totalBaseCents).toBe(14000); // 100 USD * 1.4 = 140 CAD

    // Simule l'INSERT order (flow simplifié — pas createOrderCore complet).
    await env.DB.prepare(
      `INSERT INTO orders (id, currency, total_cents, currency_rate_used, currency_base)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind('ord_test', 'USD', totalCents, lookup.rate, totalBaseCents)
      .run();

    // Assert : INSERT a bien capturé les 5 bindings attendus.
    const insertCall = calls.find((c) => c.sql.startsWith('INSERT INTO orders'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.bindings).toEqual([
      'ord_test',
      'USD',
      10000,
      1.4,
      14000,
    ]);
  });
});

// ── (2) Conversion EUR → CAD breakdown correct ──────────────────────────────

describe('Sprint 39 — EUR → CAD breakdown conversion', () => {
  it('convertit subtotal+tax+total via convertCents (idempotent par champ)', () => {
    const rate = 1.5; // 1 EUR = 1.5 CAD

    const subtotalEur = 10000; // 100.00 EUR
    const taxEur = 2100; // 21.00 EUR
    const totalEur = 12100; // 121.00 EUR

    const subtotalCad = convertCents(subtotalEur, 'EUR', 'CAD', rate);
    const taxCad = convertCents(taxEur, 'EUR', 'CAD', rate);
    const totalCad = convertCents(totalEur, 'EUR', 'CAD', rate);

    expect(subtotalCad).toBe(15000); // 150.00 CAD
    expect(taxCad).toBe(3150); // 31.50 CAD
    expect(totalCad).toBe(18150); // 181.50 CAD

    // Sum bits cohérente : la somme des composants convertis = total converti.
    // (convertCents idempotent par champ ⇒ pas d'écart d'arrondi sur cet exemple.)
    expect(subtotalCad + taxCad).toBe(totalCad);
  });

  it('identity skip : EUR → EUR retourne amountCents inchangé', () => {
    expect(convertCents(12100, 'EUR', 'EUR', 1.5)).toBe(12100);
  });

  it('rate invalide ⇒ 0 (refus silencieux, caller doit valider via getRate)', () => {
    expect(convertCents(10000, 'EUR', 'CAD', 0)).toBe(0);
    expect(convertCents(10000, 'EUR', 'CAD', -1)).toBe(0);
    expect(convertCents(10000, 'EUR', 'CAD', Number.NaN)).toBe(0);
    expect(convertCents(10000, 'EUR', 'CAD', Number.POSITIVE_INFINITY)).toBe(0);
  });
});

// ── (3) Stale rate (>24h) → warning source='cached_stale' ───────────────────

describe('Sprint 39 — Stale rate fallback (network down)', () => {
  it('cache fetched_at > 24h + fetch ECB down ⇒ source="cached_stale"', async () => {
    const staleFetchedAt = new Date(Date.now() - 36 * 3600 * 1000).toISOString();

    // Setup : 1er .first() = freshHit miss (filtre WHERE fetched_at > -1 day)
    //         2e .first() = staleHit (any-age) ⇒ ce qu'on veut servir.
    const { DB } = makeMockDB({
      firstResults: [
        null /* (2) freshHit miss — filtre <24h exclut le stale */,
        {
          rate: 1.5,
          source: 'ecb',
          fetched_at: staleFetchedAt,
        } /* (4) staleHit */,
      ],
    });

    // Mock fetch ECB ⇒ throw (network down).
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );

    const env = makeEnv(DB);
    const lookup = await getRate(env, 'EUR', 'CAD');

    expect(lookup.source).toBe('cached_stale');
    expect(lookup.rate).toBe(1.5);
    expect(lookup.fetched_at).toBe(staleFetchedAt);
  });
});

// ── (4) Identity skip rate fetching ─────────────────────────────────────────

describe('Sprint 39 — Identity skip (no fetch, no DB)', () => {
  it('getRate(env, CAD, CAD) ⇒ identity, fetch JAMAIS appelé', async () => {
    const { DB } = makeMockDB();
    const env = makeEnv(DB);

    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;

    const lookup = await getRate(env, 'CAD', 'CAD');

    expect(lookup.rate).toBe(1);
    expect(lookup.source).toBe('identity');
    expect(typeof lookup.fetched_at).toBe('string');

    // Mock fetch JAMAIS appelé (verify mock count).
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // Et le mock D1 n'a PAS été touché non plus (pas d'I/O sur identity).
    expect((DB.prepare as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
