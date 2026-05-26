// ── lot2-agency-subaccounts.test.ts — LOT 2 SaaS M1 (2026-05-18) ───────────
//
// Couvre GET/POST /api/agency/sub-accounts (CONTRAT §6.9 / §6.10) :
//   - GET non-agency (accountLevel !== 'agency' OU agencyId null) ⇒ 403 AGENCY_ONLY
//   - GET : liste filtrée par agency_id (clause WHERE agency_id = ?)
//   - GARDE-FOU anti-bypass : aucune requête leads/tasks SANS clause
//     client_id IN (...) ; les COUNT(*) sont bornés aux ids de l'agence
//   - GET 0 sous-compte ⇒ AUCUNE requête métier leads/tasks émise
//   - POST non-agency ⇒ 403 AGENCY_ONLY
//   - POST name vide ⇒ 400 INVALID_INPUT
//   - POST crée clients + jonction user_sub_accounts (batch) + audit
//     'agency.subaccount.create'
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — PAS de batch). POST §6.10
// utilise env.DB.batch([...]) : on ajoute un `batch` AD-HOC INLINE sur le
// mock (sans étendre _helpers, conformément aux garde-fous M1) qui exécute
// chaque statement (.run()) → les INSERT sont tracés dans db.calls.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1, type MockD1 } from './_helpers';
import {
  handleGetAgencySubAccounts,
  handleCreateAgencySubAccount,
} from '../saas';

// Ajoute un batch ad-hoc au mock figé : exécute .run() de chaque statement
// (chaque statement est déjà tracé dans db.calls via prepare().bind().run()).
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
    accessibleClientIds: ['client-1', 'client-2'],
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

function postReq(body: unknown): Request {
  return new Request('https://x/api/agency/sub-accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('GET /api/agency/sub-accounts — CONTRAT §6.9', () => {
  it('non-agency (agencyId null / accountLevel user) ⇒ 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleGetAgencySubAccounts(env, NON_AGENCY_AUTH);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('AGENCY_ONLY');
  });

  it('tenant absent ⇒ 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleGetAgencySubAccounts(env, {
      userId: 'u1',
      role: 'admin',
    });
    expect(res.status).toBe(403);
  });

  it('liste filtrée agency_id + métriques RÉELLES bornées client_id', async () => {
    const { env, db } = makeEnv();
    db.seed('from clients where agency_id', [
      { id: 'client-1', name: 'Sous-compte 1', email: 'a@x.co', created_at: '2026-01-01' },
      { id: 'client-2', name: 'Sous-compte 2', email: null, created_at: '2026-02-01' },
    ]);
    db.seed('from leads where client_id in', [
      { client_id: 'client-1', c: 7 },
      { client_id: 'client-2', c: 3 },
    ]);
    db.seed('from tasks where client_id in', [{ client_id: 'client-1', c: 4 }]);

    const res = await handleGetAgencySubAccounts(env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: any[] };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: 'client-1',
      leadsCount: 7,
      tasksCount: 4,
    });
    expect(json.data[1]).toMatchObject({
      id: 'client-2',
      leadsCount: 3,
      tasksCount: 0,
    });

    // Le SELECT clients est filtré agency_id = ? avec l'agence du user.
    const clientsSelect = db.calls.find(
      (c) => /select/i.test(c.sql) && /from clients where agency_id/i.test(c.sql),
    );
    expect(clientsSelect).toBeTruthy();
    expect(clientsSelect!.args).toEqual(['ag-1']);
  });

  it('GARDE-FOU : aucune requête leads/tasks SANS clause client_id IN (...)', async () => {
    const { env, db } = makeEnv();
    db.seed('from clients where agency_id', [
      { id: 'client-1', name: 'S1', email: null, created_at: '2026-01-01' },
      { id: 'client-2', name: 'S2', email: null, created_at: '2026-02-01' },
    ]);
    db.seed('from leads where client_id in', [{ client_id: 'client-1', c: 1 }]);
    db.seed('from tasks where client_id in', [{ client_id: 'client-1', c: 1 }]);

    await handleGetAgencySubAccounts(env, AGENCY_AUTH);

    const metricQueries = db.calls.filter(
      (c) => /from leads|from tasks/i.test(c.sql),
    );
    expect(metricQueries.length).toBeGreaterThan(0);
    for (const q of metricQueries) {
      // Toute requête métier DOIT être bornée client_id IN (...).
      expect(q.sql.toLowerCase()).toContain('where client_id in (');
      // Et bornée aux ids de CETTE agence uniquement.
      expect(q.args).toEqual(
        expect.arrayContaining(['client-1', 'client-2']),
      );
      expect(q.args).toHaveLength(2);
    }
  });

  it('0 sous-compte ⇒ AUCUNE requête métier leads/tasks (anti IN() vide / SELECT global)', async () => {
    const { env, db } = makeEnv();
    db.seed('from clients where agency_id', []); // agence sans sous-compte

    const res = await handleGetAgencySubAccounts(env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: any[] };
    expect(json.data).toEqual([]);

    const metricQueries = db.calls.filter(
      (c) => /from leads|from tasks/i.test(c.sql),
    );
    expect(metricQueries).toHaveLength(0);
  });
});

describe('POST /api/agency/sub-accounts — CONTRAT §6.10', () => {
  it('non-agency ⇒ 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleCreateAgencySubAccount(
      postReq({ name: 'Nouveau' }),
      env,
      NON_AGENCY_AUTH,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('AGENCY_ONLY');
  });

  it('name vide ⇒ 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleCreateAgencySubAccount(
      postReq({ name: '   ' }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('crée clients + jonction user_sub_accounts (batch) + audit subaccount.create', async () => {
    const { env, db } = makeEnv();
    const res = await handleCreateAgencySubAccount(
      postReq({ name: 'Sous-compte X', email: 'x@y.co' }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string } };
    expect(typeof json.data.id).toBe('string');
    expect(json.data.id.length).toBeGreaterThan(0);

    // INSERT clients lié à l'agence du user.
    const clientInsert = db.calls.find(
      (c) => /insert into clients/i.test(c.sql),
    );
    expect(clientInsert).toBeTruthy();
    expect(clientInsert!.args).toEqual(
      expect.arrayContaining([json.data.id, 'Sous-compte X', 'x@y.co', 'ag-1']),
    );

    // INSERT jonction user_sub_accounts (user → nouveau client).
    const junctionInsert = db.calls.find(
      (c) => /insert into user_sub_accounts/i.test(c.sql),
    );
    expect(junctionInsert).toBeTruthy();
    expect(junctionInsert!.args).toEqual(
      expect.arrayContaining(['u1', json.data.id]),
    );

    // Audit Loi 25 'agency.subaccount.create'.
    const auditWrite = db.calls.find(
      (c) =>
        /insert/i.test(c.sql) &&
        /audit_log/i.test(c.sql) &&
        c.args.includes('agency.subaccount.create'),
    );
    expect(auditWrite).toBeTruthy();
    expect(auditWrite!.args).toEqual(
      expect.arrayContaining(['u1', 'agency.subaccount.create', 'client', json.data.id]),
    );
  });
});
