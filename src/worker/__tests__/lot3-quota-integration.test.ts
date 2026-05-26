// ── lot3-quota-integration.test.ts — LOT 3 SaaS M2 (2026-05-18) ─────────────
//
// Couvre le WIRING de requireQuota aux points d'enforcement (§6.16) + la
// route lecture §6.15. Complète lot3-quota.test.ts (M1, requireQuota unitaire).
//
//   - Sous-compte : quota dépassé ⇒ 403 QUOTA_EXCEEDED, batch (INSERT clients
//     / user_sub_accounts) JAMAIS exécuté.
//   - Sous-compte : sous quota ⇒ 201, batch exécuté.
//   - Lead client legacy (agency_id NULL) ⇒ 201, JAMAIS 403, INSERT présent,
//     AUCUNE requête quota émise (garde-fou #1 ABSOLU, byte-identique legacy).
//   - Lead client d'agence, quota dépassé ⇒ 403 QUOTA_EXCEEDED, INSERT absent.
//   - GET /api/agency/plan : non-agency ⇒ 403 AGENCY_ONLY.
//   - GET /api/agency/plan : agency ⇒ 200 shape { data:{plan,limits,usage} },
//     Infinity (unlimited) sérialisé en null.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — PAS d'extension). POST
// sous-compte utilise env.DB.batch([...]) ⇒ on ajoute un `batch` AD-HOC INLINE
// (pattern lot2-agency-subaccounts.test.ts) qui exécute chaque statement
// (.run() trace dans db.calls). Sous-chaînes seed discriminantes :
//   - 'from subscriptions'                 → SELECT plan_name actif agence
//   - 'from clients where agency_id'       → COUNT subAccounts (requireQuota
//                                            + GET plan : SQL identique)
//   - 'from clients where id'              → SELECT client (handleCreateLead)
//   - 'from leads where client_id in'      → COUNT leads (requireQuota + plan)
//   - 'from user_sub_accounts where client'→ COUNT users (GET plan)

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1, type MockD1 } from './_helpers';
import { handleCreateAgencySubAccount, handleGetAgencyPlan } from '../saas';
import { handleCreateLead } from '../leads';

// batch ad-hoc (mock figé sans batch) : exécute .run() de chaque statement
// (déjà tracé dans db.calls via prepare().bind().run()).
function withBatch(db: MockD1): MockD1 & {
  batch: (stmts: Array<{ run: () => unknown }>) => Promise<unknown[]>;
} {
  return Object.assign(db, {
    async batch(stmts: Array<{ run: () => unknown }>) {
      return stmts.map((s) => s.run());
    },
  });
}

function makeEnv(db = createMockD1()) {
  const wired = withBatch(db);
  return { env: { DB: wired } as unknown as Env, db: wired };
}

const AGENCY_AUTH = {
  userId: 'u1',
  role: 'admin',
  tenant: {
    userId: 'u1',
    role: 'admin',
    clientId: 'client-1',
    agencyId: 'ag-1',
    accountLevel: 'agency',
    accessibleClientIds: ['client-1'],
  },
};

const NON_AGENCY_AUTH = {
  userId: 'u2',
  role: 'admin',
  tenant: {
    userId: 'u2',
    role: 'admin',
    clientId: 'client-9',
    agencyId: null,
    accountLevel: 'user',
    accessibleClientIds: ['client-9'],
  },
};

