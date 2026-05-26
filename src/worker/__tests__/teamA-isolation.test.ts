// ── teamA-isolation.test.ts — LOT TEAM A (2026-05-18) ──────────────────────
//
// PROUVE le fix de fuite d'isolation de handleGetUsers/Update/Delete
// (CONTRAT §6.A). Lecture seule : aucune assertion ne modifie le code prod.
//
// Cas couverts :
//   (a) Legacy/mono-tenant (auth.tenant absent OU agencyId==null) ⇒
//       SELECT plein scope LIMIT 50, BYTE-IDENTIQUE à l'ancien code.
//   (b) Tenant agence ⇒ SELECT BORNÉ (agency_id = ? OR client_id IN (...))
//       — fuite cross-tenant IMPOSSIBLE (jamais de SELECT plein scope).
//   (c) handleUpdateUserRole/handleDeleteUser : cible hors tenant ⇒ 404
//       NOT_FOUND ; cible dans le tenant ⇒ opération exécutée ; legacy ⇒
//       comportement byte-identique (pas de garde).
//
// ⚠ Tests NON exécutés (VM VMware). Écrits pour vitest. Mock createMockD1
//   partagé (_helpers.ts, FIGÉ). `seed(substr, rows)` 1er match insensible.

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import {
  handleGetUsers,
  handleUpdateUserRole,
  handleDeleteUser,
} from '../team';
import type { Env } from '../types';
import type { TenantContext } from '../tenant-context';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

const LEGACY_AUTH = { userId: 'u1', role: 'admin' }; // pas de tenant
const MONO_TENANT_AUTH = {
  userId: 'u1',
  role: 'admin',
  tenant: {
    userId: 'u1',
    role: 'admin',
    clientId: 'client-1',
    agencyId: null, // mono-tenant ⇒ legacy
    accountLevel: 'user',
    accessibleClientIds: ['client-1'],
  } as TenantContext,
};
const AGENCY_AUTH = {
  userId: 'a1',
  role: 'admin',
  clientId: 'client-1',
  tenant: {
    userId: 'a1',
    role: 'admin',
    clientId: 'client-1',
    agencyId: 'agency-1',
    accountLevel: 'agency',
    accessibleClientIds: ['client-1', 'client-2'],
  } as TenantContext,
};

// ── (a) Legacy byte-identique ──────────────────────────────────────────────
describe('TEAM A — handleGetUsers legacy byte-identique (CONTRAT §6.A)', () => {
  it('auth absent ⇒ SELECT plein scope LIMIT 50, AUCUN WHERE agency/client', async () => {
    const { env, db } = makeEnv();
    db.seed('from users limit 50', [{ id: 'x', name: 'X', email: 'x@a.co', role: 'admin' }]);

    const res = await handleGetUsers(new Request('http://x/api/team/users'), env);
    expect(res.status).toBe(200);

    const sql = db.calls.map((c) => c.sql.toLowerCase());
    expect(sql.some((s) => s.includes('from users limit 50'))).toBe(true);
    // Aucune borne tenant injectée sur le chemin legacy.
    expect(sql.some((s) => s.includes('agency_id = ?'))).toBe(false);
    expect(sql.some((s) => s.includes('client_id in ('))).toBe(false);
  });

  it('auth.tenant.agencyId == null (mono-tenant) ⇒ même chemin legacy', async () => {
    const { env, db } = makeEnv();
    db.seed('from users limit 50', [{ id: 'x' }]);

    await handleGetUsers(
      new Request('http://x/api/team/users'),
      env,
      MONO_TENANT_AUTH,
    );

    const sql = db.calls.map((c) => c.sql.toLowerCase());
    expect(sql.some((s) => s.includes('from users limit 50'))).toBe(true);
    expect(sql.some((s) => s.includes('agency_id = ?'))).toBe(false);
  });

  it('fallback SELECT minimal si colonnes 79 absentes (try/catch) — legacy strict', async () => {
    // 1er prepare (avec role_generic) throw ⇒ on retombe sur SELECT minimal.
    let firstSelect = true;
    const db = {
      calls: [] as Array<{ sql: string; args: any[] }>,
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          all() {
            db.calls.push({ sql, args: [] });
            if (firstSelect && sql.includes('role_generic')) {
              firstSelect = false;
              throw new Error('no such column: role_generic');
            }
            return { results: [{ id: 'x' }] };
          },
          first() {
            return null;
          },
          run() {
            return { success: true, meta: {} };
          },
        };
      },
    };
    const res = await handleGetUsers(
      new Request('http://x/api/team/users'),
      { DB: db } as unknown as Env,
      LEGACY_AUTH,
    );
    expect(res.status).toBe(200);
    const sql = db.calls.map((c) => c.sql.toLowerCase());
    // Fallback = SELECT minimal historique, toujours sans borne tenant.
    expect(
      sql.some((s) => s.includes('select id, name, email, role, created_at from users limit 50')),
    ).toBe(true);
  });
});

