// ── Gift cards handlers tests — Sprint 38 Phase B (2026-05-24, Agent C1) ───-
//
// Tests vitest des handlers `gift-cards.ts` (Agent A3). 5 cas figés :
//   1. handleIssueGiftCard succès : mock D1 + audit appelé
//   2. handleRedeemGiftCard idempotence : 2ème appel → INSERT pas dupliqué
//   3. handleGetBalanceByCode PUBLIC rate-limited : 11ème req → 429
//   4. handleGetBalanceByCode payload minimal anti-PII : pas issued_to_email/notes
//   5. handleVoidGiftCard idempotent (déjà voided) : UPDATE pas re-exécuté
//
// Mock pattern : `createMockD1` (helper figé S2/S3) + `vi.mock` modules.
// Aucun réseau, aucun I/O réel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (avant import du SUT) ─────────────────────────────────-

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async (_env: any, _userId: string) => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// Imports APRÈS les mocks (vi.mock est hoisté, sécurité explicite).
import {
  handleIssueGiftCard,
  handleRedeemGiftCard,
  handleGetBalanceByCode,
  handleVoidGiftCard,
} from '../gift-cards';
import { audit } from '../helpers';
import { checkRateLimit } from '../lib/rate-limit';
import { getClientModules } from '../modules';

// ── helpers locaux ─────────────────────────────────────────────────────────-

function makeAuth(overrides: Partial<{ userId: string; capabilities: Set<string> }> = {}) {
  return {
    userId: 'u_admin_1',
    role: 'admin',
    clientId: 'cli_A',
    // Bypass `resolveCapabilities` en injectant les caps directement.
    capabilities: new Set(['clients.manage', 'invoices.write']),
    ...overrides,
  } as any;
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset des impls par défaut (clearAllMocks reset les implémentations).
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: 'cli_A',
    modules: [] as any,
  }));
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
  vi.mocked(audit).mockResolvedValue(undefined as any);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. handleIssueGiftCard — succès + audit appelé
// ═══════════════════════════════════════════════════════════════════════════

