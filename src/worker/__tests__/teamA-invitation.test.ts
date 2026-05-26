// ── teamA-invitation.test.ts — LOT TEAM A (2026-05-18) ─────────────────────
//
// PROUVE le cycle d'invitation (CONTRAT §6.B) : create → accept → single-use
// → expire → revoke → resend ; scope agence vs sous-compte (jonction) ;
// INVALID_SCOPE ; preuve token hashé (jamais de token clair persisté) ;
// preuve ZÉRO INSERT users côté invite + ZÉRO rebuild users.
//
// ⚠ Tests NON exécutés (VM VMware). Écrits pour vitest. RESEND_API_KEY laissé
//   absent ⇒ chemin email = log + continue (aucun appel réseau Resend).
//   Mock createMockD1 partagé (_helpers.ts FIGÉ) ; mock ad-hoc inline quand
//   un séquencement de réponses est requis (le mock partagé n'a pas de batch).

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import {
  handleInviteUser,
  handleAcceptInvitation,
  handleRevokeInvitation,
  handleResendInvitation,
  handleGetRoles,
} from '../team';
import type { Env } from '../types';
import type { TenantContext } from '../tenant-context';

function makeEnv(db = createMockD1()) {
  // RESEND_API_KEY non défini ⇒ email skip (log + continue).
  return { env: { DB: db } as unknown as Env, db };
}

const AGENCY_AUTH = {
  userId: 'inviter-1',
  role: 'admin',
  clientId: 'client-1',
  tenant: {
    userId: 'inviter-1',
    role: 'admin',
    clientId: 'client-1',
    agencyId: 'agency-1',
    accountLevel: 'agency',
    accessibleClientIds: ['client-1', 'client-2'],
  } as TenantContext,
};

function jreq(url: string, body: unknown, method = 'POST') {
  return new Request(url, { method, body: JSON.stringify(body) });
}

