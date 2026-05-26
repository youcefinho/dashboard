// ── saas-billing-connect.test.ts — Sprint 31 Agent A4 ───────────────────────
//
// Couvre les 2 handlers Stripe Connect (onboard / status) du module
// saas-billing-connect.ts. Les calls live (createConnectAccount,
// createConnectAccountLink, retrieveConnectAccount) sont mockées via
// vi.mock('../lib/saas-billing-live', ...).
//
// Contrats vérifiés :
//   1. handleConnectOnboard crée account si absent → INSERT + retourne link URL.
//   2. handleConnectOnboard réutilise account existant (pas de INSERT).
//   3. handleConnectStatus null si aucune row D1.
//   4. handleConnectStatus shape mappée si row existe (sans refresh si STRIPE absent).
//   5. Cross-tenant : agency A ne voit pas account agency B.
//   6. 403 AGENCY_ONLY si pas tenant.
//   7. 503 STRIPE_NOT_CONFIGURED si STRIPE absent (mutations).
//   8. Audit log émis côté onboard.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';

// ── Mock du module live (Agent A1, parallel sprint) ──────────────────────────
vi.mock('../lib/saas-billing-live', () => ({
  isLiveBranchEnabled: vi.fn((env: { STRIPE_SECRET_KEY?: string }) => {
    const k = env?.STRIPE_SECRET_KEY ?? '';
    return k.startsWith('sk_live_') || k.startsWith('sk_test_');
  }),
  createConnectAccount: vi.fn(async (_env: unknown, _clientId: string, _email: string, _country: string) => ({
    id: 'acct_new',
    object: 'account',
    type: 'express',
  })),
  createConnectAccountLink: vi.fn(async (_env: unknown, accountId: string, refreshUrl: string, returnUrl: string) => ({
    object: 'account_link',
    url: `https://connect.stripe.com/setup/c/${accountId}`,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    created: Math.floor(Date.now() / 1000),
    refreshUrl,
    returnUrl,
  })),
  retrieveConnectAccount: vi.fn(async (_env: unknown, accountId: string) => ({
    id: accountId,
    object: 'account',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: 'active' },
    requirements: { currently_due: [], eventually_due: [], past_due: [] },
  })),
}));

import {
  handleConnectOnboard,
  handleConnectStatus,
} from '../saas-billing-connect';

type ConnectAuth = {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

const AUTH_AGENCY: ConnectAuth = {
  userId: 'user-1',
  role: 'admin',
  clientId: 'client-1',
  tenant: { agencyId: 'agency-1', accessibleClientIds: ['client-1'] },
  capabilities: new Set(['billing.view', 'settings.manage']),
};

const AUTH_NO_TENANT: ConnectAuth = {
  userId: 'user-x',
  role: 'admin',
};

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

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// 1. handleConnectOnboard
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleConnectOnboard', () => {
  it('crée account si pas existant → INSERT + retourne link URL', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    // user email lookup
    db.seed('select email from users where id', [{ email: 'admin@agency.io' }]);
    // pas de row stripe_connect_accounts → first() retourne null par défaut

    const res = await handleConnectOnboard(
      postReq('/api/billing/connect/onboard', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { url: string; expiresAt: string } };
    expect(body.data.url).toMatch(/connect\.stripe\.com\/setup/);
    expect(typeof body.data.expiresAt).toBe('string');

    // INSERT stripe_connect_accounts émis
    const insert = db.calls.find((c) => /insert into stripe_connect_accounts/i.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.args).toContain('client-1');
    expect(insert!.args).toContain('acct_new');
  });

  it('réutilise account existant (pas de INSERT)', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('select stripe_account_id from stripe_connect_accounts where client_id', [
      { stripe_account_id: 'acct_existing' },
    ]);
    const res = await handleConnectOnboard(
      postReq('/api/billing/connect/onboard', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { url: string } };
    expect(body.data.url).toContain('acct_existing');
    const insert = db.calls.find((c) => /insert into stripe_connect_accounts/i.test(c.sql));
    expect(insert).toBeFalsy();
  });

  it('403 AGENCY_ONLY si pas clientId (pas tenant)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleConnectOnboard(
      postReq('/api/billing/connect/onboard', {}),
      env,
      AUTH_NO_TENANT,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AGENCY_ONLY');
  });

  it('503 STRIPE_NOT_CONFIGURED si STRIPE_SECRET_KEY absent', async () => {
    const { env } = makeEnv(); // pas de stripeKey
    const res = await handleConnectOnboard(
      postReq('/api/billing/connect/onboard', {}),
      env,
      AUTH_AGENCY,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('audit log émis sur succès', async () => {
    const { env, db } = makeEnv({ stripeKey: 'sk_test_xxx' });
    db.seed('select email from users where id', [{ email: 'admin@agency.io' }]);
    await handleConnectOnboard(postReq('/api/billing/connect/onboard', {}), env, AUTH_AGENCY);
    const audit = db.calls.find((c) => /insert into audit_log/i.test(c.sql));
    expect(audit).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. handleConnectStatus
// ──────────────────────────────────────────────────────────────────────────

describe('S31 — handleConnectStatus', () => {
  it('retourne null si aucun account', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    // first() retourne null → pas de row stripe_connect_accounts
    const res = await handleConnectStatus(env, AUTH_AGENCY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toBeNull();
  });

  it('retourne null si pas clientId (pas tenant)', async () => {
    const { env } = makeEnv({ stripeKey: 'sk_test_xxx' });
    const res = await handleConnectStatus(env, AUTH_NO_TENANT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toBeNull();
  });

  it('retourne mappé si row existe (sans refresh si STRIPE absent)', async () => {
    const { env, db } = makeEnv(); // pas de stripeKey → pas de refresh live
    db.seed('from stripe_connect_accounts where client_id', [
      {
        id: 'r1',
        client_id: 'client-1',
        stripe_account_id: 'acct_xyz',
        account_type: 'express',
        charges_enabled: 1,
        payouts_enabled: 1,
        details_submitted: 1,
        capabilities_json: '{"card_payments":"active"}',
        requirements_json: '{"currently_due":[],"eventually_due":[],"past_due":[]}',
        onboarding_completed_at: '2026-05-22T10:00:00Z',
      },
    ]);
    const res = await handleConnectStatus(env, AUTH_AGENCY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        stripeAccountId: string;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        accountType: string;
      };
    };
    expect(body.data.stripeAccountId).toBe('acct_xyz');
    expect(body.data.chargesEnabled).toBe(true);
    expect(body.data.payoutsEnabled).toBe(true);
    expect(body.data.detailsSubmitted).toBe(true);
    expect(body.data.accountType).toBe('express');
  });

  it('cross-tenant : agency A ne voit pas account agency B', async () => {
    const { env, db } = makeEnv();
    // Row uniquement pour client-other, AUTH a clientId='client-1'
    db.seed('from stripe_connect_accounts where client_id', []);
    const res = await handleConnectStatus(env, AUTH_AGENCY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toBeNull();
    // SQL doit avoir client-1 en bind (cross-tenant safe)
    const select = db.calls.find((c) => /from stripe_connect_accounts where client_id/i.test(c.sql));
    expect(select).toBeTruthy();
    expect(select!.args[0]).toBe('client-1');
  });
});
