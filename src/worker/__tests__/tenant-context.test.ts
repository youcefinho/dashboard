// ── tenant-context.test.ts — LOT 1 SaaS M1 (2026-05-18) ─────────────────────
//
// Couvre resolveTenantContext (CONTRAT §6.1) :
//   - legacy mono-tenant inchangé (client_id présent, pas d'agence)
//   - client_id null & 0 jonction ⇒ tout null/[] (legacy strict)
//   - multi-comptes (jonction renvoie plusieurs client_id)
//   - requested ∉ accessible ⇒ IGNORE + fallback users.client_id (PAS de throw)
//   - account_level absent ⇒ 'user'
//   - audit 'agency.subaccount.access' émis 1× ssi switch résolu + agence ≠ null
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
//
// Mock : createMockD1 partagé (_helpers.ts, FIGÉ — pas de batch). `seed(substr,
// rows)` programme la réponse d'un SELECT contenant la sous-chaîne (1er match,
// case-insensitive). Sous-chaînes discriminantes utilisées :
//   - 'from users where id'       → SELECT users (client_id/account_level/...)
//   - 'from user_sub_accounts'    → jonction sous-comptes
//   - 'agency_id from clients'    → clients.agency_id du tenant courant
//   - 'into audit_log' / 'audit'  → écriture audit (helpers.audit, best-effort)

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { resolveTenantContext } from '../tenant-context';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

describe('resolveTenantContext — CONTRAT §6.1', () => {
  it('legacy mono-tenant : client_id présent, pas d’agence ⇒ inchangé', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'user', agency_id: null },
    ]);
    db.seed('from user_sub_accounts', []); // jonction pas encore back-fillée
    db.seed('agency_id from clients', [{ agency_id: null }]);

    const ctx = await resolveTenantContext(env, 'u1', 'admin');

    expect(ctx.clientId).toBe('client-1');
    expect(ctx.agencyId).toBeNull();
    expect(ctx.accountLevel).toBe('user');
    // client_id legacy toujours accessible même sans ligne jonction
    expect(ctx.accessibleClientIds).toEqual(['client-1']);
  });

  it('client_id null & 0 jonction ⇒ tout null/[] (legacy strict identique getClientModules:68)', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: null, account_level: null, agency_id: null },
    ]);
    db.seed('from user_sub_accounts', []);

    const ctx = await resolveTenantContext(env, 'u1', 'admin');

    expect(ctx.clientId).toBeNull();
    expect(ctx.agencyId).toBeNull();
    expect(ctx.accessibleClientIds).toEqual([]);
    // account_level absent (NULL) ⇒ 'user'
    expect(ctx.accountLevel).toBe('user');
  });

  it('multi-comptes : jonction renvoie plusieurs client_id', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [
      { client_id: 'client-1' },
      { client_id: 'client-2' },
      { client_id: 'client-3' },
    ]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    const ctx = await resolveTenantContext(env, 'u1', 'admin');

    expect(ctx.clientId).toBe('client-1');
    expect(ctx.accountLevel).toBe('agency');
    expect(ctx.agencyId).toBe('ag-1');
    expect(ctx.accessibleClientIds).toEqual(
      expect.arrayContaining(['client-1', 'client-2', 'client-3']),
    );
    expect(ctx.accessibleClientIds).toHaveLength(3);
  });

  it('requested ∉ accessible ⇒ IGNORE + fallback users.client_id (JAMAIS throw/500)', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [{ client_id: 'client-1' }]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    // 'client-999' n'est PAS dans accessibleClientIds ⇒ ignoré, pas de throw.
    const ctx = await resolveTenantContext(env, 'u1', 'admin', 'client-999');

    expect(ctx.clientId).toBe('client-1'); // fallback users.client_id
    expect(ctx.accessibleClientIds).toEqual(['client-1']);
  });

  it('account_level absent (colonne pré-migration : SELECT échoue) ⇒ \'user\' sans throw', async () => {
    const { env } = makeEnv();
    // DB qui throw sur le SELECT enrichi (account_level/agency_id absents)
    // puis répond au SELECT minimal client_id.
    let firstUsersSelect = true;
    const db = {
      calls: [] as Array<{ sql: string; args: any[] }>,
      prepare(sql: string) {
        const lower = sql.toLowerCase();
        return {
          bind() {
            return this;
          },
          first() {
            if (lower.includes('from users where id')) {
              if (lower.includes('account_level') && firstUsersSelect) {
                firstUsersSelect = false;
                throw new Error('no such column: account_level');
              }
              return { client_id: 'client-1' }; // SELECT minimal fallback
            }
            if (lower.includes('agency_id from clients')) return { agency_id: null };
            return null;
          },
          all() {
            return { results: [] }; // user_sub_accounts vide
          },
          run() {
            return { success: true, meta: { changes: 1, last_row_id: 1 } };
          },
        };
      },
    };
    const ctx = await resolveTenantContext(
      { DB: db } as unknown as Env,
      'u1',
      'admin',
    );

    expect(ctx.clientId).toBe('client-1');
    expect(ctx.accountLevel).toBe('user'); // défaut sûr
    expect(ctx.agencyId).toBeNull();
  });

  it('audit \'agency.subaccount.access\' émis 1× ssi switch résolu + agence ≠ null', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [
      { client_id: 'client-1' },
      { client_id: 'client-2' },
    ]);
    // switch vers client-2 ⇒ on relit clients.agency_id du nouveau tenant
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    const ctx = await resolveTenantContext(env, 'u1', 'admin', 'client-2');

    expect(ctx.clientId).toBe('client-2');
    expect(ctx.agencyId).toBe('ag-1');

    // audit() (helpers) écrit dans audit_log via INSERT. Exactement 1 écriture
    // pour l'action subaccount.access (resource 'client').
    const auditWrites = db.calls.filter(
      (c) =>
        /insert/i.test(c.sql) &&
        /audit_log/i.test(c.sql) &&
        c.args.includes('agency.subaccount.access'),
    );
    expect(auditWrites).toHaveLength(1);
  });

  it('aucun switch demandé ⇒ aucun audit subaccount.access', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { client_id: 'client-1', account_level: 'agency', agency_id: 'ag-1' },
    ]);
    db.seed('from user_sub_accounts', [{ client_id: 'client-1' }]);
    db.seed('agency_id from clients', [{ agency_id: 'ag-1' }]);

    await resolveTenantContext(env, 'u1', 'admin'); // pas de requestedSubAccountId

    const auditWrites = db.calls.filter((c) =>
      c.args.includes('agency.subaccount.access'),
    );
    expect(auditWrites).toHaveLength(0);
  });

  it('panne D1 totale sur le SELECT users ⇒ legacy strict null/[], JAMAIS throw', async () => {
    const db = {
      calls: [],
      prepare() {
        return {
          bind() {
            return this;
          },
          first() {
            throw new Error('D1 unavailable');
          },
          all() {
            throw new Error('D1 unavailable');
          },
          run() {
            throw new Error('D1 unavailable');
          },
        };
      },
    };
    const ctx = await resolveTenantContext(
      { DB: db } as unknown as Env,
      'u1',
      'admin',
    );
    expect(ctx.clientId).toBeNull();
    expect(ctx.agencyId).toBeNull();
    expect(ctx.accessibleClientIds).toEqual([]);
    expect(ctx.accountLevel).toBe('user');
  });
});