function subAccountPost(body: unknown): Request {
  return new Request('https://x/api/agency/sub-accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function leadPost(body: unknown): Request {
  return new Request('https://x/api/leads', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ───────────────────────────────────────────────────────────────────────────
describe('§6.16(a) — guard sous-compte (handleCreateAgencySubAccount)', () => {
  it('quota subAccounts dépassé (free=2, déjà 2) ⇒ 403 QUOTA_EXCEEDED, batch NON exécuté', async () => {
    const { env, db } = makeEnv();
    // plan actif = free (limite subAccounts = 2)
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    // COUNT subAccounts agence = 2 ⇒ count >= limit ⇒ 403
    db.seed('from clients where agency_id', [{ n: 2 }]);

    const res = await handleCreateAgencySubAccount(
      subAccountPost({ name: 'Sous-compte 3', email: 'x@y.co' }),
      env,
      AGENCY_AUTH,
    );

    expect(res.status).toBe(403);
    const j = (await res.json()) as { code: string; kind: string };
    expect(j.code).toBe('QUOTA_EXCEEDED');
    expect(j.kind).toBe('subAccounts');

    // Garde AVANT le batch : aucun INSERT clients / user_sub_accounts émis.
    const inserted = db.calls.filter(
      (c) =>
        /insert into clients/i.test(c.sql) ||
        /insert into user_sub_accounts/i.test(c.sql),
    );
    expect(inserted).toHaveLength(0);
  });

  it('sous quota (free=2, déjà 1) ⇒ 201, batch exécuté (INSERT clients + jonction)', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    db.seed('from clients where agency_id', [{ n: 1 }]);

    const res = await handleCreateAgencySubAccount(
      subAccountPost({ name: 'Sous-compte 2', email: 'a@b.co' }),
      env,
      AGENCY_AUTH,
    );

    expect(res.status).toBe(201);
    const j = (await res.json()) as { data: { id: string } };
    expect(typeof j.data.id).toBe('string');

    const clientInsert = db.calls.find((c) => /insert into clients/i.test(c.sql));
    const junctionInsert = db.calls.find((c) =>
      /insert into user_sub_accounts/i.test(c.sql),
    );
    expect(clientInsert).toBeTruthy();
    expect(junctionInsert).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§6.16(b) — guard lead (handleCreateLead)', () => {
  const validLead = {
    client_id: 'client-x',
    name: 'Jean Tremblay',
    email: 'jean@exemple.qc',
  };

  it('GARDE-FOU #1 ABSOLU : client legacy (agency_id NULL) ⇒ 201, JAMAIS 403, INSERT présent, 0 requête quota', async () => {
    const { env, db } = makeEnv();
    // SELECT client : trouvé, agency_id NULL ⇒ flux legacy mono-tenant.
    db.seed('from clients where id', [{ id: 'client-x', agency_id: null }]);
    // pas de doublon (dedup SELECT leads ... LOWER(email))
    db.seed('lower(email) = ?', []);

    const res = await handleCreateLead(leadPost(validLead), env, {
      role: 'admin',
      userId: 'u1',
    });

    expect(res.status).toBe(201);
    const j = (await res.json()) as { data: { id: string } };
    expect(typeof j.data.id).toBe('string');

    // INSERT lead bien présent (comportement byte-identique actuel).
    const leadInsert = db.calls.find((c) => /insert into leads/i.test(c.sql));
    expect(leadInsert).toBeTruthy();

    // Garde-fou #1 : agency_id NULL ⇒ requireQuota return null AVANT toute
    // requête D1 ⇒ AUCUN SELECT subscriptions ni COUNT quota émis.
    const quotaQueries = db.calls.filter(
      (c) =>
        /from subscriptions/i.test(c.sql) ||
        /count\(\*\)\s+as\s+n\s+from leads where client_id in/i.test(c.sql),
    );
    expect(quotaQueries).toHaveLength(0);
  });

  it("client d'agence, quota leads dépassé (free=500, déjà 500) ⇒ 403 QUOTA_EXCEEDED, INSERT lead absent", async () => {
    const { env, db } = makeEnv();
    // SELECT client : trouvé, rattaché à une agence.
    db.seed('from clients where id', [{ id: 'client-x', agency_id: 'ag-1' }]);
    // plan free ⇒ maxLeads = 500
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    // COUNT leads agence = 500 ⇒ count >= limit ⇒ 403
    db.seed('from leads where client_id in', [{ n: 500 }]);

    const res = await handleCreateLead(leadPost(validLead), env, {
      role: 'admin',
      userId: 'u1',
    });

    expect(res.status).toBe(403);
    const j = (await res.json()) as { code: string; kind: string };
    expect(j.code).toBe('QUOTA_EXCEEDED');
    expect(j.kind).toBe('leads');

    // Garde AVANT l'INSERT : aucun INSERT lead émis.
    const leadInsert = db.calls.find((c) => /insert into leads/i.test(c.sql));
    expect(leadInsert).toBeFalsy();
  });

  it("client d'agence, sous quota leads ⇒ 201, INSERT lead présent", async () => {
    const { env, db } = makeEnv();
    db.seed('from clients where id', [{ id: 'client-x', agency_id: 'ag-1' }]);
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    db.seed('from leads where client_id in', [{ n: 10 }]);
    db.seed('lower(email) = ?', []);

    const res = await handleCreateLead(leadPost(validLead), env, {
      role: 'admin',
      userId: 'u1',
    });

    expect(res.status).toBe(201);
    const leadInsert = db.calls.find((c) => /insert into leads/i.test(c.sql));
    expect(leadInsert).toBeTruthy();
  });

  it('client introuvable ⇒ 404 (guard quota jamais atteint)', async () => {
    const { env, db } = makeEnv();
    db.seed('from clients where id', []); // client absent

    const res = await handleCreateLead(leadPost(validLead), env, {
      role: 'admin',
      userId: 'u1',
    });

    expect(res.status).toBe(404);
    const quotaQueries = db.calls.filter((c) =>
      /from subscriptions/i.test(c.sql),
    );
    expect(quotaQueries).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§6.15 — GET /api/agency/plan (handleGetAgencyPlan)', () => {
  it('non-agency (agencyId null / accountLevel user) ⇒ 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleGetAgencyPlan(env, NON_AGENCY_AUTH);
    expect(res.status).toBe(403);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('AGENCY_ONLY');
  });

  it('tenant absent ⇒ 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleGetAgencyPlan(env, { userId: 'u1', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('agency plan free ⇒ 200 shape { data:{plan,limits,usage} } avec usage réel', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions', [{ plan_name: 'free' }]);
    // ⚠ Ordre critique : les SQL COUNT leads/users contiennent un sous-SELECT
    // `FROM clients WHERE agency_id`, donc le needle 'from clients where agency_id'
    // doit être inséré APRÈS les needles plus spécifiques (1er match gagne dans _helpers.ts).
    db.seed('from leads where client_id in', [{ n: 42 }]);
    db.seed('from user_sub_accounts where client', [{ n: 3 }]);
    db.seed('from clients where agency_id', [{ n: 1 }]);

    const res = await handleGetAgencyPlan(env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      data: {
        plan: string;
        limits: { maxSubAccounts: number | null; maxLeads: number | null; maxUsers: number | null };
        usage: { subAccounts: number; leads: number; users: number };
      };
    };
    expect(j.data.plan).toBe('free');
    expect(j.data.limits).toEqual({ maxSubAccounts: 2, maxLeads: 500, maxUsers: 3 });
    expect(j.data.usage).toEqual({ subAccounts: 1, leads: 42, users: 3 });
  });

  it('plan unlimited ⇒ limites Infinity sérialisées en null (UI = illimité)', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions', [{ plan_name: 'unlimited' }]);
    db.seed('from leads where client_id in', [{ n: 99999 }]);
    db.seed('from user_sub_accounts where client', [{ n: 50 }]);
    db.seed('from clients where agency_id', [{ n: 7 }]);

    const res = await handleGetAgencyPlan(env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      data: { limits: { maxSubAccounts: number | null; maxLeads: number | null; maxUsers: number | null } };
    };
    // Infinity n'est PAS JSON-valide ⇒ mappé null.
    expect(j.data.limits).toEqual({
      maxSubAccounts: null,
      maxLeads: null,
      maxUsers: null,
    });
  });

  it('abonnement absent ⇒ fallback plan free', async () => {
    const { env, db } = makeEnv();
    db.seed('from subscriptions', []); // aucun abonnement actif
    db.seed('from leads where client_id in', [{ n: 0 }]);
    db.seed('from user_sub_accounts where client', [{ n: 0 }]);
    db.seed('from clients where agency_id', [{ n: 0 }]);

    const res = await handleGetAgencyPlan(env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      data: { plan: string; limits: { maxSubAccounts: number | null } };
    };
    expect(j.data.plan).toBe('free');
    expect(j.data.limits.maxSubAccounts).toBe(2);
  });
});
