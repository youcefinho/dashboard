// ── Tests — Loyalty Handlers (Sprint 38 Phase C — Agent C2) ────────────────
//
// Tests des 6 handlers ciblés depuis worker/loyalty.ts (A4). Réponses
// normalisées : succès { data }, erreur { error } (jamais `code`).
//
// Mock D1 (createMockD1) + seed via `_helpers.ts` : on prouve la LOGIQUE
// APPLICATIVE (status + body + appels DB observables via db.calls). Aucun
// réseau, aucun LLM. Bornage tenant assuré via `seed('from users where id')`
// (calque _ecommerce-fixtures.ts) + `seed('modules_json from clients')`.
//
// ⚠️ Mock D1 matche par includes() lowercase, first-seed-wins. L'ordre des
// seed() compte : on seede du PLUS spécifique au PLUS générique pour éviter
// les faux matches cross-query.
//
// Couvre les 6 cas du contrat §C2 :
//   1. handleCreateProgram succès → 200 + data.id
//   2. handleEarnPoints idempotence → 2e appel = no-op ledger (hit existant)
//   3. handleRedeemPoints insuffisant → 400 'insufficient_points'
//   4. handleRedeemPoints below_min → 400 'below_min_redeem'
//   5. handleAdjustPoints sans clients.manage → 403
//   6. handleRunExpiryCron → summary { expired_count, programs_processed }

import { describe, it, expect } from 'vitest';
import {
  handleCreateProgram,
  handleEarnPoints,
  handleRedeemPoints,
  handleAdjustPoints,
  handleRunExpiryCron,
} from '../loyalty';
import { createMockD1, type MockD1 } from './_helpers';

const CLIENT_ID = 'client-A';
const USER_ID = 'user-A';
const PROGRAM_ID = 'prog-1';
const CUSTOMER_ID = 'cust-1';

type Auth = {
  userId: string;
  role: string;
  capabilities?: Set<string>;
};

function makeAuth(caps: string[] = ['settings.manage']): Auth {
  return {
    userId: USER_ID,
    role: 'admin',
    capabilities: new Set(caps),
  };
}

function loyaltyEnv(db: MockD1): { DB: MockD1 } {
  return { DB: db };
}

/**
 * Seed la résolution du tenant (calque _ecommerce-fixtures.ts).
 *   - SELECT client_id FROM users WHERE id = ?            → users.client_id
 *   - SELECT modules_json FROM clients WHERE id = ?       → clients.modules_json
 *   - SELECT agency_id FROM clients WHERE id = ?          → lookupAgencyId (handler-side)
 *
 * Ordre : modules_json AVANT agency_id (les deux ciblent `clients` ; needle plus
 * spécifique en premier pour disambiguer).
 */
function seedTenant(db: MockD1): void {
  db.seed('from users where id', [{ client_id: CLIENT_ID }]);
  db.seed('modules_json from clients', [{ modules_json: '[]' }]);
  db.seed('agency_id from clients', [{ agency_id: null }]);
}

/**
 * Seed un programme tenant-bound. Couvre les deux SELECTs distincts :
 *   - loadProgramForTenant (handler) :  WHERE id = ? AND client_id = ?
 *   - recordLedgerEntry (engine)     :  WHERE id = ?  (sans client_id)
 *
 * Ordre : seed le plus spécifique (`AND client_id`) AVANT le générique pour
 * disambiguer (first-match-wins).
 */
