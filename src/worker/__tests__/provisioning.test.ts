import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionAgencyTenant, EmailTakenError } from '../provisioning';
import type { Env } from '../types';

// ── Mock D1 ad-hoc inline ──────────────────────────────────────────────────
// Le mock figé `_helpers.ts` N'A PAS `.batch` (interdiction de l'étendre) →
// mock ad-hoc local, pattern pipelines.test.ts:12. On enregistre les SQL/binds
// pour asserter l'ordre du batch et la compensation.

interface RecordedStmt { sql: string; args: any[] }

function makeDb(opts: {
  existingUser?: boolean;     // SELECT id FROM users WHERE email=? renvoie une row
  batchThrows?: boolean;      // env.DB.batch(...) rejette
} = {}) {
  const calls: RecordedStmt[] = [];
  const batchStmts: RecordedStmt[][] = [];

  const db: any = {
    calls,
    batchStmts,
    prepare(sql: string) {
      const rec: RecordedStmt = { sql, args: [] };
      const stmt: any = {
        _rec: rec,
        bind(...args: any[]) { rec.args = args; return stmt; },
        first: vi.fn(async () => {
          calls.push(rec);
          if (/select\s+id\s+from\s+users/i.test(sql)) {
            return opts.existingUser ? { id: 'existing-user' } : null;
          }
          return null;
        }),
        run: vi.fn(async () => { calls.push(rec); return { success: true, meta: {} }; }),
        all: vi.fn(async () => { calls.push(rec); return { results: [] }; }),
      };
      return stmt;
    },
    batch: vi.fn(async (stmts: any[]) => {
      batchStmts.push(stmts.map(s => ({ sql: s._rec.sql, args: s._rec.args })));
      if (opts.batchThrows) throw new Error('D1_ERROR: constraint failed');
      return stmts.map(() => ({ success: true }));
    }),
  };
  return db;
}

describe('provisionAgencyTenant — LOT1 §6.4', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exécute les 5 INSERT dans l\'ordre §6.4 (agencies→clients→users→user_sub_accounts→subscriptions)', async () => {
    const db = makeDb();
    const env = { DB: db } as unknown as Env;

    const res = await provisionAgencyTenant(env, {
      email: 'pme@exemple.ca',
      name: 'PME Exemple',
      passwordHash: 'pbkdf2$abc',
    });

    // Un seul batch, 5 statements, ordre exact.
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.batchStmts).toHaveLength(1);
    const batch = db.batchStmts[0];
    expect(batch).toHaveLength(5);
    expect(batch[0].sql).toMatch(/INSERT INTO agencies \(id, name, owner_id\)/);
    expect(batch[1].sql).toMatch(/INSERT INTO clients \(id, name, email, agency_id\)/);
    expect(batch[2].sql).toMatch(/INSERT INTO users \(id, email, password_hash, name, role, client_id, account_level, agency_id\)/);
    expect(batch[2].sql).toMatch(/'admin'/);
    expect(batch[2].sql).toMatch(/'agency'/);
    expect(batch[3].sql).toMatch(/INSERT INTO user_sub_accounts \(id, user_id, client_id\)/);
    // Sprint 22 (E4) — provisioning pose dès le départ les colonnes mock
    // Stripe (stripe_customer_id, provider, billing_period, current_period_*,
    // updated_at). On asserte que les 5 colonnes §6.4 sont présentes en tête
    // sans figer la liste complète (additif, fallback legacy si seq120 KO).
    expect(batch[4].sql).toMatch(/INSERT INTO subscriptions\s*\(id, client_id, agency_id, plan_name, status/);
    expect(batch[4].sql).toMatch(/'free'/);
    expect(batch[4].sql).toMatch(/'active'/);

    // Cohérence des IDs liés (agencies.owner_id == users.id ; clients.agency_id == agencies.id ; etc.)
    const agencyId = batch[0].args[0];
    const ownerId = batch[0].args[2];
    const clientId = batch[1].args[0];
    const userId = batch[2].args[0];
    expect(batch[1].args[3]).toBe(agencyId);       // clients.agency_id
    expect(batch[2].args[4]).toBe(clientId);        // users.client_id
    expect(batch[2].args[5]).toBe(agencyId);        // users.agency_id
    expect(ownerId).toBe(userId);                   // agencies.owner_id == users.id
    expect(batch[3].args[1]).toBe(userId);          // user_sub_accounts.user_id
    expect(batch[3].args[2]).toBe(clientId);        // user_sub_accounts.client_id
    expect(batch[4].args[1]).toBe(clientId);        // subscriptions.client_id
    expect(batch[4].args[2]).toBe(agencyId);        // subscriptions.agency_id

    // Valeur retournée alignée §6.4.
    expect(res).toEqual({ userId, agencyId, clientId });
  });

  it('email déjà pris → throw EmailTakenError SANS exécuter le batch', async () => {
    const db = makeDb({ existingUser: true });
    const env = { DB: db } as unknown as Env;

    await expect(
      provisionAgencyTenant(env, { email: 'dup@exemple.ca', name: 'X', passwordHash: 'h' }),
    ).rejects.toBeInstanceOf(EmailTakenError);

    expect(db.batch).not.toHaveBeenCalled();
    // Seul le SELECT id FROM users a été émis.
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toMatch(/SELECT id FROM users WHERE email = \?/);
  });

  it('échec du batch → compensation : 5 DELETE en ordre INVERSE puis re-throw', async () => {
    const db = makeDb({ batchThrows: true });
    const env = { DB: db } as unknown as Env;

    await expect(
      provisionAgencyTenant(env, { email: 'fail@exemple.ca', name: 'Y', passwordHash: 'h' }),
    ).rejects.toThrow(/constraint failed/);

    // Le batch a bien été tenté.
    expect(db.batch).toHaveBeenCalledTimes(1);

    // Compensation : 5 DELETE, ordre inverse de l'insertion.
    const deletes = db.calls.filter((c: RecordedStmt) => /^DELETE FROM/i.test(c.sql));
    expect(deletes).toHaveLength(5);
    expect(deletes[0].sql).toMatch(/DELETE FROM subscriptions WHERE id = \?/);
    expect(deletes[1].sql).toMatch(/DELETE FROM user_sub_accounts WHERE id = \?/);
    expect(deletes[2].sql).toMatch(/DELETE FROM users WHERE id = \?/);
    expect(deletes[3].sql).toMatch(/DELETE FROM clients WHERE id = \?/);
    expect(deletes[4].sql).toMatch(/DELETE FROM agencies WHERE id = \?/);
  });

  it('compensation best-effort : un DELETE qui échoue ne masque pas l\'erreur d\'origine', async () => {
    const db = makeDb({ batchThrows: true });
    // Fait échouer le tout premier DELETE de la compensation.
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/DELETE FROM subscriptions/i.test(sql)) {
        stmt.run = vi.fn(async () => { throw new Error('delete boom'); });
      }
      return stmt;
    };
    const env = { DB: db } as unknown as Env;

    // L'erreur propagée reste celle du batch, PAS « delete boom ».
    await expect(
      provisionAgencyTenant(env, { email: 'be@exemple.ca', name: 'Z', passwordHash: 'h' }),
    ).rejects.toThrow(/constraint failed/);
  });
});
