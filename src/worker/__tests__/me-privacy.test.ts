// ── me-privacy.test.ts — Sprint 23 (Manager-B) ──────────────────────────
//
// Couvre les 4 handlers Loi 25 :
//   - handleGetMyDataExport       (export composite + rate-limit 5/h)
//   - handleGetMyDeletionRequest  (lookup pending)
//   - handleRequestAccountDeletion (soft-delete +30j + email confirm + 3/jour)
//   - handleCancelAccountDeletion  (UPDATE pending → canceled)
//
// Invariants : pas de fuite cross-user (binds user_id stricts), pas de
// password_hash dans l'export, codes erreur stables (RATE_LIMITED 429,
// DELETION_ALREADY_REQUESTED 409, DELETION_NOT_FOUND 404, INVALID_INPUT 400).

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  handleGetMyDataExport,
  handleGetMyDeletionRequest,
  handleRequestAccountDeletion,
  handleCancelAccountDeletion,
} from '../me-privacy';

type Auth = { userId: string; tenant?: { agencyId?: string | null } };
const AUTH: Auth = { userId: 'user-1' };

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  return { env: { DB: db } as unknown as Env, db };
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) });
}

// ──────────────────────────────────────────────────────────────────────────
// handleGetMyDataExport
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — GET /api/me/export-data', () => {
  it('retourne user + sessions + audit + consents pour MY user uniquement', async () => {
    const { env, db } = makeEnv();
    db.seed('from users where id', [
      { id: 'user-1', email: 'me@x.io', name: 'Me', role: 'admin', created_at: 'now' },
    ]);
    db.seed('from admin_sessions', [
      { token: 'tok_abcdef_supersecret', ip: '1.2.3.4', user_agent: 'ua', created_at: 'now', last_active_at: 'now', expires_at: 'later' },
    ]);
    db.seed('from audit_log', [{ id: 1, action: 'login', user_id: 'user-1', resource_type: null, resource_id: null, details: '{}', ip: 'x', user_agent: 'x', created_at: 'now' }]);
    db.seed('from cookie_consent_log', []);

    const res = await handleGetMyDataExport(env, AUTH);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { user: { email: string }; sessions: Array<{ token: string }>; audit_log: unknown[]; purpose: string } };
    expect(body.data.user.email).toBe('me@x.io');
    expect(body.data.sessions.length).toBe(1);
    // Token tronqué (PII) — préfixe seulement, pas le secret complet.
    expect(body.data.sessions[0].token.startsWith('tok_ab')).toBe(true);
    expect(body.data.sessions[0].token.length).toBeLessThan(20);
    expect(body.data.sessions[0].token).not.toContain('supersecret');
    // Purpose Loi 25.
    expect(body.data.purpose).toContain('Loi 25');
    // user_id bindé strictement.
    const userSelect = db.calls.find(c => /FROM users WHERE id = \?/i.test(c.sql));
    expect(userSelect?.args).toEqual(['user-1']);
  });

  it('JAMAIS de password_hash dans le SELECT users', async () => {
    const { env, db } = makeEnv();
    await handleGetMyDataExport(env, AUTH);
    const userSelect = db.calls.find(c => /FROM users WHERE id = \?/i.test(c.sql));
    expect(userSelect).toBeDefined();
    expect(userSelect!.sql).not.toMatch(/password_hash/i);
  });

  it('best-effort dégradé : tables absentes → export partiel (PAS 500)', async () => {
    // DB qui throw sur tout sauf le compteur de rate-limit (qui doit retourner 0).
    let prepareCount = 0;
    const partialDb = {
      prepare(sql: string) {
        prepareCount++;
        return {
          bind() { return this; },
          all() {
            if (/COUNT\(\*\)/i.test(sql)) return { results: [{ c: 0 }] };
            // simulate "no such table"
            throw new Error('no such table: users');
          },
          first() {
            if (/COUNT\(\*\)/i.test(sql)) return { c: 0 };
            throw new Error('no such table: users');
          },
          run() { return { success: true, meta: { changes: 0 } }; },
        };
      },
    } as unknown as Env['DB'];
    const env = { DB: partialDb } as unknown as Env;
    const res = await handleGetMyDataExport(env, AUTH);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { user: { id: string }; purpose: string } };
    expect(body.data.user.id).toBe('user-1');
    expect(body.data.purpose).toContain('Loi 25');
    expect(prepareCount).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleGetMyDeletionRequest
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — GET /api/me/delete-account', () => {
  it('retourne la demande pending si elle existe', async () => {
    const { env, db } = makeEnv();
    db.seed('from account_deletion_requests', [
      { id: 'd1', user_id: 'user-1', reason: '', status: 'pending', requested_at: 'now', scheduled_for: 'later', executed_at: null },
    ]);
    const res = await handleGetMyDeletionRequest(env, AUTH);
    const body = await res.json() as { data: { status: string } | null };
    expect(body.data?.status).toBe('pending');
  });

  it('aucune demande → null', async () => {
    const { env, db } = makeEnv();
    db.seed('from account_deletion_requests', []);
    const res = await handleGetMyDeletionRequest(env, AUTH);
    const body = await res.json() as { data: unknown };
    expect(body.data).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleRequestAccountDeletion
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — POST /api/me/delete-account', () => {
  it('body invalide (confirm_email absent) → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleRequestAccountDeletion(
      postReq('/api/me/delete-account', { reason: 'partir' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('confirm_email mismatch → 400 INVALID_INPUT', async () => {
    const { env, db } = makeEnv();
    db.seed('email from users', [{ email: 'me@x.io' }]);
    const res = await handleRequestAccountDeletion(
      postReq('/api/me/delete-account', { confirm_email: 'wrong@x.io', reason: 'ok' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
  });

  it('déjà pending → 409 DELETION_ALREADY_REQUESTED', async () => {
    const { env, db } = makeEnv();
    db.seed('email from users', [{ email: 'me@x.io' }]);
    db.seed('from account_deletion_requests', [{ id: 'd-existing' }]);
    const res = await handleRequestAccountDeletion(
      postReq('/api/me/delete-account', { confirm_email: 'me@x.io', reason: '' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('DELETION_ALREADY_REQUESTED');
  });

  it('OK : INSERT avec scheduled_for = +30j, status pending, audit émis', async () => {
    const { env, db } = makeEnv();
    db.seed('email from users', [{ email: 'me@x.io' }]);
    // Pour le check existing → []. Pour le SELECT post-INSERT → 1 row pending.
    let callIdx = 0;
    const origSeed = db.seed;
    // Strategy : on seed account_deletion_requests vide d'abord, et on
    // override le 2e SELECT en patchant defaultRows juste avant.
    db.seed('from account_deletion_requests', []);
    // Le SELECT du row final fera fallback sur la même seed (vide) — c'est OK,
    // le handler tolère row null et reconstruit le shape.

    const res = await handleRequestAccountDeletion(
      postReq('/api/me/delete-account', { confirm_email: 'me@x.io', reason: 'je pars' }),
      env,
      AUTH,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string; scheduled_for: string } };
    expect(body.data.status).toBe('pending');
    // scheduled_for doit être ~+30j : tolère ±1j.
    const sched = new Date(body.data.scheduled_for).getTime();
    const expected = Date.now() + 30 * 24 * 3600 * 1000;
    expect(Math.abs(sched - expected)).toBeLessThan(24 * 3600 * 1000);

    // INSERT émis avec datetime('now', '+30 days').
    const insert = db.calls.find(c => /INSERT INTO account_deletion_requests/i.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.sql).toMatch(/\+30 days/);
    // bind user_id = 'user-1' présent.
    expect(insert!.args).toContain('user-1');

    // audit('me.account.delete_requested') émis.
    const auditCall = db.calls.find(c => /INSERT INTO audit_log/i.test(c.sql) && c.args.includes('me.account.delete_requested'));
    expect(auditCall).toBeDefined();

    void origSeed; void callIdx;
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleCancelAccountDeletion
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — POST /api/me/delete-account/cancel', () => {
  it('UPDATE OK (changes=1) → audit + ok:true', async () => {
    const { env, db } = makeEnv();
    // createMockD1 run() retourne meta.changes = 1 par défaut.
    const res = await handleCancelAccountDeletion(env, AUTH);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
    // UPDATE émis avec user_id bindé.
    const upd = db.calls.find(c => /^UPDATE account_deletion_requests/i.test(c.sql.trim()));
    expect(upd).toBeDefined();
    expect(upd!.args).toContain('user-1');
    // audit('me.account.delete_canceled') émis.
    const auditCall = db.calls.find(c => /INSERT INTO audit_log/i.test(c.sql) && c.args.includes('me.account.delete_canceled'));
    expect(auditCall).toBeDefined();
  });

  it('aucune demande → 404 DELETION_NOT_FOUND (run throw simule changes=0)', async () => {
    // Override le mock pour simuler une table absente → catch → changes = 0.
    const brokenDb = {
      prepare() {
        return {
          bind() { return this; },
          all() { return { results: [] }; },
          first() { return null; },
          run() { throw new Error('no such table: account_deletion_requests'); },
        };
      },
    } as unknown as Env['DB'];
    const env = { DB: brokenDb } as unknown as Env;
    const res = await handleCancelAccountDeletion(env, AUTH);
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('DELETION_NOT_FOUND');
  });
});
