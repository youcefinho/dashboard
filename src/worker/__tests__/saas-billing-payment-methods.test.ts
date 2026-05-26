// ── saas-billing-payment-methods.test.ts — Sprint 31 Agent A4 ───────────────
//
// Couvre les 4 handlers Payment Methods (list / setup-intent / set-default /
// delete) du module saas-billing-payment-methods.ts. Les calls live
// (createSetupIntent, setDefaultPaymentMethod, detachPaymentMethod) sont
// mockées via vi.mock('../lib/saas-billing-live', ...).
//
// Contrats vérifiés :
//   1. handleListPaymentMethods SELECT par agency_id (cross-tenant safe).
//   2. handleCreateSetupIntent retourne clientSecret + setupIntentId.
//   3. handleSetDefaultPaymentMethod UPDATE is_default=1 sur cible + 0 sur autres.
//   4. handleDeletePaymentMethod DELETE D1 + call detachPaymentMethod Stripe.
//   5. 404 PM_NOT_FOUND si pmId inexistant (set-default / delete).
//   6. 403 AGENCY_ONLY si pas tenant (mutations).
//   7. 503 STRIPE_NOT_CONFIGURED si STRIPE absent (mutations).
//   8. List avec aucune row → data: [].

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';

// ── Mock du module live (Agent A1, parallel sprint) ──────────────────────────
// NB : vi.mock est hoisté au-dessus des imports. Pour partager des `vi.fn`
// entre la factory et les tests, on déclare via `vi.hoisted()` qui s'exécute
// aussi en tête (calque pattern officiel vitest 1.x+).
const {
  mockCreateSetupIntent,
  mockSetDefaultPaymentMethod,
  mockDetachPaymentMethod,
  mockFindOrCreateStripeCustomer,
} = vi.hoisted(() => ({
  mockCreateSetupIntent: vi.fn(async (_env: unknown, _customerId: string, _idem?: string) => ({
    id: 'seti_xyz',
    object: 'setup_intent',
    client_secret: 'seti_xyz_secret_abc',
    status: 'requires_payment_method',
  })),
  mockSetDefaultPaymentMethod: vi.fn(async (_env: unknown, _customerId: string, _pmId: string) => ({
    id: _customerId,
    invoice_settings: { default_payment_method: _pmId },
  })),
  mockDetachPaymentMethod: vi.fn(async (_env: unknown, pmId: string) => ({
    id: pmId,
    object: 'payment_method',
    customer: null,
  })),
  // findOrCreateStripeCustomer : mock simple — renvoie un customer id
  // déterministe pour les tests (l'impl prod cherche en D1 puis crée via Stripe).
  mockFindOrCreateStripeCustomer: vi.fn(async (_env: unknown, _agencyId: string, _email?: string) => 'cus_test_xyz'),
}));

vi.mock('../lib/saas-billing-live', () => ({
  isLiveBranchEnabled: vi.fn((env: { STRIPE_SECRET_KEY?: string }) => {
    const k = env?.STRIPE_SECRET_KEY ?? '';
    return k.startsWith('sk_live_') || k.startsWith('sk_test_');
  }),
  createSetupIntent: mockCreateSetupIntent,
  setDefaultPaymentMethod: mockSetDefaultPaymentMethod,
  detachPaymentMethod: mockDetachPaymentMethod,
  findOrCreateStripeCustomer: mockFindOrCreateStripeCustomer,
}));

import {
  handleListPaymentMethods,
  handleCreateSetupIntent,
  handleSetDefaultPaymentMethod,
  handleDeletePaymentMethod,
} from '../saas-billing-payment-methods';

type Auth = {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

const AUTH_AGENCY: Auth = {
  userId: 'user-1',
  role: 'admin',
  clientId: 'client-1',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['billing.view', 'settings.manage']),
};

const AUTH_NO_TENANT: Auth = { userId: 'user-x', role: 'admin' };

function makeEnv(opts?: { stripeKey?: string }) {
  const db = createMockD1();
  return {
    env: {
      DB: db,
      STRIPE_SECRET_KEY: opts?.stripeKey,
    } as unknown as Env,
    db,
  };
}