// ── Create ─────────────────────────────────────────────────────────────────
describe('TEAM A — handleInviteUser (CONTRAT §6.B)', () => {
  it('crée user_invitations, PAS d’INSERT users, token HASHÉ (jamais clair)', async () => {
    const { env, db } = makeEnv();
    db.seed('select id from users where email', []); // email libre

    const res = await handleInviteUser(
      jreq('http://x/api/team/invites', { email: 'New@Co.com', role: 'manager' }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      data: { success: true, message: 'Invitation envoyée avec succès' },
    });

    const insert = db.calls.find((c) => /insert into user_invitations/i.test(c.sql));
    expect(insert).toBeTruthy();
    // Aucun INSERT users (mock PENDING_INVITE supprimé).
    expect(db.calls.some((c) => /insert into users/i.test(c.sql))).toBe(false);
    // token_hash = SHA-256 hex (64 chars) ; le token clair n'apparaît dans
    // AUCUN argument lié (binds). args ordre : id,email,agency_id,scope,
    // client_id,role,token_hash,invited_by.
    const tokenHashArg = insert!.args[6];
    expect(typeof tokenHashArg).toBe('string');
    expect(tokenHashArg).toMatch(/^[0-9a-f]{64}$/);
    // email normalisé en minuscule.
    expect(insert!.args[1]).toBe('new@co.com');
    expect(insert!.args[2]).toBe('agency-1');
    expect(insert!.args[3]).toBe('agency'); // scope défaut
    expect(insert!.args[5]).toBe('manager');
  });

  it('role par défaut = member ; rôle inconnu retombe sur member', async () => {
    const { env, db } = makeEnv();
    db.seed('select id from users where email', []);
    await handleInviteUser(
      jreq('http://x/api/team/invites', { email: 'a@b.co', role: 'superadmin' }),
      env,
      AGENCY_AUTH,
    );
    const insert = db.calls.find((c) => /insert into user_invitations/i.test(c.sql));
    expect(insert!.args[5]).toBe('member');
  });

  it('email déjà user ⇒ 400 « Cet utilisateur existe déjà » (verbatim)', async () => {
    const { env, db } = makeEnv();
    db.seed('select id from users where email', [{ id: 'exists' }]);
    const res = await handleInviteUser(
      jreq('http://x/api/team/invites', { email: 'dup@co.com' }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Cet utilisateur existe déjà' });
  });

  it('scope=subaccount sans client_id autorisé ⇒ 400 INVALID_SCOPE', async () => {
    const { env } = makeEnv();
    const res = await handleInviteUser(
      jreq('http://x/api/team/invites', {
        email: 'x@y.co',
        scope: 'subaccount',
        client_id: 'client-999',
      }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Sous-compte non autorisé',
      code: 'INVALID_SCOPE',
    });
  });

  it('scope=subaccount avec client_id accessible ⇒ 201, client_id persisté', async () => {
    const { env, db } = makeEnv();
    db.seed('select id from users where email', []);
    const res = await handleInviteUser(
      jreq('http://x/api/team/invites', {
        email: 'sub@y.co',
        scope: 'subaccount',
        client_id: 'client-2',
      }),
      env,
      AGENCY_AUTH,
    );
    expect(res.status).toBe(201);
    const insert = db.calls.find((c) => /insert into user_invitations/i.test(c.sql));
    expect(insert!.args[3]).toBe('subaccount');
    expect(insert!.args[4]).toBe('client-2');
  });
});

// ── Accept (single-use, mapping rôles, jonction) ───────────────────────────
describe('TEAM A — handleAcceptInvitation (CONTRAT §6.B)', () => {
  // Mock séquencé : SELECT invite → SELECT dup users (null) → INSERT users →
  // INSERT user_sub_accounts → UPDATE invite → finishLogin (INSERT session...).
  function seqEnv(opts: {
    invite: any | null;
    dupUser?: any | null;
  }) {
    const calls: Array<{ sql: string; args: any[] }> = [];
    const db = {
      calls,
      prepare(sql: string) {
        let bound: any[] = [];
        return {
          bind(...a: any[]) {
            bound = a;
            return this;
          },
          all() {
            calls.push({ sql, args: bound });
            return { results: [] };
          },
          first() {
            calls.push({ sql, args: bound });
            if (/from user_invitations/i.test(sql)) return opts.invite;
            if (/select id from users where email/i.test(sql)) return opts.dupUser ?? null;
            return null;
          },
          run() {
            calls.push({ sql, args: bound });
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
    return { env: { DB: db } as unknown as Env, db };
  }

  it('token valide + password ≥8 ⇒ INSERT users (role technique mappé) + finishLogin', async () => {
    const { env, db } = seqEnv({
      invite: {
        id: 'inv-1',
        email: 'member@co.com',
        agency_id: 'agency-1',
        scope: 'agency',
        client_id: null,
        role: 'manager',
      },
    });
    const res = await handleAcceptInvitation(
      jreq('http://x/api/team/invites/accept', {
        token: 'sometoken-clear-value',
        password: 'longenough8',
        name: 'Mary',
      }),
      env,
    );
    // finishLogin renvoie { success, token, ... } status 200
    expect(res.status).toBe(200);
    const payload = (await res.json()) as any;
    expect(payload.success).toBe(true);
    expect(payload.token).toBeTruthy();

    const insertUser = db.calls.find((c) => /insert into users/i.test(c.sql));
    expect(insertUser).toBeTruthy();
    // CONTRAT mapping : manager → broker dans users.role ; role_generic = manager.
    // args : id,name,email,role,role_generic,password_hash,client_id,agency_id
    expect(insertUser!.args[3]).toBe('broker'); // users.role technique CHECK-valide
    expect(insertUser!.args[4]).toBe('manager'); // role_generic
    expect(insertUser!.args[3]).not.toBe('manager'); // JAMAIS générique dans users.role
    // password_hash = pbkdf2 (hashPassword) — jamais 'PENDING_INVITE'.
    expect(String(insertUser!.args[5])).not.toBe('PENDING_INVITE');
    expect(String(insertUser!.args[5])).toMatch(/^pbkdf2\$/);

    // scope agency ⇒ jonction depuis clients WHERE agency_id.
    expect(
      db.calls.some((c) => /insert or ignore into user_sub_accounts[\s\S]*from clients c where c\.agency_id/i.test(c.sql)),
    ).toBe(true);
    // invitation passée à accepted (single-use).
    expect(
      db.calls.some((c) => /update user_invitations set status = 'accepted'/i.test(c.sql)),
    ).toBe(true);
    // ZÉRO rebuild users (aucun DROP/RENAME users).
    expect(db.calls.some((c) => /drop table users|rename to users/i.test(c.sql))).toBe(false);
  });

  it('mapping owner→admin / member→store_manager / viewer→store_manager', async () => {
    for (const [generic, legacy] of [
      ['owner', 'admin'],
      ['member', 'store_manager'],
      ['viewer', 'store_manager'],
    ] as const) {
      const { env, db } = seqEnv({
        invite: {
          id: 'inv',
          email: `${generic}@co.com`,
          agency_id: 'agency-1',
          scope: 'subaccount',
          client_id: 'client-2',
          role: generic,
        },
      });
      await handleAcceptInvitation(
        jreq('http://x/api/team/invites/accept', { token: 't', password: 'password8' }),
        env,
      );
      const insertUser = db.calls.find((c) => /insert into users/i.test(c.sql));
      expect(insertUser!.args[3]).toBe(legacy);
      expect(insertUser!.args[4]).toBe(generic);
      // scope subaccount ⇒ jonction directe (VALUES), pas depuis clients.
      expect(
        db.calls.some((c) =>
          /insert or ignore into user_sub_accounts \(id, user_id, client_id, role\)\s*values/i.test(
            c.sql,
          ),
        ),
      ).toBe(true);
    }
  });

  it('token introuvable / expiré (status≠pending OU expires_at dépassé) ⇒ 400 INVALID_INVITE', async () => {
    const { env } = seqEnv({ invite: null }); // SELECT WHERE status='pending' AND expires_at>now ⇒ null
    const res = await handleAcceptInvitation(
      jreq('http://x/api/team/invites/accept', { token: 'expired', password: 'password8' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Invitation invalide ou expirée',
      code: 'INVALID_INVITE',
    });
  });

  it('single-use : 2e accept du même token (déjà accepted) ⇒ INVALID_INVITE', async () => {
    // Le SELECT filtre status='pending' : une invite déjà acceptée renvoie null.
    const { env } = seqEnv({ invite: null });
    const res = await handleAcceptInvitation(
      jreq('http://x/api/team/invites/accept', { token: 'reused', password: 'password8' }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INVITE');
  });

  it('password < 8 ⇒ 400, AUCUN INSERT users', async () => {
    const { env, db } = seqEnv({
      invite: { id: 'i', email: 'a@b.co', agency_id: 'ag', scope: 'agency', client_id: null, role: 'member' },
    });
    const res = await handleAcceptInvitation(
      jreq('http://x/api/team/invites/accept', { token: 't', password: 'short' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(db.calls.some((c) => /insert into users/i.test(c.sql))).toBe(false);
  });

  it('token manquant ⇒ 400 INVALID_INVITE', async () => {
    const { env } = seqEnv({ invite: null });
    const res = await handleAcceptInvitation(
      jreq('http://x/api/team/invites/accept', { password: 'password8' }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INVITE');
  });
});

// ── Revoke / Resend ────────────────────────────────────────────────────────
describe('TEAM A — revoke / resend bornés agence (CONTRAT §6.B)', () => {
  it('revoke ⇒ UPDATE status=revoked borné agency_id + status IN(pending,expired)', async () => {
    const { env, db } = makeEnv();
    const req = new Request('http://x/api/team/invites/inv-9/revoke', { method: 'POST' });
    const res = await handleRevokeInvitation(req, env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { success: true } });
    const upd = db.calls.find((c) => /update user_invitations set status = 'revoked'/i.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd!.sql).toMatch(/agency_id = \?/i);
    expect(upd!.sql).toMatch(/status in \('pending','expired'\)/i);
    expect(upd!.args).toEqual(['inv-9', 'agency-1']);
  });

  it('resend ⇒ régénère token+hash, expires_at +7j, status=pending', async () => {
    const { env, db } = makeEnv();
    db.seed('select id, email from user_invitations', [{ id: 'inv-9', email: 'r@co.com' }]);
    const req = new Request('http://x/api/team/invites/inv-9/resend', { method: 'POST' });
    const res = await handleResendInvitation(req, env, AGENCY_AUTH);
    expect(res.status).toBe(200);
    const upd = db.calls.find((c) =>
      /update user_invitations set token_hash = \?, status = 'pending', expires_at = datetime\('now','\+7 days'\)/i.test(
        c.sql,
      ),
    );
    expect(upd).toBeTruthy();
    expect(upd!.args[0]).toMatch(/^[0-9a-f]{64}$/); // nouveau hash, jamais token clair
  });

  it('resend d’une invitation introuvable/non éligible ⇒ 400 INVALID_INVITE', async () => {
    const { env, db } = makeEnv();
    db.seed('select id, email from user_invitations', []); // introuvable
    const req = new Request('http://x/api/team/invites/none/resend', { method: 'POST' });
    const res = await handleResendInvitation(req, env, AGENCY_AUTH);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INVITE');
  });
});

// ── Roles ──────────────────────────────────────────────────────────────────
describe('TEAM A — handleGetRoles', () => {
  it('retourne 4 rôles génériques is_system:true (owner/manager/member/viewer)', async () => {
    const res = await handleGetRoles(new Request('http://x/api/team/roles'), {} as Env);
    const body = (await res.json()) as any;
    expect(body.data.map((r: any) => r.id)).toEqual([
      'owner',
      'manager',
      'member',
      'viewer',
    ]);
    expect(body.data.every((r: any) => r.is_system === true)).toBe(true);
  });
});
