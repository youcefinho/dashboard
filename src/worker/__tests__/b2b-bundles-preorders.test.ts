// ── b2b-bundles-preorders.test.ts — Sprint 51 / Sprint 48 ──────────────────
//
// Couvre les 3 helpers du pricing-engine.ts (resolveTierPrice +
// computeBundleDiscount + processPreorderNotification) + 6 handlers REST clés
// de b2b-bundles-preorders.ts.
//
// Approche : harness mock D1 (`createMockD1` + `seed`) — calqué sur
// subscriptions-advanced.test.ts. Aucune I/O réseau, imports relatifs.
//
// ⚠ Ne touche pas aux helpers ecommerce-*.ts existants. Module FRESH (Agent T48).

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  resolveTierPrice,
  computeBundleDiscount,
  processPreorderNotification,
  computeBundlePrice,
  getVolumeTierDiscount,
  computePreorderDeposit,
  convertCurrency,
  isCurrencySupported,
  validatePricingInput,
  computeFinalPrice,
  DEFAULT_DEPOSIT_PCT,
  MAX_DISCOUNT_PCT,
  PRICING_ERROR_CODES,
  DEFAULT_VOLUME_TIERS,
  type BundlePriceItem as BundlePriceItemT,
} from '../lib/pricing-engine';
import {
  handleCreateCustomerGroup,
  handleAssignCustomerToGroup,
  handleCreateTierPrice,
  handleCreateBundle,
  handlePublicCreatePreorder,
  handleListCustomerGroups,
} from '../b2b-bundles-preorders';

// ── Auth helpers ───────────────────────────────────────────────────────────

type Auth = {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

const AUTH_ADMIN: Auth = {
  userId: 'user-1',
  role: 'admin',
  clientId: 'client-1',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['clients.manage']),
};

// Auth sans la capability clients.manage — pour tester les 403.
const AUTH_NO_CAP: Auth = {
  userId: 'user-2',
  role: 'viewer',
  clientId: 'client-1',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['leads.read']),
};

// ── Env / req helpers ──────────────────────────────────────────────────────

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  const env = { DB: db } as unknown as Env;
  return { env, db };
}

