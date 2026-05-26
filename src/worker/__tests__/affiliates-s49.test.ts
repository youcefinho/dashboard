// ── Sprint 51 — affiliates-s49.test.ts — Tests Sprint 49 Affiliates / Referrals
//
// Tests vitest pour :
//   - Engine pur (affiliate-engine.ts) : generateAffiliateCode,
//     computeCommissionForOrder, attributeOrderToAffiliate, createPayoutBatch.
//   - Handlers (affiliates.ts S49) : handlePublicAffiliateSignup (honeypot +
//     rate-limit), handleConfirmReferral, handleMarkPayoutPaid, cap check
//     `clients.manage`.
//
// Mock D1 via `createMockD1` (helper figé S2/S3) + `vi.mock('../lib/rate-limit')`.
// Aucun réseau, aucun I/O réel — imports relatifs uniquement.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (avant import du SUT) ────────────────────────────────

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
  generateAffiliateCode,
  computeCommissionForOrder,
  attributeOrderToAffiliate,
  createPayoutBatch,
  // ── Sprint 49 Bis — helpers V2 additifs ────────────────────────────────
  computeCommission,
  isSelfReferral,
  detectFraudPattern,
  isPayoutEligible,
  computeReversal,
  getTierForVolume,
  validateCommissionConfig,
  AFFILIATE_ERROR_CODES,
  ATTRIBUTION_MODELS,
  DEFAULT_PAYOUT_DELAY_DAYS,
  type CommissionRule,
  type TierThreshold,
  type ClickEvent,
} from '../lib/affiliate-engine';
import {
  handlePublicAffiliateSignup,
  handleConfirmReferral,
  handleMarkPayoutPaid,
  // ── Sprint 49 Bis — handlers de câblage helpers V2 ───────────────────────
  handleAttributeOrderToAffiliate,
  handlePayoutReferral,
  handleReverseReferral,
  handleUpdateAffiliateProgram,
} from '../affiliates';
import { checkRateLimit } from '../lib/rate-limit';

// ── helpers locaux ───────────────────────────────────────────────────────-

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