describe('handleIssueGiftCard', () => {
  it('200 succès : INSERT gift_cards + INSERT tx issue + audit("gift_card_issued") appelé', async () => {
    const db = createMockD1();
    // lookupAgencyId → null (best-effort).
    db.seed('select agency_id from clients', [{ agency_id: null }]);
    // findCardByCode / collision check → vide = pas de conflit code.
    // Les INSERT (.run()) renvoient succès par défaut.

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/gift-cards', {
      method: 'POST',
      body: JSON.stringify({
        initial_value_cents: 5000,
        currency: 'CAD',
        issued_to_email: 'jean@example.com',
      }),
    });

    const res = await handleIssueGiftCard(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.initial_value_cents).toBe(5000);
    expect(body.data.current_balance_cents).toBe(5000);
    expect(body.data.currency).toBe('CAD');
    expect(body.data.status).toBe('active');
    expect(body.data.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(typeof body.data.id).toBe('string');

    // audit appelé avec l'action figée.
    expect(audit).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(audit).mock.calls[0];
    expect(auditCall?.[2]).toBe('gift_card_issued');
    expect(auditCall?.[3]).toBe('gift_card');

    // INSERT gift_cards appelé.
    const insertCard = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into gift_cards'),
    );
    expect(insertCard).toBeDefined();

    // INSERT gift_card_transactions (type 'issue') appelé.
    const insertTx = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into gift_card_transactions'),
    );
    expect(insertTx).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. handleRedeemGiftCard idempotence : 2ème appel → INSERT pas dupliqué
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRedeemGiftCard idempotence', () => {
  it('2ème appel avec même order_id+amount → no-op (INSERT pas dupliqué)', async () => {
    const db = createMockD1();
    const cardId = 'card_xyz';
    const orderId = 'ord_001';

    // 1) loadCardForTenant → carte active avec solde 10000.
    db.seed('from gift_cards where id = ? and client_id', [
      {
        id: cardId,
        client_id: 'cli_A',
        status: 'active',
        current_balance_cents: 10000,
        expires_at: null,
        currency: 'CAD',
      },
    ]);
    // 2) applyTransaction → SELECT idempotence : tx EXISTANTE trouvée.
    //    SQL pattern : 'SELECT id, balance_after_cents FROM gift_card_transactions'
    db.seed('from gift_card_transactions', [
      { id: 'tx_existing', balance_after_cents: 9000 },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/gift-cards/card_xyz/redeem', {
      method: 'POST',
      body: JSON.stringify({ amount_cents: 1000, order_id: orderId }),
    });

    const res = await handleRedeemGiftCard(req, env, auth, cardId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Le handler retourne le newBalance du hit idempotent (9000 = solde après).
    expect(body.data.new_balance_cents).toBe(9000);
    expect(body.data.gift_card_id).toBe(cardId);

    // ⚠ INSERT gift_card_transactions NE DOIT PAS être appelé : la branche
    //   idempotence court-circuite avant l'INSERT.
    const insertTx = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into gift_card_transactions'),
    );
    expect(insertTx).toBeUndefined();

    // L'UPDATE gift_cards (balance) ne doit pas non plus être appelé.
    const updateCard = db.calls.find((c) =>
      c.sql.toLowerCase().includes('update gift_cards'),
    );
    expect(updateCard).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. handleGetBalanceByCode PUBLIC rate-limited : 11ème → 429
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGetBalanceByCode rate-limit', () => {
  it('11ème appel depuis même IP → 429 (rate-limit dépassé)', async () => {
    const db = createMockD1();
    db.seed('from gift_cards where code = ?', [
      {
        current_balance_cents: 5000,
        currency: 'CAD',
        expires_at: null,
        status: 'active',
      },
    ]);
    const env = makeEnv(db);

    // 10 premiers appels passent (allowed: true).
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      // 11ème appel : refusé.
      .mockResolvedValueOnce({ allowed: false } as any);

    const code = 'ABCD-2345-EFGH-6789';
    const ip = '203.0.113.42';

    let lastRes: Response | null = null;
    for (let i = 0; i < 11; i++) {
      const req = new Request(`https://app/api/public/gift-cards/${code}/balance`, {
        method: 'GET',
        headers: { 'CF-Connecting-IP': ip },
      });
      lastRes = await handleGetBalanceByCode(env, req, code);
    }

    // 11ème = 429.
    expect(lastRes?.status).toBe(429);
    const body = (await lastRes!.json()) as any;
    expect(body.error).toMatch(/trop de requ/i);

    // Confirme checkRateLimit appelé avec bucket keyed par IP.
    expect(checkRateLimit).toHaveBeenCalledTimes(11);
    const rlCall = vi.mocked(checkRateLimit).mock.calls[0];
    expect(rlCall?.[1]).toContain(ip);
    expect(rlCall?.[2]).toBe(10);  // max
    expect(rlCall?.[3]).toBe(60);  // window seconds
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. handleGetBalanceByCode payload minimal anti-PII
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGetBalanceByCode anti-PII', () => {
  it('payload public NE CONTIENT PAS issued_to_email ni notes', async () => {
    const db = createMockD1();
    // Mock simule un SELECT qui pourrait ramener PII (notre handler ne SELECT
    // que les 4 colonnes safe, mais on seede aussi des champs PII pour
    // vérifier que la réponse les EXCLUT strictement).
    db.seed('from gift_cards where code = ?', [
      {
        current_balance_cents: 7500,
        currency: 'CAD',
        expires_at: '2027-12-31',
        status: 'active',
        // PII qui doit JAMAIS apparaître dans la réponse publique :
        issued_to_email: 'secret@example.com',
        notes: 'Cadeau de mariage Jean→Marie',
        id: 'card_internal_id',
        client_id: 'cli_secret',
      },
    ]);
    const env = makeEnv(db);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);

    const code = 'ABCD-2345-EFGH-6789';
    const req = new Request(`https://app/api/public/gift-cards/${code}/balance`, {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
    });

    const res = await handleGetBalanceByCode(env, req, code);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // Champs ALLOWED.
    expect(body.data.balance_cents).toBe(7500);
    expect(body.data.currency).toBe('CAD');
    expect(body.data.expires_at).toBe('2027-12-31');
    expect(body.data.status).toBe('active');

    // Champs PII : interdits dans le payload public.
    expect(body.data).not.toHaveProperty('issued_to_email');
    expect(body.data).not.toHaveProperty('notes');
    expect(body.data).not.toHaveProperty('id');
    expect(body.data).not.toHaveProperty('client_id');
    expect(body.data).not.toHaveProperty('issued_to_customer_id');
    expect(body.data).not.toHaveProperty('agency_id');

    // Sanity : la chaîne sérialisée ne fuit aucun token PII.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('secret@example.com');
    expect(raw).not.toContain('Cadeau de mariage');
    expect(raw).not.toContain('card_internal_id');
    expect(raw).not.toContain('cli_secret');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. handleVoidGiftCard idempotent (déjà voided) : UPDATE pas re-exécuté
// ═══════════════════════════════════════════════════════════════════════════

describe('handleVoidGiftCard idempotent', () => {
  it("carte déjà 'voided' → 200 short-circuit, UPDATE jamais re-exécuté", async () => {
    const db = createMockD1();
    const cardId = 'card_voided_xyz';
    db.seed('from gift_cards where id = ? and client_id', [
      {
        id: cardId,
        client_id: 'cli_A',
        status: 'voided',
        current_balance_cents: 0,
        expires_at: null,
        currency: 'CAD',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();

    const res = await handleVoidGiftCard(env, auth, cardId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(cardId);
    expect(body.data.status).toBe('voided');

    // UPDATE gift_cards SET status='voided' NE DOIT PAS être appelé (short-circuit).
    const updateCard = db.calls.find((c) =>
      c.sql.toLowerCase().includes('update gift_cards'),
    );
    expect(updateCard).toBeUndefined();

    // INSERT gift_card_transactions NE DOIT PAS être appelé non plus.
    const insertTx = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into gift_card_transactions'),
    );
    expect(insertTx).toBeUndefined();

    // audit NE DOIT PAS être appelé (short-circuit avant audit).
    expect(audit).not.toHaveBeenCalled();
  });
});