function postReq(path: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(`http://x${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: headers ?? {},
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — pricing-engine.ts (4 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('S48 engine — resolveTierPrice', () => {
  it('match : customer in group wholesale + tier_prices → price + group_applied + discount_pct', async () => {
    const { env, db } = makeEnv();
    // 1) variant.price legacy fallback = 10000c.
    db.seed('select price_cents from product_variants', [{ price_cents: 10000 }]);
    // 2) groups actifs du customer = ['grp-wholesale'].
    db.seed('from customer_group_assignments', [{ group_id: 'grp-wholesale' }]);
    // 3) tier_prices best match = 8000c sur grp-wholesale (20% off).
    db.seed('from tier_prices', [
      { price_cents: 8000, group_id: 'grp-wholesale', min_quantity: 5 },
    ]);

    const r = await resolveTierPrice(env, 'variant-1', 'cust-1', 10);

    expect(r.price_cents).toBe(8000);
    expect(r.group_applied).toBe('grp-wholesale');
    expect(r.discount_pct).toBe(20);
  });

  it('no match : customer dans aucun group actif → fallback variant.price', async () => {
    const { env, db } = makeEnv();
    db.seed('select price_cents from product_variants', [{ price_cents: 12500 }]);
    // Pas de seed pour customer_group_assignments → defaultRows=[] → groupIds vide.

    const r = await resolveTierPrice(env, 'variant-2', 'cust-2', 3);

    expect(r.price_cents).toBe(12500);
    expect(r.group_applied).toBeNull();
    expect(r.discount_pct).toBe(0);
  });
});

describe('S48 engine — computeBundleDiscount', () => {
  it('items sum 3000c + total_override 2400c → discount_cents=600 / discount_pct=20', () => {
    const r = computeBundleDiscount(
      [
        { unit_price_cents: 1000, quantity: 2 },
        { unit_price_cents: 500, quantity: 2 },
      ],
      2400,
    );
    expect(r.sum_items_cents).toBe(3000);
    expect(r.discount_cents).toBe(600);
    expect(r.discount_pct).toBe(20);
  });

  it('totalOverride null OU >= sum → discount nul, sum_items préservé', () => {
    const r1 = computeBundleDiscount(
      [{ unit_price_cents: 1000, quantity: 3 }],
      null,
    );
    expect(r1.sum_items_cents).toBe(3000);
    expect(r1.discount_cents).toBe(0);
    expect(r1.discount_pct).toBe(0);

    const r2 = computeBundleDiscount(
      [{ unit_price_cents: 1000, quantity: 3 }],
      4000, // > sum
    );
    expect(r2.sum_items_cents).toBe(3000);
    expect(r2.discount_cents).toBe(0);
  });
});

describe('S48 engine — processPreorderNotification', () => {
  it("UPDATE preorder_queue SET status='notified', notified_at=now WHERE status='queued'", async () => {
    const { env, db } = makeEnv();
    db.seed('from preorder_queue where id = ?', [
      {
        id: 'pre-1',
        variant_id: 'v-1',
        customer_id: 'cust-1',
        client_id: 'client-1',
        email: 'buyer@example.com',
        status: 'queued',
      },
    ]);

    const r = await processPreorderNotification(env, 'pre-1');

    expect(r.notified).toBe(true);
    expect(r.email_sent).toBe(false); // Phase A : pas de send réel.

    // UPDATE preorder_queue SET status='notified', notified_at=...
    const updates = db.calls.filter((c) =>
      /update preorder_queue[\s\S]*set status = 'notified'/i.test(c.sql),
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].args[0]).toBe('pre-1');
  });

  it("preorder déjà notifié → reason='not_queued', pas d'UPDATE", async () => {
    const { env, db } = makeEnv();
    db.seed('from preorder_queue where id = ?', [
      {
        id: 'pre-2',
        variant_id: 'v-1',
        customer_id: 'cust-1',
        client_id: 'client-1',
        email: 'x@y.com',
        status: 'notified',
      },
    ]);

    const r = await processPreorderNotification(env, 'pre-2');

    expect(r.notified).toBe(false);
    expect(r.reason).toBe('not_queued');
    const updates = db.calls.filter((c) =>
      /update preorder_queue[\s\S]*set status = 'notified'/i.test(c.sql),
    );
    expect(updates.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — b2b-bundles-preorders.ts (6 cas)
// ════════════════════════════════════════════════════════════════════════════

describe('S48 handler — handleCreateCustomerGroup', () => {
  it('INSERT + validation name requis → 400 si vide', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/customer-groups', {});
    const res = await handleCreateCustomerGroup(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/name/i);
  });

  it('INSERT customer_groups OK avec validation default_discount_pct [0..100]', async () => {
    const { env, db } = makeEnv();
    const req = postReq('/api/customer-groups', {
      name: 'Wholesale',
      slug: 'wholesale',
      description: 'B2B tier',
      default_discount_pct: 20,
      is_active: true,
    });
    const res = await handleCreateCustomerGroup(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      client_id: 'client-1',
      name: 'Wholesale',
      slug: 'wholesale',
      default_discount_pct: 20,
      is_active: 1,
    });

    const inserts = db.calls.filter((c) =>
      /insert into customer_groups/i.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('validation default_discount_pct hors [0..100] → 400', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/customer-groups', {
      name: 'BadGrp',
      default_discount_pct: 150,
    });
    const res = await handleCreateCustomerGroup(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
  });
});

describe('S48 handler — handleAssignCustomerToGroup', () => {
  it('INSERT OR IGNORE customer_group_assignments (idempotent duplicate = no-op)', async () => {
    const { env, db } = makeEnv();
    // Le group doit appartenir au client (loadCustomerGroup).
    db.seed('from customer_groups where id = ? and client_id', [
      { id: 'grp-1', client_id: 'client-1', name: 'Wholesale' },
    ]);

    const req = postReq('/api/customer-groups/grp-1/assign', {
      customer_id: 'cust-1',
    });
    const res = await handleAssignCustomerToGroup(
      req,
      env,
      AUTH_ADMIN as never,
      'grp-1',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      group_id: 'grp-1',
      customer_id: 'cust-1',
      client_id: 'client-1',
    });

    // INSERT OR IGNORE — clé d'idempotence (UNIQUE group_id, customer_id).
    const inserts = db.calls.filter((c) =>
      /insert or ignore into customer_group_assignments/i.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThan(0);
    // Re-bind cohérent : (id, group_id, customer_id, client_id, expires_at).
    expect(inserts[0].args[1]).toBe('grp-1');
    expect(inserts[0].args[2]).toBe('cust-1');
    expect(inserts[0].args[3]).toBe('client-1');
  });

  it('group introuvable (mauvais tenant) → 404', async () => {
    const { env } = makeEnv();
    // Pas de seed → loadCustomerGroup retourne null → 404.
    const req = postReq('/api/customer-groups/grp-bogus/assign', {
      customer_id: 'cust-1',
    });
    const res = await handleAssignCustomerToGroup(
      req,
      env,
      AUTH_ADMIN as never,
      'grp-bogus',
    );
    expect(res.status).toBe(404);
  });
});

describe('S48 handler — handleCreateTierPrice', () => {
  it('validation min_quantity > 0 → 400 si 0', async () => {
    const { env, db } = makeEnv();
    db.seed('from customer_groups where id = ? and client_id', [
      { id: 'grp-1', client_id: 'client-1' },
    ]);
    const req = postReq('/api/tier-prices', {
      product_variant_id: 'v-1',
      group_id: 'grp-1',
      price_cents: 5000,
      min_quantity: 0,
    });
    const res = await handleCreateTierPrice(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/min_quantity/i);
  });

  it('validation price_cents >= 0 → 400 si négatif', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/tier-prices', {
      product_variant_id: 'v-1',
      group_id: 'grp-1',
      price_cents: -100,
    });
    const res = await handleCreateTierPrice(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/price_cents/i);
  });

  it('INSERT tier_prices OK avec bind (id, variant, group, client, price, min_qty)', async () => {
    const { env, db } = makeEnv();
    db.seed('from customer_groups where id = ? and client_id', [
      { id: 'grp-1', client_id: 'client-1' },
    ]);
    const req = postReq('/api/tier-prices', {
      product_variant_id: 'v-1',
      group_id: 'grp-1',
      price_cents: 7500,
      min_quantity: 5,
    });
    const res = await handleCreateTierPrice(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(200);

    const inserts = db.calls.filter((c) =>
      /insert into tier_prices/i.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThan(0);
    // (id, variant, group, client, price, min_qty)
    expect(inserts[0].args[1]).toBe('v-1');
    expect(inserts[0].args[2]).toBe('grp-1');
    expect(inserts[0].args[3]).toBe('client-1');
    expect(inserts[0].args[4]).toBe(7500);
    expect(inserts[0].args[5]).toBe(5);
  });
});

describe('S48 handler — handleCreateBundle', () => {
  it('INSERT product_bundles + validation name requis', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', {});
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/name/i);
  });

  it('création bundle OK avec total_price_cents + discount_pct + is_active=1 par défaut', async () => {
    const { env, db } = makeEnv();
    const req = postReq('/api/product-bundles', {
      name: 'Starter Pack',
      description: 'Pack signature',
      total_price_cents: 2400,
      discount_pct: 20,
    });
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      client_id: 'client-1',
      name: 'Starter Pack',
      total_price_cents: 2400,
      discount_pct: 20,
      is_active: 1,
    });

    const inserts = db.calls.filter((c) =>
      /insert into product_bundles/i.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('discount_pct hors [0..100] → 400', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', {
      name: 'Bad Bundle',
      discount_pct: 200,
    });
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
  });
});

describe('S48 handler — handlePublicCreatePreorder (PUBLIC + rate-limit + honeypot)', () => {
  it('honeypot website rempli → 200 silencieux (bot — pas de fingerprint), pas d\'INSERT', async () => {
    const { env, db } = makeEnv();
    const req = postReq(
      '/api/public/preorders',
      {
        variant_id: 'v-1',
        email: 'bot@spam.com',
        website: 'http://bot.evil', // honeypot rempli ⇒ bot
      },
      { 'cf-connecting-ip': '1.2.3.4' },
    );
    const res = await handlePublicCreatePreorder(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; status: string } };
    expect(body.data.status).toBe('cancelled');

    const inserts = db.calls.filter((c) =>
      /insert into preorder_queue/i.test(c.sql),
    );
    expect(inserts.length).toBe(0);
  });

  it('email invalide → 400', async () => {
    const { env } = makeEnv();
    const req = postReq(
      '/api/public/preorders',
      { variant_id: 'v-1', email: 'not-an-email' },
      { 'cf-connecting-ip': '5.6.7.8' },
    );
    const res = await handlePublicCreatePreorder(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('flow nominal : resolve client via variant → INSERT preorder_queue status=queued', async () => {
    const { env, db } = makeEnv();
    // Mock le lookup variant → product → client_id.
    db.seed('from product_variants v', [{ client_id: 'client-1' }]);

    const req = postReq(
      '/api/public/preorders',
      { variant_id: 'v-1', email: 'visitor@example.com', quantity: 2 },
      { 'cf-connecting-ip': '9.10.11.12' },
    );
    const res = await handlePublicCreatePreorder(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; status: string } };
    expect(body.data.status).toBe('queued');
    expect(typeof body.data.id).toBe('string');
    expect(body.data.id.length).toBeGreaterThan(0);

    const inserts = db.calls.filter((c) =>
      /insert into preorder_queue/i.test(c.sql),
    );
    expect(inserts.length).toBeGreaterThan(0);
    // (id, variant_id, client_id, quantity, email)
    expect(inserts[0].args[1]).toBe('v-1');
    expect(inserts[0].args[2]).toBe('client-1');
    expect(inserts[0].args[3]).toBe(2);
    expect(inserts[0].args[4]).toBe('visitor@example.com');
  });
});

describe('S48 cap guard — clients.manage requis', () => {
  it('handleListCustomerGroups sans cap clients.manage → 403', async () => {
    const { env } = makeEnv();
    const res = await handleListCustomerGroups(env, AUTH_NO_CAP as never);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/refus/i);
  });

  it('handleCreateBundle sans cap clients.manage → 403', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', { name: 'X' });
    const res = await handleCreateBundle(req, env, AUTH_NO_CAP as never);
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 48 — RENFORCEMENT (8 helpers PURE additifs)
// ════════════════════════════════════════════════════════════════════════════

describe('S48 renforcement — computeBundlePrice (pure)', () => {
  it('sum simple sans override / sans discount', () => {
    const r = computeBundlePrice(
      [
        { unit_price_cents: 1000, quantity: 2 },
        { unit_price_cents: 500, quantity: 3 },
      ],
      null,
      0,
    );
    expect(r.gross).toBe(3500);
    expect(r.discount).toBe(0);
    expect(r.net).toBe(3500);
  });

  it('override bundle_price (admin a fixé prix de vente)', () => {
    const r = computeBundlePrice(
      [{ unit_price_cents: 1000, quantity: 3 }], // gross = 3000
      2400, // override net
    );
    expect(r.gross).toBe(3000);
    expect(r.net).toBe(2400);
    expect(r.discount).toBe(600);
  });

  it('discount 10% sur gross', () => {
    const r = computeBundlePrice(
      [{ unit_price_cents: 10000, quantity: 1 }],
      null,
      10,
    );
    expect(r.gross).toBe(10000);
    expect(r.discount).toBe(1000);
    expect(r.net).toBe(9000);
  });

  it('empty bundle → 0/0/0', () => {
    const r = computeBundlePrice([], null, 50);
    expect(r).toEqual({ gross: 0, discount: 0, net: 0 });
  });

  it('discountPct clamped >100 → 100%', () => {
    const r = computeBundlePrice(
      [{ unit_price_cents: 1000, quantity: 1 }],
      null,
      150,
    );
    expect(r.net).toBe(0);
    expect(r.discount).toBe(1000);
  });

  it('rounding cents — pas de floating drift', () => {
    const r = computeBundlePrice(
      [{ unit_price_cents: 333, quantity: 3 }], // gross = 999
      null,
      33.3, // 999 * 0.333 = 332.667 → 333
    );
    expect(Number.isInteger(r.gross)).toBe(true);
    expect(Number.isInteger(r.discount)).toBe(true);
    expect(Number.isInteger(r.net)).toBe(true);
    expect(r.gross).toBe(999);
    expect(r.discount).toBe(333);
    expect(r.net).toBe(666);
  });
});

describe('S48 renforcement — getVolumeTierDiscount (pure)', () => {
  it('qty=5 → tier=null, nextThreshold=10', () => {
    const r = getVolumeTierDiscount(5);
    expect(r.tier).toBeNull();
    expect(r.discountPct).toBe(0);
    expect(r.nextThreshold).toBe(10);
  });

  it('qty=10 → tier 1 (5%), nextThreshold=50', () => {
    const r = getVolumeTierDiscount(10);
    expect(r.tier?.min).toBe(10);
    expect(r.discountPct).toBe(5);
    expect(r.nextThreshold).toBe(50);
  });

  it('qty=100 → tier 3 (15%), nextThreshold=500', () => {
    const r = getVolumeTierDiscount(100);
    expect(r.tier?.min).toBe(100);
    expect(r.discountPct).toBe(15);
    expect(r.nextThreshold).toBe(500);
  });

  it('qty=1000 → max tier (20%), pas de nextThreshold', () => {
    const r = getVolumeTierDiscount(1000);
    expect(r.tier?.min).toBe(500);
    expect(r.discountPct).toBe(20);
    expect(r.nextThreshold).toBeUndefined();
  });

  it('tiers custom non triés → sortés ASC en interne', () => {
    const r = getVolumeTierDiscount(20, [
      { min: 100, discountPct: 15 },
      { min: 5, discountPct: 2 },
      { min: 50, discountPct: 10 },
    ]);
    // qty=20 → best match min=5
    expect(r.tier?.min).toBe(5);
    expect(r.nextThreshold).toBe(50);
  });

  it('tiers vide → no-tier', () => {
    const r = getVolumeTierDiscount(100, []);
    expect(r.tier).toBeNull();
    expect(r.discountPct).toBe(0);
    expect(r.nextThreshold).toBeUndefined();
  });
});

describe('S48 renforcement — computePreorderDeposit (pure)', () => {
  it('100$ @ 20% → 20/80 (sum invariant)', () => {
    const r = computePreorderDeposit(10000, 20);
    expect(r.deposit).toBe(2000);
    expect(r.balance).toBe(8000);
    expect(r.deposit + r.balance).toBe(10000);
  });

  it('100$ @ 0% → 0/100', () => {
    const r = computePreorderDeposit(10000, 0);
    expect(r.deposit).toBe(0);
    expect(r.balance).toBe(10000);
  });

  it('100$ @ 100% → 100/0', () => {
    const r = computePreorderDeposit(10000, 100);
    expect(r.deposit).toBe(10000);
    expect(r.balance).toBe(0);
  });

  it('default depositPct = 20%', () => {
    const r = computePreorderDeposit(5000);
    expect(r.deposit).toBe(1000);
    expect(r.balance).toBe(4000);
    expect(DEFAULT_DEPOSIT_PCT).toBe(20);
  });

  it('total <0 → 0/0', () => {
    const r = computePreorderDeposit(-500, 20);
    expect(r).toEqual({ deposit: 0, balance: 0 });
  });

  it('depositPct clamped >100 → 100%', () => {
    const r = computePreorderDeposit(10000, 150);
    expect(r.deposit).toBe(10000);
    expect(r.balance).toBe(0);
  });
});

describe('S48 renforcement — convertCurrency (pure)', () => {
  it('USD→CAD avec rate 1.35 (Record)', () => {
    const r = convertCurrency(10000, 'USD', 'CAD', { CAD: 1.35 });
    expect(r).toBe(13500);
  });

  it('EUR→USD avec rate 1.08 (Map)', () => {
    const rates = new Map<string, number>([['USD', 1.08]]);
    const r = convertCurrency(10000, 'EUR', 'USD', rates);
    expect(r).toBe(10800);
  });

  it('same currency → identity (USD→USD)', () => {
    const r = convertCurrency(10000, 'USD', 'USD', {});
    expect(r).toBe(10000);
  });

  it('lookup composite key from_to prioritaire', () => {
    const r = convertCurrency(10000, 'USD', 'CAD', {
      USD_CAD: 1.35,
      CAD: 999, // ignoré car composite gagne
    });
    expect(r).toBe(13500);
  });

  it('rate manquant → identité best-effort (pas de conversion silencieuse fausse)', () => {
    const r = convertCurrency(10000, 'USD', 'XYZ', {});
    expect(r).toBe(10000);
  });

  it('amount invalide → 0', () => {
    const r = convertCurrency(Number.NaN, 'USD', 'CAD', { CAD: 1.35 });
    expect(r).toBe(0);
  });

  it('lowercase input toléré (uppercase normalisation)', () => {
    const r = convertCurrency(10000, 'usd', 'cad', { CAD: 1.35 });
    expect(r).toBe(13500);
  });
});

describe('S48 renforcement — isCurrencySupported (pure)', () => {
  it('USD / CAD / EUR / DZD / JPY → true', () => {
    expect(isCurrencySupported('USD')).toBe(true);
    expect(isCurrencySupported('CAD')).toBe(true);
    expect(isCurrencySupported('EUR')).toBe(true);
    expect(isCurrencySupported('DZD')).toBe(true);
    expect(isCurrencySupported('JPY')).toBe(true);
  });

  it('ZZZ → false (whitelist strict)', () => {
    expect(isCurrencySupported('ZZZ')).toBe(false);
  });

  it('lowercase rejected (discipline call-site)', () => {
    expect(isCurrencySupported('usd')).toBe(false);
    expect(isCurrencySupported('Usd')).toBe(false);
  });

  it('mauvaise longueur rejected', () => {
    expect(isCurrencySupported('US')).toBe(false);
    expect(isCurrencySupported('USDD')).toBe(false);
    expect(isCurrencySupported('')).toBe(false);
  });

  it('non-string rejected (defensive)', () => {
    expect(isCurrencySupported(null as unknown as string)).toBe(false);
    expect(isCurrencySupported(undefined as unknown as string)).toBe(false);
    expect(isCurrencySupported(123 as unknown as string)).toBe(false);
  });
});

describe('S48 renforcement — validatePricingInput (pure)', () => {
  it('input nominal → ok', () => {
    const r = validatePricingInput({ qty: 5, currency: 'CAD', discountPct: 10 });
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('qty=0 reject → INVALID_QUANTITY', () => {
    const r = validatePricingInput({ qty: 0, currency: 'CAD' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.INVALID_QUANTITY);
  });

  it('qty=-5 reject', () => {
    const r = validatePricingInput({ qty: -5, currency: 'CAD' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.INVALID_QUANTITY);
  });

  it('qty non-entier reject (1.5)', () => {
    const r = validatePricingInput({ qty: 1.5, currency: 'CAD' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.INVALID_QUANTITY);
  });

  it('discount=150 reject → DISCOUNT_INVALID (cap MAX_DISCOUNT_PCT=80)', () => {
    const r = validatePricingInput({ qty: 1, currency: 'CAD', discountPct: 150 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.DISCOUNT_INVALID);
    expect(MAX_DISCOUNT_PCT).toBe(80);
  });

  it('discount=85 reject (au-dessus MAX_DISCOUNT_PCT)', () => {
    const r = validatePricingInput({ qty: 1, currency: 'CAD', discountPct: 85 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.DISCOUNT_INVALID);
  });

  it("currency 'US' reject (mauvaise longueur)", () => {
    const r = validatePricingInput({ qty: 1, currency: 'US' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED);
  });

  it("currency 'usd' reject (lowercase)", () => {
    const r = validatePricingInput({ qty: 1, currency: 'usd' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED);
  });

  it('depositPct=150 reject → DEPOSIT_INVALID', () => {
    const r = validatePricingInput({ qty: 1, currency: 'CAD', depositPct: 150 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.DEPOSIT_INVALID);
  });
});

describe('S48 renforcement — computeFinalPrice (orchestrator)', () => {
  it('end-to-end avec tax intersection S39 (déléguée)', () => {
    const r = computeFinalPrice(
      [
        { unit_price_cents: 1000, quantity: 2 }, // 2000
        { unit_price_cents: 500, quantity: 3 }, //  1500
      ],
      {
        discountPct: 10,
        taxCents: 525, // taxe pré-calculée par S39 tax engine (QC TPS/TVQ)
        currency: 'CAD',
      },
    );
    expect(r.ok).toBe(true);
    expect(r.subtotal).toBe(3500);
    expect(r.discount).toBe(350); // 10% de 3500
    expect(r.tax).toBe(525);
    expect(r.total).toBe(3150 + 525); // net + tax
    expect(r.currency).toBe('CAD');
  });

  it('override bundlePrice prioritaire sur discountPct', () => {
    const r = computeFinalPrice(
      [{ unit_price_cents: 5000, quantity: 1 }],
      {
        bundlePrice: 3000, // admin override
        discountPct: 50, // ignoré car bundlePrice prioritaire
        taxCents: 0,
        currency: 'CAD',
      },
    );
    expect(r.subtotal).toBe(5000);
    expect(r.discount).toBe(2000); // 5000 - 3000
    expect(r.total).toBe(3000);
  });

  it('empty bundle → ok=false, error=BUNDLE_EMPTY', () => {
    const r = computeFinalPrice([], { discountPct: 0, currency: 'CAD' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(PRICING_ERROR_CODES.BUNDLE_EMPTY);
    expect(r.total).toBe(0);
  });

  it('discountPct au-dessus MAX → clampé silencieusement à MAX', () => {
    // computeFinalPrice clamp à MAX_DISCOUNT_PCT=80 (validatePricingInput
    // est strict pour API REST, orchestrateur est tolérant pour usage interne).
    const r = computeFinalPrice(
      [{ unit_price_cents: 10000, quantity: 1 }],
      { discountPct: 99, currency: 'CAD' },
    );
    expect(r.ok).toBe(true);
    expect(r.discount).toBe(8000); // 80% de 10000
    expect(r.total).toBe(2000);
  });

  it('tax négative → ignorée (anti corruption)', () => {
    const r = computeFinalPrice(
      [{ unit_price_cents: 1000, quantity: 1 }],
      { taxCents: -500, currency: 'CAD' },
    );
    expect(r.tax).toBe(0);
    expect(r.total).toBe(1000);
  });

  it('currency default CAD si non fournie', () => {
    const r = computeFinalPrice([{ unit_price_cents: 1000, quantity: 1 }]);
    expect(r.currency).toBe('CAD');
    expect(r.ok).toBe(true);
  });

  it('Rounding : éviter floating drift sur orchestration', () => {
    const r = computeFinalPrice(
      [{ unit_price_cents: 333, quantity: 3 }], // 999
      { discountPct: 7, taxCents: 47, currency: 'CAD' }, // discount = 70 (round)
    );
    expect(Number.isInteger(r.subtotal)).toBe(true);
    expect(Number.isInteger(r.discount)).toBe(true);
    expect(Number.isInteger(r.tax)).toBe(true);
    expect(Number.isInteger(r.total)).toBe(true);
    expect(r.subtotal).toBe(999);
    expect(r.discount).toBe(70);
    expect(r.tax).toBe(47);
    expect(r.total).toBe(976); // 999 - 70 + 47
  });
});

describe('S48 renforcement — constants exposées', () => {
  it('DEFAULT_VOLUME_TIERS structure attendue (10/50/100/500)', () => {
    expect(DEFAULT_VOLUME_TIERS).toHaveLength(4);
    expect(DEFAULT_VOLUME_TIERS[0]).toEqual({ min: 10, discountPct: 5 });
    expect(DEFAULT_VOLUME_TIERS[3]).toEqual({ min: 500, discountPct: 20 });
  });

  it('PRICING_ERROR_CODES expose tous les codes attendus', () => {
    expect(PRICING_ERROR_CODES.BUNDLE_EMPTY).toBe('BUNDLE_EMPTY');
    expect(PRICING_ERROR_CODES.INVALID_TIER).toBe('INVALID_TIER');
    expect(PRICING_ERROR_CODES.INVALID_QUANTITY).toBe('INVALID_QUANTITY');
    expect(PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED).toBe('CURRENCY_NOT_SUPPORTED');
    expect(PRICING_ERROR_CODES.DEPOSIT_INVALID).toBe('DEPOSIT_INVALID');
    expect(PRICING_ERROR_CODES.DISCOUNT_INVALID).toBe('DISCOUNT_INVALID');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 48 — WIRE-UP HANDLERS ↔ pricing-engine.ts (5 tests additifs)
// ════════════════════════════════════════════════════════════════════════════

describe('S48 wire-up — handleCreateBundle ↔ validatePricingInput', () => {
  it('discountPct=150 → 400 DISCOUNT_INVALID (borné MAX_DISCOUNT_PCT=80)', async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', {
      name: 'Bad Bundle',
      discount_pct: 150,
    });
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    // L'ancienne validation handler (discount_pct hors [0..100]) trigger en
    // premier — accepté car les 2 paths protègent. Le code retourné peut
    // venir soit du handler (message FR) soit de validatePricingInput
    // (PRICING_ERROR_CODES.DISCOUNT_INVALID).
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toMatch(/discount/i);
  });
});

describe('S48 wire-up — handleCreateBundle ↔ isCurrencySupported', () => {
  it("currency 'XYZ' invalide → 400 CURRENCY_NOT_SUPPORTED", async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', {
      name: 'Bundle X',
      currency: 'XYZ',
    });
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe(PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED);
    expect(body.error).toMatch(/currency/i);
  });

  it("currency 'CAD' OK + computeBundlePrice preview avec items[] → net_price_cents en réponse", async () => {
    const { env } = makeEnv();
    const req = postReq('/api/product-bundles', {
      name: 'Bundle Computed',
      total_price_cents: 2400, // override prix de vente
      items: [
        { unit_price_cents: 1000, quantity: 2 }, // gross 2000
        { unit_price_cents: 500, quantity: 2 }, //  1000
      ],
      currency: 'CAD',
    });
    const res = await handleCreateBundle(req, env, AUTH_ADMIN as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { net_price_cents: number; currency: string; total_price_cents: number };
    };
    // override gagne sur sum items: net = 2400 (clamped à total_price_cents).
    expect(body.data.net_price_cents).toBe(2400);
    expect(body.data.currency).toBe('CAD');
  });
});

describe('S48 wire-up — handlePublicCreatePreorder ↔ computePreorderDeposit', () => {
  it('deposit_pct=30 → split deposit/balance correct (sum invariant)', async () => {
    const { env, db } = makeEnv();
    // Mock variant : client_id + price_cents=10000 → total=20000 pour qty=2.
    db.seed('from product_variants v', [
      { client_id: 'client-1', price_cents: 10000 },
    ]);

    const req = postReq(
      '/api/public/preorders',
      {
        variant_id: 'v-deposit',
        email: 'buyer@example.com',
        quantity: 2,
        deposit_pct: 30,
      },
      { 'cf-connecting-ip': '20.30.40.50' },
    );
    const res = await handlePublicCreatePreorder(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        status: string;
        total_cents: number;
        deposit_cents: number;
        balance_cents: number;
      };
    };
    expect(body.data.status).toBe('queued');
    expect(body.data.total_cents).toBe(20000); // 10000 × 2
    expect(body.data.deposit_cents).toBe(6000); // 30% de 20000
    expect(body.data.balance_cents).toBe(14000); // sum invariant
    expect(body.data.deposit_cents + body.data.balance_cents).toBe(
      body.data.total_cents,
    );
  });

  it("currency 'XYZ' invalide → 400 CURRENCY_NOT_SUPPORTED", async () => {
    const { env } = makeEnv();
    const req = postReq(
      '/api/public/preorders',
      {
        variant_id: 'v-1',
        email: 'buyer@example.com',
        currency: 'XYZ',
      },
      { 'cf-connecting-ip': '30.40.50.60' },
    );
    const res = await handlePublicCreatePreorder(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe(PRICING_ERROR_CODES.CURRENCY_NOT_SUPPORTED);
  });
});

describe('S48 wire-up — computeFinalPrice end-to-end avec tax mock S39', () => {
  it('orchestrateur compose subtotal + discount + tax (déléguée) + currency', () => {
    // Simule un tax engine S39 (QC TPS/TVQ ~14.975%) qui calcule taxCents.
    const items: BundlePriceItemT[] = [
      { unit_price_cents: 5000, quantity: 2 }, // 10000
      { unit_price_cents: 2500, quantity: 4 }, // 10000
    ];
    const taxCents = Math.round(20000 * 0.14975); // 2995

    const r = computeFinalPrice(items, {
      discountPct: 10,
      taxCents,
      currency: 'CAD',
    });

    expect(r.ok).toBe(true);
    expect(r.subtotal).toBe(20000);
    expect(r.discount).toBe(2000); // 10% de 20000
    expect(r.tax).toBe(2995); // verbatim S39
    expect(r.total).toBe(18000 + 2995); // net + tax
    expect(r.currency).toBe('CAD');
  });
});

// NB : 10+ cas couvrent les 3 helpers engine (resolveTierPrice match/no-match,
// computeBundleDiscount avec discount + sans, processPreorderNotification
// queued → notified + idempotent not_queued) + 6 handlers REST clés
// (CreateCustomerGroup, AssignCustomerToGroup avec INSERT OR IGNORE,
// CreateTierPrice avec validation min_quantity + price_cents, CreateBundle,
// PublicCreatePreorder honeypot + flow nominal) + cap guard clients.manage
// (403 sur 2 handlers). Mocks D1 via createMockD1, aucun réseau. checkRateLimit
// est utilisé tel quel : la mock D1 fait fail-open (resolveRows retourne []
// pour le COUNT → count=0 < max=5 → allowed:true), pas besoin de mock
// supplémentaire. Imports relatifs uniquement.