function makeAuth(
  caps: string[] = ['clients.manage', 'settings.manage'],
  overrides: Record<string, unknown> = {},
) {
  return {
    userId: 'u_admin_1',
    role: 'admin',
    clientId: 'cli_A',
    capabilities: new Set(caps),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — generateAffiliateCode format
// ═══════════════════════════════════════════════════════════════════════════

describe('generateAffiliateCode', () => {
  it('respecte le format slug + suffixe random et inclut le slug du nom', () => {
    const code = generateAffiliateCode('Jean Dupont');
    // Format : `[a-z0-9]{1..32}-[a-z0-9]{4}` (engine returns lowercase).
    expect(code).toMatch(/^[a-z0-9-]+$/i);
    expect(code.startsWith('jean-dupont-')).toBe(true);
    // Suffixe 4 chars [a-z0-9].
    const suffix = code.split('-').pop();
    expect(suffix).toMatch(/^[a-z0-9]{1,4}$/);
  });

  it('fallback "aff-XXXX" pour nom vide', () => {
    const code = generateAffiliateCode('');
    expect(code).toMatch(/^aff-[a-z0-9]+$/);
  });

  it('strip diacritiques + special chars', () => {
    const code = generateAffiliateCode('Émile Boivin-Côté!');
    expect(code).toMatch(/^[a-z0-9-]+$/);
    expect(code.startsWith('emile-boivin-cote-')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — computeCommissionForOrder tiers
// ═══════════════════════════════════════════════════════════════════════════

describe('computeCommissionForOrder tiers', () => {
  const env = {} as Env;

  it('starter 5% : 10000 cents → { cents: 500, pct: 0.05 }', () => {
    const r = computeCommissionForOrder(env, 10000, 'starter');
    expect(r).toEqual({ cents: 500, pct: 0.05 });
  });

  it('silver 10% : 10000 cents → { cents: 1000, pct: 0.10 }', () => {
    const r = computeCommissionForOrder(env, 10000, 'silver');
    expect(r).toEqual({ cents: 1000, pct: 0.10 });
  });

  it('gold 15% : 10000 cents → { cents: 1500, pct: 0.15 }', () => {
    const r = computeCommissionForOrder(env, 10000, 'gold');
    expect(r).toEqual({ cents: 1500, pct: 0.15 });
  });

  it('tier inconnu → fallback starter 5%', () => {
    const r = computeCommissionForOrder(env, 10000, 'platinum' as any);
    expect(r).toEqual({ cents: 500, pct: 0.05 });
  });

  it('total <= 0 → { cents: 0, pct: 0 }', () => {
    expect(computeCommissionForOrder(env, 0, 'gold')).toEqual({ cents: 0, pct: 0 });
    expect(computeCommissionForOrder(env, -100, 'gold')).toEqual({ cents: 0, pct: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — attributeOrderToAffiliate match code
// ═══════════════════════════════════════════════════════════════════════════

describe('attributeOrderToAffiliate', () => {
  it('match code → INSERT affiliate_referrals + { matched: true, ... }', async () => {
    const db = createMockD1();
    // 1) Lookup order (total + client_id).
    db.seed('from orders where id = ?', [
      { client_id: 'cli_A', total_cents: 10000 },
    ]);
    // 2) Lookup affiliate par code + client_id, status active.
    db.seed('from affiliates', [
      { id: 'aff_1', tier: 'silver', commission_pct: null },
    ]);
    // 3) Idempotence — pas de referral existant.
    db.seed('from affiliate_referrals where order_id = ?', []);

    const env = makeEnv(db);
    const result = await attributeOrderToAffiliate(env, 'ord_001', 'jean-abcd');

    expect(result.matched).toBe(true);
    expect(result.affiliate_id).toBe('aff_1');
    // silver 10% × 10000 = 1000.
    expect(result.commission_cents).toBe(1000);
    expect(typeof result.referral_id).toBe('string');
    expect(result.referral_id!.length).toBeGreaterThan(0);

    // INSERT affiliate_referrals appelé.
    const insertRef = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into affiliate_referrals'),
    );
    expect(insertRef).toBeDefined();
    // Args INSERT : (id, client_id, affiliate_id, order_id, commission_cents, code).
    expect(insertRef!.args).toContain('aff_1');
    expect(insertRef!.args).toContain('ord_001');
    expect(insertRef!.args).toContain('cli_A');
    expect(insertRef!.args).toContain(1000);
    expect(insertRef!.args).toContain('jean-abcd');
  });

  it('code inconnu → { matched: false } sans INSERT referral', async () => {
    const db = createMockD1();
    // Order existe.
    db.seed('from orders where id = ?', [
      { client_id: 'cli_A', total_cents: 5000 },
    ]);
    // Affiliate NON trouvé.
    db.seed('from affiliates', []);

    const env = makeEnv(db);
    const result = await attributeOrderToAffiliate(env, 'ord_002', 'inconnu-xyz');

    expect(result.matched).toBe(false);
    expect(result.affiliate_id).toBeNull();
    expect(result.commission_cents).toBe(0);
    expect(result.reason).toBe('affiliate_not_found');

    // Aucun INSERT referral.
    const insertRef = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into affiliate_referrals'),
    );
    expect(insertRef).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — createPayoutBatch aggregate par affiliate
// ═══════════════════════════════════════════════════════════════════════════

describe('createPayoutBatch', () => {
  it('aggregate confirmed referrals par affiliate_id → INSERT affiliate_payouts', async () => {
    const db = createMockD1();
    // Group by query renvoie 2 affiliés agrégés.
    db.seed('group by affiliate_id', [
      { affiliate_id: 'aff_1', total: 2500, count: 3 },
      { affiliate_id: 'aff_2', total: 1000, count: 1 },
    ]);

    const env = makeEnv(db);
    const result = await createPayoutBatch(
      env,
      'cli_A',
      '2026-05-01',
      '2026-05-31',
    );

    expect(result.payouts_created).toBe(2);
    expect(result.total_cents).toBe(3500);
    expect(result.referrals_count).toBe(4);

    // 2 INSERT affiliate_payouts.
    const insertPayouts = db.calls.filter((c) =>
      c.sql.toLowerCase().includes('insert into affiliate_payouts'),
    );
    expect(insertPayouts).toHaveLength(2);

    // Args premier payout : (id, affiliate_id, client_id, start, end, total, count).
    expect(insertPayouts[0]!.args).toContain('aff_1');
    expect(insertPayouts[0]!.args).toContain('cli_A');
    expect(insertPayouts[0]!.args).toContain(2500);
    expect(insertPayouts[0]!.args).toContain(3);
    // Lock referrals (UPDATE payout_id) appelé.
    const lockUpdates = db.calls.filter((c) =>
      c.sql.toLowerCase().includes('update affiliate_referrals'),
    );
    expect(lockUpdates.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER — handlePublicAffiliateSignup honeypot
// ═══════════════════════════════════════════════════════════════════════════

describe('handlePublicAffiliateSignup honeypot', () => {
  it('_hp rempli → silent 200 fake-success sans INSERT affiliates', async () => {
    const db = createMockD1();
    const env = makeEnv(db);

    const req = new Request(
      'https://app/api/public/affiliates/signup?client=cli_A',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bot Spammer',
          email: 'bot@example.com',
          _hp: 'http://spam.com',
        }),
        headers: { 'CF-Connecting-IP': '203.0.113.5' },
      },
    );

    const res = await handlePublicAffiliateSignup(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Fake-success — id et code = 'bot' (signature handler S49).
    expect(body.data.id).toBe('bot');
    expect(body.data.code).toBe('bot');
    expect(body.data.status).toBe('active');

    // ⚠ Aucun INSERT affiliates — le handler court-circuite.
    const insertAff = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into affiliates'),
    );
    expect(insertAff).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER — handlePublicAffiliateSignup rate-limit
// ═══════════════════════════════════════════════════════════════════════════

describe('handlePublicAffiliateSignup rate-limit', () => {
  it('4ème call depuis même IP → 429', async () => {
    const db = createMockD1();
    // Pas de collision sur code.
    db.seed('from affiliates where client_id is ? and code = ?', []);
    const env = makeEnv(db);

    // 3 premiers passes, 4ème rejected.
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValueOnce({ allowed: false } as any);

    let lastRes: Response | null = null;
    for (let i = 0; i < 4; i++) {
      const req = new Request(
        'https://app/api/public/affiliates/signup?client=cli_A',
        {
          method: 'POST',
          body: JSON.stringify({
            name: `Affilie${i}`,
            email: `aff${i}@example.com`,
          }),
          headers: { 'CF-Connecting-IP': '203.0.113.42' },
        },
      );
      lastRes = await handlePublicAffiliateSignup(req, env);
    }

    expect(lastRes?.status).toBe(429);
    const body = (await lastRes!.json()) as any;
    expect(body.error).toMatch(/trop de requ/i);

    // checkRateLimit appelé avec bucket key préfixé affiliate:signup.
    const rlCall = vi.mocked(checkRateLimit).mock.calls[0];
    expect(rlCall?.[1]).toContain('affiliate:signup:');
    expect(rlCall?.[2]).toBe(3); // max = 3/h
    expect(rlCall?.[3]).toBe(3600); // window = 1h
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER — handleConfirmReferral update referral + agrégat affiliate
// ═══════════════════════════════════════════════════════════════════════════

describe('handleConfirmReferral', () => {
  it("UPDATE status='confirmed' + UPDATE total_commissions_cents affiliate", async () => {
    const db = createMockD1();
    // loadReferralInTenant → row pending.
    db.seed('from affiliate_referrals where id = ?', [
      {
        id: 'ref_001',
        client_id: 'cli_A',
        affiliate_id: 'aff_1',
        status: 'pending',
        commission_cents: 1500,
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth(['clients.manage']);
    const res = await handleConfirmReferral(env, auth, 'ref_001');

    expect(res.status).toBe(200);

    // UPDATE affiliate_referrals SET status='confirmed'.
    const updateRef = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliate_referrals') &&
        c.sql.toLowerCase().includes("status = 'confirmed'"),
    );
    expect(updateRef).toBeDefined();
    expect(updateRef!.args).toContain('ref_001');

    // UPDATE affiliates SET total_commissions_cents = ...
    const updateAff = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliates') &&
        c.sql.toLowerCase().includes('total_commissions_cents'),
    );
    expect(updateAff).toBeDefined();
    // Args : (commission_cents=1500, affiliate_id='aff_1').
    expect(updateAff!.args).toContain(1500);
    expect(updateAff!.args).toContain('aff_1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER — handleMarkPayoutPaid update payouts + referrals
// ═══════════════════════════════════════════════════════════════════════════

describe('handleMarkPayoutPaid', () => {
  it("UPDATE payouts status='paid' + UPDATE referrals status='paid'", async () => {
    const db = createMockD1();
    // loadPayoutInTenant → row pending.
    db.seed('from affiliate_payouts where id = ?', [
      {
        id: 'pay_001',
        client_id: 'cli_A',
        affiliate_id: 'aff_1',
        status: 'pending',
        total_cents: 5000,
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth(['settings.manage']);
    const req = new Request('https://app/api/affiliate-payouts/pay_001/mark-paid', {
      method: 'POST',
      body: JSON.stringify({ stripe_transfer_id: 'tr_test_123', notes: 'OK' }),
    });

    const res = await handleMarkPayoutPaid(req, env, auth, 'pay_001');
    expect(res.status).toBe(200);

    // UPDATE affiliate_payouts SET status='paid'.
    const updatePayout = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliate_payouts') &&
        c.sql.toLowerCase().includes("status = 'paid'"),
    );
    expect(updatePayout).toBeDefined();
    expect(updatePayout!.args).toContain('pay_001');
    expect(updatePayout!.args).toContain('tr_test_123');

    // UPDATE affiliate_referrals SET status='paid' WHERE payout_id = ?
    const updateRefs = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliate_referrals') &&
        c.sql.toLowerCase().includes("status = 'paid'") &&
        c.sql.toLowerCase().includes('payout_id = ?'),
    );
    expect(updateRefs).toBeDefined();
    expect(updateRefs!.args).toContain('pay_001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER — Cap check : sans clients.manage → 403
// ═══════════════════════════════════════════════════════════════════════════

describe('Cap check clients.manage', () => {
  it('handleConfirmReferral sans cap clients.manage → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Auth SANS clients.manage (only some unrelated cap).
    const auth = makeAuth(['invoices.write']);

    const res = await handleConfirmReferral(env, auth, 'ref_anything');
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun SELECT/UPDATE — court-circuit cap guard.
    const anyRefQuery = db.calls.find((c) =>
      c.sql.toLowerCase().includes('affiliate_referrals'),
    );
    expect(anyRefQuery).toBeUndefined();
  });

  it('handleMarkPayoutPaid sans cap settings.manage → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Auth SANS settings.manage.
    const auth = makeAuth(['clients.manage']);

    const req = new Request('https://app/api/affiliate-payouts/pay_x/mark-paid', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleMarkPayoutPaid(req, env, auth, 'pay_x');
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun SELECT/UPDATE payouts.
    const anyPayQuery = db.calls.find((c) =>
      c.sql.toLowerCase().includes('affiliate_payouts'),
    );
    expect(anyPayQuery).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — computeCommission (flat | pct | tier)
// ═══════════════════════════════════════════════════════════════════════════

describe('computeCommission V2', () => {
  it('flat $5 = 500 cents → 500 (sous le cap order)', () => {
    const rule: CommissionRule = { kind: 'flat', cents: 500 };
    expect(computeCommission(10000, rule)).toBe(500);
  });

  it('flat capé au total order (commission ne peut pas dépasser le panier)', () => {
    const rule: CommissionRule = { kind: 'flat', cents: 9999 };
    expect(computeCommission(3000, rule)).toBe(3000);
  });

  it('pct 10% sur $100 (10000 cents) = $10 (1000 cents)', () => {
    const rule: CommissionRule = { kind: 'pct', pct: 0.1 };
    expect(computeCommission(10000, rule)).toBe(1000);
  });

  it('tier gold 15% → round half-up sur fractional cents', () => {
    const rule: CommissionRule = { kind: 'tier', pct: 0.15 };
    // 12345 * 0.15 = 1851.75 → 1852.
    expect(computeCommission(12345, rule, 'gold')).toBe(1852);
  });

  it('pct avec capCents borne le résultat', () => {
    const rule: CommissionRule = { kind: 'pct', pct: 0.5, capCents: 2000 };
    // 10000 * 0.5 = 5000, capé à 2000.
    expect(computeCommission(10000, rule)).toBe(2000);
    // 1000 * 0.5 = 500, sous le cap → 500.
    expect(computeCommission(1000, rule)).toBe(500);
  });

  it('orderTotal ≤ 0 → 0', () => {
    expect(computeCommission(0, { kind: 'pct', pct: 0.5 })).toBe(0);
    expect(computeCommission(-100, { kind: 'flat', cents: 500 })).toBe(0);
  });

  it('pct invalide (> 1 ou ≤ 0) → 0 (defense)', () => {
    expect(computeCommission(10000, { kind: 'pct', pct: 1.5 })).toBe(0);
    expect(computeCommission(10000, { kind: 'pct', pct: 0 })).toBe(0);
    expect(computeCommission(10000, { kind: 'pct', pct: -0.1 })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — isSelfReferral (case + alias Gmail)
// ═══════════════════════════════════════════════════════════════════════════

describe('isSelfReferral', () => {
  it('match case-insensitive (Jean@X.com vs jean@x.com)', () => {
    expect(isSelfReferral('Jean@Example.com', 'jean@example.com')).toBe(true);
  });

  it('match alias Gmail+ (john+promo@gmail.com vs john@gmail.com)', () => {
    expect(isSelfReferral('john.doe+spam@gmail.com', 'JOHN.DOE@gmail.com')).toBe(true);
  });

  it('different emails → false', () => {
    expect(isSelfReferral('jean@x.com', 'paul@x.com')).toBe(false);
  });

  it('emails vides / null → false (pas de match, pas de blocage)', () => {
    expect(isSelfReferral('', 'jean@x.com')).toBe(false);
    expect(isSelfReferral('jean@x.com', null)).toBe(false);
    expect(isSelfReferral(null, undefined)).toBe(false);
  });

  it('whitespace trimmed', () => {
    expect(isSelfReferral('  jean@x.com  ', 'jean@x.com')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — detectFraudPattern (rate-spike + fingerprint farming)
// ═══════════════════════════════════════════════════════════════════════════

describe('detectFraudPattern', () => {
  it('11 clicks même IP dans 5min → suspicious avec reason rate_spike_ip', () => {
    const now = Date.now();
    const clicks: ClickEvent[] = Array.from({ length: 11 }, (_, i) => ({
      clickedAt: now - i * 1000,
      ipHash: 'abc12345xxx',
    }));
    const r = detectFraudPattern(clicks, 5);
    expect(r.suspicious).toBe(true);
    expect(r.reasons.some((x) => x.startsWith('rate_spike_ip:'))).toBe(true);
  });

  it('5 clicks même IP dans 5min → NOT suspicious', () => {
    const now = Date.now();
    const clicks: ClickEvent[] = Array.from({ length: 5 }, (_, i) => ({
      clickedAt: now - i * 1000,
      ipHash: 'abc12345xxx',
    }));
    const r = detectFraudPattern(clicks, 5);
    expect(r.suspicious).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });

  it('fingerprint partagé ≥ 2 affiliateIds distincts → suspicious farming', () => {
    const now = Date.now();
    const clicks: ClickEvent[] = [
      { clickedAt: now, fingerprint: 'fp_shared', affiliateId: 'aff_A' },
      { clickedAt: now, fingerprint: 'fp_shared', affiliateId: 'aff_B' },
    ];
    const r = detectFraudPattern(clicks, 5);
    expect(r.suspicious).toBe(true);
    expect(r.reasons.some((x) => x.startsWith('fingerprint_shared:'))).toBe(true);
  });

  it('liste vide → NOT suspicious (no reasons)', () => {
    expect(detectFraudPattern([], 5)).toEqual({ suspicious: false, reasons: [] });
  });

  it('clicks hors fenêtre → ignorés', () => {
    const now = Date.now();
    const clicks: ClickEvent[] = Array.from({ length: 20 }, () => ({
      clickedAt: now - 10 * 60_000, // 10 min ago, window 5 min.
      ipHash: 'oldIp',
    }));
    const r = detectFraudPattern(clicks, 5);
    expect(r.suspicious).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — isPayoutEligible (status + age)
// ═══════════════════════════════════════════════════════════════════════════

describe('isPayoutEligible', () => {
  const NOW = new Date('2026-06-01T00:00:00Z');

  it('confirmed + 15 jours après confirmation → eligible', () => {
    const referral = {
      status: 'confirmed',
      confirmed_at: '2026-05-17T00:00:00Z', // 15 jours avant NOW.
    };
    const r = isPayoutEligible(referral, 14, NOW);
    expect(r.eligible).toBe(true);
  });

  it('confirmed + 13 jours après confirmation → ineligible (too_recent)', () => {
    const referral = {
      status: 'confirmed',
      confirmed_at: '2026-05-19T00:00:00Z', // 13 jours avant NOW.
    };
    const r = isPayoutEligible(referral, 14, NOW);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/too_recent/);
  });

  it('status pending → ineligible (status_not_confirmed)', () => {
    const r = isPayoutEligible(
      { status: 'pending', confirmed_at: '2026-05-01T00:00:00Z' },
      14,
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/status_not_confirmed/);
  });

  it('payout_id déjà attribué → ineligible (already_in_payout)', () => {
    const r = isPayoutEligible(
      {
        status: 'confirmed',
        confirmed_at: '2026-05-01T00:00:00Z',
        payout_id: 'pay_123',
      },
      14,
      NOW,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('already_in_payout');
  });

  it('referral null → REFERRAL_INVALID', () => {
    const r = isPayoutEligible(null, 14, NOW);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe(AFFILIATE_ERROR_CODES.REFERRAL_INVALID);
  });

  it('default delay = DEFAULT_PAYOUT_DELAY_DAYS (14)', () => {
    expect(DEFAULT_PAYOUT_DELAY_DAYS).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — computeReversal (full | partial)
// ═══════════════════════════════════════════════════════════════════════════

describe('computeReversal', () => {
  it('full refund (ratio=1) → reverse 100%', () => {
    const r = computeReversal({ status: 'confirmed', commission_cents: 1000 }, 1);
    expect(r.reverseAmount).toBe(1000);
    expect(r.reason).toBe('full_refund');
  });

  it('partial refund (ratio=0.5) → reverse 50% (round)', () => {
    const r = computeReversal({ status: 'confirmed', commission_cents: 1001 }, 0.5);
    expect(r.reverseAmount).toBe(501); // round(500.5) = 501.
    expect(r.reason).toBe('partial_refund');
  });

  it('referral déjà reversed → ALREADY_REVERSED, reverseAmount=0', () => {
    const r = computeReversal({ status: 'reversed', commission_cents: 1000 }, 1);
    expect(r.reverseAmount).toBe(0);
    expect(r.reason).toBe(AFFILIATE_ERROR_CODES.ALREADY_REVERSED);
  });

  it('ratio=0 ou commission=0 → reverseAmount=0', () => {
    expect(computeReversal({ status: 'confirmed', commission_cents: 0 }, 1).reverseAmount).toBe(0);
    expect(computeReversal({ status: 'confirmed', commission_cents: 1000 }, 0).reverseAmount).toBe(0);
  });

  it('ratio hors [0..1] borné', () => {
    // ratio > 1 borné à 1.
    expect(computeReversal({ status: 'confirmed', commission_cents: 1000 }, 5).reverseAmount).toBe(1000);
    // ratio négatif borné à 0.
    expect(computeReversal({ status: 'confirmed', commission_cents: 1000 }, -1).reverseAmount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — getTierForVolume
// ═══════════════════════════════════════════════════════════════════════════

describe('getTierForVolume', () => {
  const tiers: TierThreshold[] = [
    { tier: 'bronze', minVolumeCents: 0 },
    { tier: 'silver', minVolumeCents: 10_000 },
    { tier: 'gold', minVolumeCents: 50_000 },
  ];

  it('1000 → bronze (sous silver threshold)', () => {
    expect(getTierForVolume(1000, tiers)).toBe('bronze');
  });

  it('10000 → silver (exactement le threshold)', () => {
    expect(getTierForVolume(10_000, tiers)).toBe('silver');
  });

  it('50000 → gold (exactement le threshold)', () => {
    expect(getTierForVolume(50_000, tiers)).toBe('gold');
  });

  it('999_999 → gold (au-dessus du plus haut)', () => {
    expect(getTierForVolume(999_999, tiers)).toBe('gold');
  });

  it('volume négatif → tier le plus bas (bronze)', () => {
    expect(getTierForVolume(-100, tiers)).toBe('bronze');
  });

  it('tiers vide → starter par défaut', () => {
    expect(getTierForVolume(1000, [])).toBe('starter');
  });

  it('tiers non triés (ordre arbitraire) → résolu correctement par tri interne', () => {
    const shuffled: TierThreshold[] = [
      { tier: 'gold', minVolumeCents: 50_000 },
      { tier: 'bronze', minVolumeCents: 0 },
      { tier: 'silver', minVolumeCents: 10_000 },
    ];
    expect(getTierForVolume(20_000, shuffled)).toBe('silver');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — validateCommissionConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('validateCommissionConfig', () => {
  it('pct 10% → ok', () => {
    expect(validateCommissionConfig({ kind: 'pct', pct: 0.1 })).toEqual({ ok: true });
  });

  it('pct 0% → reject (pct_must_be_positive)', () => {
    const r = validateCommissionConfig({ kind: 'pct', pct: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('pct_must_be_positive');
  });

  it('pct négatif (-5%) → reject', () => {
    const r = validateCommissionConfig({ kind: 'pct', pct: -0.05 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('pct_must_be_positive');
  });

  it('pct 150% (> 1) → reject (pct_must_be_lte_1)', () => {
    const r = validateCommissionConfig({ kind: 'pct', pct: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('pct_must_be_lte_1');
  });

  it('flat 500 cents → ok', () => {
    expect(validateCommissionConfig({ kind: 'flat', cents: 500 })).toEqual({ ok: true });
  });

  it('flat 0 cents → reject', () => {
    const r = validateCommissionConfig({ kind: 'flat', cents: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('flat_cents_must_be_positive');
  });

  it('cap négatif → reject', () => {
    const r = validateCommissionConfig({ kind: 'pct', pct: 0.1, capCents: -100 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cap_must_be_positive');
  });

  it('config null → reject', () => {
    expect(validateCommissionConfig(null).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE V2 — Constants exports
// ═══════════════════════════════════════════════════════════════════════════

describe('Constants V2', () => {
  it('ATTRIBUTION_MODELS expose 3 modèles canoniques', () => {
    expect(ATTRIBUTION_MODELS).toContain('first_touch');
    expect(ATTRIBUTION_MODELS).toContain('last_touch');
    expect(ATTRIBUTION_MODELS).toContain('multi_touch');
  });

  it('AFFILIATE_ERROR_CODES expose les 6 codes spec', () => {
    expect(AFFILIATE_ERROR_CODES.AFFILIATE_NOT_FOUND).toBe('AFFILIATE_NOT_FOUND');
    expect(AFFILIATE_ERROR_CODES.REFERRAL_INVALID).toBe('REFERRAL_INVALID');
    expect(AFFILIATE_ERROR_CODES.SELF_REFERRAL).toBe('SELF_REFERRAL');
    expect(AFFILIATE_ERROR_CODES.ALREADY_REVERSED).toBe('ALREADY_REVERSED');
    expect(AFFILIATE_ERROR_CODES.PAYOUT_INELIGIBLE).toBe('PAYOUT_INELIGIBLE');
    expect(AFFILIATE_ERROR_CODES.STRIPE_NOT_CONFIGURED).toBe('STRIPE_NOT_CONFIGURED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER WIRE-UP — Sprint 49 Bis (5 tests câblage engine helpers V2)
//
// Vérifient que le câblage handlers ↔ engine helpers V2 fonctionne :
//   1. attribute order avec buyer.email == affiliate.email → 403 SELF_REFERRAL
//   2. attribute order fraud pattern (11 clicks/5min) → referral status='flagged'
//   3. payout référence < 14 jours → 409 PAYOUT_INELIGIBLE
//   4. reverse referral already reversed → 409/200 + ALREADY_REVERSED code
//   5. commission rule rate=150% → 400 INVALID_CONFIG
// ═══════════════════════════════════════════════════════════════════════════

describe('Wire-up Sprint 49 Bis : handleAttributeOrderToAffiliate', () => {
  it('buyer.email == affiliate.email → 403 SELF_REFERRAL', async () => {
    const db = createMockD1();
    // Lookup email affilié par code → match exact case-insensitive.
    db.seed("from affiliates where code = ? and status = 'active'", [
      { email: 'Jean@Example.com' },
    ]);

    const env = makeEnv(db);
    const res = await handleAttributeOrderToAffiliate(env, {
      orderId: 'ord_self_001',
      referralCode: 'jean-abcd',
      buyerEmail: 'jean@example.com',
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error_code).toBe(AFFILIATE_ERROR_CODES.SELF_REFERRAL);
    expect(body.error).toMatch(/self-referral/i);

    // ⚠ Aucun INSERT affiliate_referrals — court-circuit avant attribution.
    const insertRef = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into affiliate_referrals'),
    );
    expect(insertRef).toBeUndefined();
  });

  it('fraud pattern (11 clicks/5min) → referral marqué status=flagged', async () => {
    const db = createMockD1();
    // Affiliate email DIFFÉRENT du buyer (pas de self-referral).
    db.seed("from affiliates where code = ? and status = 'active'", [
      { email: 'pierre@aff.com' },
    ]);
    // Order existe (engine attributeOrderToAffiliate doit aboutir).
    db.seed('from orders where id = ?', [
      { client_id: 'cli_A', total_cents: 10000 },
    ]);
    // Affiliate lookup engine.
    db.seed('select id, tier, commission_pct from affiliates', [
      { id: 'aff_fraud_1', tier: 'silver', commission_pct: null },
    ]);
    // Pas de referral existant pour l'order.
    db.seed('from affiliate_referrals where order_id = ?', []);

    const now = Date.now();
    const recentClicks: ClickEvent[] = Array.from({ length: 11 }, (_, i) => ({
      clickedAt: now - i * 1000,
      ipHash: 'fraudIpHash',
    }));

    const env = makeEnv(db);
    const res = await handleAttributeOrderToAffiliate(env, {
      orderId: 'ord_fraud_001',
      referralCode: 'pierre-xyz',
      buyerEmail: 'acheteur@client.com',
      recentClicks,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.matched).toBe(true);
    expect(body.data.status).toBe('flagged');
    expect(Array.isArray(body.data.fraud_reasons)).toBe(true);

    // UPDATE affiliate_referrals SET status = 'flagged' appelé.
    const updateFlag = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliate_referrals') &&
        c.sql.toLowerCase().includes("status = 'flagged'"),
    );
    expect(updateFlag).toBeDefined();
  });
});

describe('Wire-up Sprint 49 Bis : handlePayoutReferral', () => {
  it('referral < 14 jours après confirmed_at → 409 PAYOUT_INELIGIBLE', async () => {
    const db = createMockD1();
    // confirmed_at 5 jours avant maintenant (< DEFAULT_PAYOUT_DELAY_DAYS=14).
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    db.seed('from affiliate_referrals where id = ?', [
      {
        id: 'ref_too_recent',
        client_id: 'cli_A',
        affiliate_id: 'aff_1',
        status: 'confirmed',
        confirmed_at: fiveDaysAgo,
        commission_cents: 1500,
        payout_id: null,
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth(['settings.manage']);
    const res = await handlePayoutReferral(env, auth, 'ref_too_recent');

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error_code).toBe(AFFILIATE_ERROR_CODES.PAYOUT_INELIGIBLE);
    expect(body.reason).toMatch(/too_recent/);
  });
});

describe('Wire-up Sprint 49 Bis : handleReverseReferral ALREADY_REVERSED', () => {
  it('reverse referral déjà reversed → réponse 200 + error_code ALREADY_REVERSED', async () => {
    const db = createMockD1();
    db.seed('from affiliate_referrals where id = ?', [
      {
        id: 'ref_already_rev',
        client_id: 'cli_A',
        affiliate_id: 'aff_1',
        status: 'reversed',
        commission_cents: 1000,
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth(['clients.manage']);
    const req = new Request(
      'https://app/api/affiliate-referrals/ref_already_rev/reverse',
      {
        method: 'POST',
        body: JSON.stringify({ refund_ratio: 1 }),
      },
    );

    const res = await handleReverseReferral(req, env, auth, 'ref_already_rev');

    // Idempotent : retourne 200 (pas d'erreur) MAIS body porte le code engine.
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.already_reversed).toBe(true);
    expect(body.error_code).toBe(AFFILIATE_ERROR_CODES.ALREADY_REVERSED);

    // Aucun UPDATE re-reverse (court-circuit avant SQL).
    const updateRef = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update affiliate_referrals') &&
        c.sql.toLowerCase().includes("status = 'reversed'"),
    );
    expect(updateRef).toBeUndefined();
  });
});

describe('Wire-up Sprint 49 Bis : handleUpdateAffiliateProgram INVALID_CONFIG', () => {
  it("commission_value 150 (percent) → pct=1.5 > 1 → 400 INVALID_CONFIG", async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Auth legacy (S92 cap workflows.manage). Le programme est singleton tenant.
    const auth = makeAuth(['workflows.manage'], {
      tenant: { agencyId: null, clientId: 'cli_A', accessibleClientIds: ['cli_A'] },
    });

    const req = new Request('https://app/api/affiliate-programs', {
      method: 'PUT',
      body: JSON.stringify({
        commission_type: 'percent',
        commission_value: 150, // 150% → invalide via validateCommissionConfig
        cookie_window_days: 30,
        target_url: 'https://example.com',
        status: 'active',
      }),
    });

    const res = await handleUpdateAffiliateProgram(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error_code).toBe('INVALID_CONFIG');
    expect(body.error).toMatch(/commission invalide/i);

    // Aucun UPDATE/INSERT affiliate_programs (court-circuit validation).
    const upsert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('affiliate_programs'),
    );
    expect(upsert).toBeUndefined();
  });
});
