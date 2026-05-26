// ── lot2-switch.test.ts — LOT 2 SaaS M1 (2026-05-18) ───────────────────────
//
// Couvre POST /api/account/switch (CONTRAT §6.8) :
//   - switch ∈ accessibleClientIds ⇒ 200 + payload (agencyId, accessibles)
//   - switch ∉ accessibleClientIds ⇒ 403 STRICT (SUBACCOUNT_FORBIDDEN),
//     PAS de fallback sur users.client_id
//   - body manquant / vide ⇒ 400 INVALID_INPUT
//   - audit Loi 25 'agency.subaccount.access' émis par le RÉSOLVEUR Lot 1
//     (pas de double-audit côté handler : aucune écriture
//     'agency.subaccount.switch' ni doublon access)
//   - STATELESS : aucune écriture admin_sessions
//   - preuve de DÉLÉGATION : le handler n'écrit pas la table de jonction,
//     il lit user_sub_accounts via le résolveur (appartenance déléguée)
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — pas de batch ; le switch
// n'a pas besoin de batch). Sous-chaînes seed discriminantes :
//   - 'from users where id'    → SELECT users (client_id/account_level/agency_id)
//   - 'from user_sub_accounts' → jonction sous-comptes (appartenance)
//   - 'agency_id from clients' → clients.agency_id du tenant courant
//   - 'audit_log'              → écriture audit (helpers.audit, best-effort)

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleAccountSwitch } from '../saas';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

function req(body: unknown): Request {
  return new Request('https://x/api/account/switch', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const AUTH = { userId: 'u1', role: 'admin' };

describe('POST /api/account/switch — CONTRAT §6.8', () => {
  it('switch ∈ accessibleClientIds ⇒ 200 + activeSubAccount/agencyId/accessibles', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [
      { client_id: 'client-1' },
      { client_id: 'client-2' },
    ]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    const res = await handleAccountSwitch(req({ subAccountId: 'client-2' }), env, AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: any };
    expect(json.data.activeSubAccount).toBe('client-2');
    expect(json.data.agencyId).toBe('ag-1');
    expect(json.data.accessibleClientIds).toEqual(
      expect.arrayContaining(['client-1', 'client-2']),
    );

    // STATELESS : aucune écriture admin_sessions.
    const sessionWrites = db.calls.filter(
      (c) => /insert|update/i.test(c.sql) && /admin_sessions/i.test(c.sql),
    );
    expect(sessionWrites).toHaveLength(0);
  });

  it('switch ∉ accessibleClientIds ⇒ 403 STRICT SUBACCOUNT_FORBIDDEN (pas de fallback)', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [{ client_id: 'client-1' }]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    // 'client-999' n'est PAS accessible : le résolveur retombe sur client-1,
    // donc ctx.clientId !== subAccountId ⇒ 403 STRICT.
    const res = await handleAccountSwitch(
      req({ subAccountId: 'client-999' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe('SUBACCOUNT_FORBIDDEN');
  });

  it('body manquant ⇒ 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const noBody = new Request('https://x/api/account/switch', { method: 'POST' });
    const res = await handleAccountSwitch(noBody, env, AUTH);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('INVALID_INPUT');
  });

  it('subAccountId vide / non-string ⇒ 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res1 = await handleAccountSwitch(req({ subAccountId: '   ' }), env, AUTH);
    expect(res1.status).toBe(400);
    const res2 = await handleAccountSwitch(req({ subAccountId: 42 }), env, AUTH);
    expect(res2.status).toBe(400);
  });

  it('audit Loi 25 émis par le RÉSOLVEUR Lot 1, jamais double-audité par le handler', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [
      { client_id: 'client-1' },
      { client_id: 'client-2' },
    ]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    await handleAccountSwitch(req({ subAccountId: 'client-2' }), env, AUTH);

    // Le résolveur Lot 1 émet 'agency.subaccount.access' EXACTEMENT 1×.
    const accessWrites = db.calls.filter(
      (c) =>
        /insert/i.test(c.sql) &&
        /audit_log/i.test(c.sql) &&
        c.args.includes('agency.subaccount.access'),
    );
    expect(accessWrites).toHaveLength(1);

    // Pas de double-audit : aucune action propre au handler (switch).
    const handlerAudits = db.calls.filter(
      (c) =>
        /audit_log/i.test(c.sql) &&
        (c.args.includes('agency.subaccount.switch') ||
          c.args.includes('account.switch')),
    );
    expect(handlerAudits).toHaveLength(0);
  });

  it('DÉLÉGATION : le handler lit user_sub_accounts (résolveur) et n’écrit aucune jonction', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [
      { client_id: 'client-1' },
      { client_id: 'client-2' },
    ]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    await handleAccountSwitch(req({ subAccountId: 'client-2' }), env, AUTH);

    // Appartenance déléguée : le résolveur a bien INTERROGÉ la jonction.
    const junctionReads = db.calls.filter(
      (c) => /select/i.test(c.sql) && /user_sub_accounts/i.test(c.sql),
    );
    expect(junctionReads.length).toBeGreaterThanOrEqual(1);

    // Le handler ne RÉÉCRIT jamais l'appartenance (pas d'INSERT/UPDATE
    // user_sub_accounts ni clients) — il délègue, ne réimplémente pas.
    const junctionWrites = db.calls.filter(
      (c) =>
        /insert|update|delete/i.test(c.sql) &&
        /(user_sub_accounts|clients)/i.test(c.sql),
    );
    expect(junctionWrites).toHaveLength(0);
  });
});