function req(path: string, method: 'POST' | 'DELETE', body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// 1. handleListPaymentMethods
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleListPaymentMethods', () => {
  it('SELECT par agency_id (cross-tenant safe), retourne rows mappés', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('from payment_methods where agency_id', [
      {
        id: 'pm-row-1',
        agency_id: 'agency-1',
        stripe_payment_method_id: 'pm_xyz',
        stripe_customer_id: 'cus_xyz',
        type: 'card',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2028,
        is_default: 1,
        created_at: '2026-05-22T10:00:00Z',
      },
    ]);
    const res = await handleListPaymentMethods(env, AUTH_AGENCY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ stripePaymentMethodId: string; brand: string; last4: string; isDefault: boolean }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].stripePaymentMethodId).toBe('pm_xyz');
    expect(body.data[0].brand).toBe('visa');
    expect(body.data[0].last4).toBe('4242');
    expect(body.data[0].isDefault).toBe(true);
    // SQL bind contient agency-1 (cross-tenant safety)
    const select = db.calls.find((c) => /from payment_methods where agency_id/i.test(c.sql));
    expect(select).toBeTruthy();
    expect(select!.args[0]).toBe('agency-1');
  });

  it('aucune row → data: []', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleListPaymentMethods(env, AUTH_AGENCY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('pas de tenant → data: []', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleListPaymentMethods(env, AUTH_NO_TENANT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. handleCreateSetupIntent
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleCreateSetupIntent', () => {
  it('retourne clientSecret + setupIntentId', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleCreateSetupIntent(
      req('/api/billing/payment-methods/setup-intent', 'POST', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { clientSecret: string; setupIntentId: string };
    };
    expect(body.data.clientSecret).toBe('seti_xyz_secret_abc');
    expect(body.data.setupIntentId).toBe('seti_xyz');
    // createSetupIntent reçoit (env, customerId, idempotencyKey) — customer
    // résolu par findOrCreateStripeCustomer (mocké → 'cus_test_xyz').
    expect(mockCreateSetupIntent).toHaveBeenCalled();
    expect(mockFindOrCreateStripeCustomer).toHaveBeenCalledWith(expect.anything(), 'agency-1', expect.anything());
  });

  it('403 AGENCY_ONLY si pas tenant', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleCreateSetupIntent(
      req('/api/billing/payment-methods/setup-intent', 'POST', {}),
      env,
      AUTH_NO_TENANT,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AGENCY_ONLY');
  });

  it('503 STRIPE_NOT_CONFIGURED si STRIPE absent', async () => {
    const { env } = makeEnv();
    const res = await handleCreateSetupIntent(
      req('/api/billing/payment-methods/setup-intent', 'POST', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. handleSetDefaultPaymentMethod
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleSetDefaultPaymentMethod', () => {
  it('UPDATE is_default=1 sur cible + 0 sur autres', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('select stripe_customer_id from payment_methods where agency_id', [
      { stripe_customer_id: 'cus_xyz' },
    ]);
    const res = await handleSetDefaultPaymentMethod(
      req('/api/billing/payment-methods/pm_xyz/default', 'POST', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { stripePaymentMethodId: string; isDefault: boolean } };
    expect(body.data.stripePaymentMethodId).toBe('pm_xyz');
    expect(body.data.isDefault).toBe(true);

    // 1er UPDATE : reset all is_default=0 par agency_id
    const reset = db.calls.find(
      (c) => /update payment_methods set is_default = 0/i.test(c.sql),
    );
    expect(reset).toBeTruthy();
    expect(reset!.args).toContain('agency-1');

    // 2e UPDATE : set is_default=1 sur le PM cible
    const setOne = db.calls.find(
      (c) =>
        /update payment_methods set is_default = 1/i.test(c.sql) &&
        /stripe_payment_method_id = \?/i.test(c.sql),
    );
    expect(setOne).toBeTruthy();
    expect(setOne!.args).toEqual(['agency-1', 'pm_xyz']);

    // Stripe call
    expect(mockSetDefaultPaymentMethod).toHaveBeenCalledWith(expect.anything(), 'cus_xyz', 'pm_xyz');
  });

  it('404 PM_NOT_FOUND si pmId inexistant', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    // first() retourne null → PM introuvable
    const res = await handleSetDefaultPaymentMethod(
      req('/api/billing/payment-methods/pm_missing/default', 'POST', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PM_NOT_FOUND');
  });

  it('403 AGENCY_ONLY si pas tenant', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleSetDefaultPaymentMethod(
      req('/api/billing/payment-methods/pm_xyz/default', 'POST', {}),
      env,
      AUTH_NO_TENANT,
    );
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. handleDeletePaymentMethod
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleDeletePaymentMethod', () => {
  it('DELETE D1 + call detachPaymentMethod Stripe', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('select id from payment_methods where agency_id', [{ id: 'pm-row-1' }]);
    const res = await handleDeletePaymentMethod(
      req('/api/billing/payment-methods/pm_xyz', 'DELETE'),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);

    // DELETE FROM payment_methods émis
    const del = db.calls.find((c) => /delete from payment_methods/i.test(c.sql));
    expect(del).toBeTruthy();
    expect(del!.args).toEqual(['agency-1', 'pm_xyz']);

    // Stripe detach appelé
    expect(mockDetachPaymentMethod).toHaveBeenCalledWith(expect.anything(), 'pm_xyz');
  });

  it('404 PM_NOT_FOUND si pmId inexistant', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    // first() retourne null → PM introuvable
    const res = await handleDeletePaymentMethod(
      req('/api/billing/payment-methods/pm_missing', 'DELETE'),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('PM_NOT_FOUND');
    // detach NON appelé si row absente
    expect(mockDetachPaymentMethod).not.toHaveBeenCalled();
  });
});