// ── (b) Tenant agence : isolation DURE — fuite impossible ──────────────────
describe('TEAM A — handleGetUsers agence bornée (CONTRAT §6.A)', () => {
  it('agencyId set ⇒ WHERE agency_id = ? OR client_id IN (...) avec binds', async () => {
    const { env, db } = makeEnv();
    db.seed('where agency_id = ?', [{ id: 'm1' }]);

    const res = await handleGetUsers(
      new Request('http://x/api/team/users'),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(200);

    const call = db.calls.find((c) => c.sql.toLowerCase().includes('where agency_id = ?'));
    expect(call).toBeTruthy();
    // Jamais de SELECT plein scope sur le chemin agence.
    const plain = db.calls.find(
      (c) => /from users limit 50\s*$/i.test(c.sql.trim()),
    );
    expect(plain).toBeUndefined();
    // Binds = [agencyId, ...accessibleClientIds]
    expect(call!.args).toEqual(['agency-1', 'client-1', 'client-2']);
    expect(call!.sql).toMatch(/client_id IN \(\?,\?\)/i);
  });

  it('fallback agence : colonnes absentes ⇒ borné aux accessibleClientIds (zéro fuite)', async () => {
    let first = true;
    const db = {
      calls: [] as Array<{ sql: string; args: any[] }>,
      prepare(sql: string) {
        let bound: any[] = [];
        return {
          bind(...a: any[]) {
            bound = a;
            return this;
          },
          all() {
            db.calls.push({ sql, args: bound });
            if (first && sql.includes('agency_id = ?')) {
              first = false;
              throw new Error('no such column: agency_id');
            }
            return { results: [] };
          },
          first() {
            return null;
          },
          run() {
            return { success: true, meta: {} };
          },
        };
      },
    };
    const res = await handleGetUsers(
      new Request('http://x/api/team/users'),
      { DB: db } as unknown as Env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(200);
    const fb = db.calls.find((c) => /where client_id in \(/i.test(c.sql));
    expect(fb).toBeTruthy();
    expect(fb!.args).toEqual(['client-1', 'client-2']);
    // Jamais de SELECT plein scope, même en dégradé.
    expect(db.calls.some((c) => /from users limit 50\s*$/i.test(c.sql.trim()))).toBe(false);
  });
});

// ── (c) Update/Delete : garde tenant minimale ──────────────────────────────
describe('TEAM A — handleUpdateUserRole/handleDeleteUser garde tenant', () => {
  it('legacy ⇒ UPDATE exécuté sans garde (byte-identique)', async () => {
    const { env, db } = makeEnv();
    const req = new Request('http://x/api/team/users/target-9', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'broker' }),
    });
    const res = await handleUpdateUserRole(req, env, LEGACY_AUTH);
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => /update users set role = \?/i.test(c.sql))).toBe(true);
    // Pas de SELECT de garde (legacy : aucune vérif tenant).
    expect(db.calls.some((c) => /select agency_id, client_id from users/i.test(c.sql))).toBe(false);
  });

  it('agence : cible hors tenant ⇒ 404 NOT_FOUND, AUCUN UPDATE', async () => {
    const { env, db } = makeEnv();
    db.seed('select agency_id, client_id from users', [
      { agency_id: 'other-agency', client_id: 'client-99' },
    ]);
    const req = new Request('http://x/api/team/users/target-9', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'broker' }),
    });
    const res = await handleUpdateUserRole(req, env, AGENCY_AUTH);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Utilisateur introuvable', code: 'NOT_FOUND' });
    expect(db.calls.some((c) => /update users set role = \?/i.test(c.sql))).toBe(false);
  });

  it('agence : cible dans accessibleClientIds ⇒ DELETE exécuté', async () => {
    const { env, db } = makeEnv();
    db.seed('select agency_id, client_id from users', [
      { agency_id: null, client_id: 'client-2' },
    ]);
    const req = new Request('http://x/api/team/users/target-2', { method: 'DELETE' });
    const res = await handleDeleteUser(req, env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => /delete from users where id = \?/i.test(c.sql))).toBe(true);
  });

  it('agence : cible appartenant à l’agence courante ⇒ autorisé', async () => {
    const { env, db } = makeEnv();
    db.seed('select agency_id, client_id from users', [
      { agency_id: 'agency-1', client_id: 'client-77' },
    ]);
    const req = new Request('http://x/api/team/users/target-7', { method: 'DELETE' });
    const res = await handleDeleteUser(req, env, AGENCY_AUTH);
    expect(res.status).toBe(200);
  });
});