function seedProgram(
  db: MockD1,
  o: {
    minRedeem?: number;
    earnRate?: number;
    redeemRate?: number;
    isActive?: number;
    benefitsJson?: string | null;
    thresholdsJson?: string | null;
  } = {},
): void {
  const row = {
    id: PROGRAM_ID,
    client_id: CLIENT_ID,
    agency_id: null,
    name: 'Programme Test',
    currency: 'CAD',
    earn_rate_per_dollar: o.earnRate ?? 1,
    redeem_rate_cents_per_point: o.redeemRate ?? 1,
    min_redeem_points: o.minRedeem ?? 0,
    points_expiry_days: null,
    tier_thresholds_json: o.thresholdsJson ?? null,
    tier_benefits_json: o.benefitsJson ?? null,
    is_active: o.isActive ?? 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  // Spécifique : loadProgramForTenant (contient "and client_id").
  db.seed('and client_id = ? limit 1', [row]);
  // Générique : lookup programme dans recordLedgerEntry (sans client_id).
  db.seed('from loyalty_programs', [row]);
}

/** Seed l'état customer (getOrCreateState + readCurrentBalance). */
function seedState(
  db: MockD1,
  o: { balance?: number; lifetime?: number; tier?: string } = {},
): void {
  db.seed('from loyalty_customer_state', [
    {
      id: 'state-1',
      program_id: PROGRAM_ID,
      client_id: CLIENT_ID,
      customer_id: CUSTOMER_ID,
      current_balance: o.balance ?? 0,
      lifetime_earned: o.lifetime ?? 0,
      current_tier: o.tier ?? 'bronze',
      tier_updated_at: null,
      last_earn_at: null,
      last_redeem_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]);
}

function hasCall(db: MockD1, re: RegExp): boolean {
  return db.calls.some((c) => re.test(c.sql));
}

function countCalls(db: MockD1, re: RegExp): number {
  return db.calls.filter((c) => re.test(c.sql)).length;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. handleCreateProgram succès → 200 + data.id
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateProgram', () => {
  it('succès : INSERT loyalty_programs + 200 + data complet', async () => {
    const db = createMockD1();
    seedTenant(db);

    const req = new Request('https://x/api/loyalty/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Programme Fidélité',
        earn_rate_per_dollar: 1,
        redeem_rate_cents_per_point: 1,
        min_redeem_points: 100,
      }),
    });

    const res = await handleCreateProgram(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['settings.manage']),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { id: string; client_id: string; name: string };
    };
    expect(body.data).toBeTruthy();
    expect(typeof body.data?.id).toBe('string');
    expect(body.data?.client_id).toBe(CLIENT_ID);
    expect(body.data?.name).toBe('Programme Fidélité');

    // INSERT loyalty_programs effectué.
    expect(hasCall(db, /insert\s+into\s+loyalty_programs/i)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. handleEarnPoints — idempotence (2e appel = no-op ledger)
// ════════════════════════════════════════════════════════════════════════════

describe('handleEarnPoints — idempotence', () => {
  it('hit idempotency_key : pas de nouveau INSERT ledger ni UPDATE state', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedProgram(db, { earnRate: 1 });
    seedState(db, { balance: 100, tier: 'bronze' });
    // Seed hit idempotence : recordLedgerEntry SELECT loyalty_ledger renvoie
    // une row → court-circuit avant INSERT.
    db.seed('idempotency_key = ?', [
      { id: 'existing-entry', balance_after: 100 },
    ]);

    const req = new Request('https://x/api/loyalty/earn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: PROGRAM_ID,
        customer_id: CUSTOMER_ID,
        subtotal_cents: 10000,
        order_id: 'ord-1',
        idempotency_key: 'idem-key-1',
      }),
    });

    const res = await handleEarnPoints(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['invoices.write']),
    );

    expect(res.status).toBe(200);
    // Aucun INSERT loyalty_ledger : la branche idempotence court-circuite.
    expect(countCalls(db, /insert\s+into\s+loyalty_ledger/i)).toBe(0);
    // Aucun UPDATE loyalty_customer_state non plus (idempotent hit).
    expect(countCalls(db, /update\s+loyalty_customer_state/i)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. handleRedeemPoints insuffisant → 400 'insufficient_points'
// ════════════════════════════════════════════════════════════════════════════

describe('handleRedeemPoints — insuffisant', () => {
  it('balance=50 < points=100 → 400 insufficient_points', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedProgram(db, { minRedeem: 0 }); // min=0 pour isoler la garde balance.
    seedState(db, { balance: 50 });

    const req = new Request('https://x/api/loyalty/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: PROGRAM_ID,
        customer_id: CUSTOMER_ID,
        points: 100,
      }),
    });

    const res = await handleRedeemPoints(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['invoices.write']),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('insufficient_points');
    // Aucun INSERT ledger n'a été tenté : court-circuit avant recordLedgerEntry.
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. handleRedeemPoints below_min → 400 'below_min_redeem'
// ════════════════════════════════════════════════════════════════════════════

describe('handleRedeemPoints — below_min_redeem', () => {
  it('points=50 < program.min_redeem_points=100 → 400 below_min_redeem', async () => {
    const db = createMockD1();
    seedTenant(db);
    seedProgram(db, { minRedeem: 100 });
    // Pas besoin de seedState : la garde min_redeem est en amont du SELECT state.

    const req = new Request('https://x/api/loyalty/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: PROGRAM_ID,
        customer_id: CUSTOMER_ID,
        points: 50,
      }),
    });

    const res = await handleRedeemPoints(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['invoices.write']),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('below_min_redeem');
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. handleAdjustPoints — capability clients.manage requise → 403
// ════════════════════════════════════════════════════════════════════════════

describe('handleAdjustPoints — guard capability', () => {
  it('sans clients.manage → 403 Accès refusé', async () => {
    const db = createMockD1();
    seedTenant(db);

    const req = new Request('https://x/api/loyalty/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: PROGRAM_ID,
        customer_id: CUSTOMER_ID,
        points: 100,
        reason: 'compensation',
      }),
    });

    // capabilities SANS 'clients.manage' → requireCapability renvoie 403.
    const res = await handleAdjustPoints(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['invoices.write', 'reports.view']),
    );

    expect(res.status).toBe(403);
    // Court-circuit en amont : aucune lecture loyalty_programs.
    expect(hasCall(db, /from\s+loyalty_programs/i)).toBe(false);
    // Aucun INSERT loyalty_ledger non plus.
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. handleRunExpiryCron — 1 entry expired → summary expired_count/programs
// ════════════════════════════════════════════════════════════════════════════

describe('handleRunExpiryCron', () => {
  it('1 programme + 1 entry expirée → expirePendingPoints invoqué + summary', async () => {
    const db = createMockD1();
    seedTenant(db);
    // Liste programmes du tenant : SELECT id FROM loyalty_programs WHERE client_id = ?
    db.seed('select id from loyalty_programs', [{ id: PROGRAM_ID }]);
    // Réponse expirePendingPoints (engine A2) : SELECT loyalty_ledger WHERE
    // type='earn' AND expires_at <= ? AND NOT IN (… type='expire'). Une row à
    // expirer. Needle ciblée sur la sous-chaîne unique 'expires_at is not null'.
    db.seed('expires_at is not null', [
      {
        id: 'ledger-earn-1',
        client_id: CLIENT_ID,
        customer_id: CUSTOMER_ID,
        points: 100,
      },
    ]);
    // recomputeState invoqué pour le customer touché : balance/lifetime SUM(points).
    db.seed('coalesce(sum(points), 0) as balance', [{ balance: 0 }]);
    db.seed('coalesce(sum(points), 0) as lifetime', [{ lifetime: 0 }]);

    const req = new Request('https://x/api/loyalty/cron/expire-points', {
      method: 'POST',
    });
    const res = await handleRunExpiryCron(
      req,
      loyaltyEnv(db) as never,
      makeAuth(['settings.manage']),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { expired_count: number; programs_processed: number };
    };
    expect(body.data).toBeTruthy();
    expect(body.data?.programs_processed).toBe(1);
    // 1 ledger entry seedé → 1 expire inséré → expired_count = 1.
    expect(body.data?.expired_count).toBe(1);
    // INSERT loyalty_ledger type='expire' a bien été appelé par expirePendingPoints.
    expect(hasCall(db, /insert\s+into\s+loyalty_ledger/i)).toBe(true);
  });
});
