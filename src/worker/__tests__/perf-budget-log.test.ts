// ── perf-budget-log.test.ts — Sprint 25 (Manager-B) ──────────────────────
//
// Couvre src/worker/perf-budget-log.ts : logPerfBudget(env, payload, userId?).
//
// Stratégie de mock : on file un `Env` minimal (DB = MockD1) au handler. La
// fonction `audit` (helpers.ts) déclenchée pour severity='fail' fait elle-même
// un INSERT dans audit_log. On capture ces calls via db.calls et on filtre les
// INSERT INTO audit_log pour décider du PASS/FAIL.
//
// 6 tests : fail LCP, pass LCP, needs-improvement LCP (pas d'audit), TTFB hors
// TRACKED, console.warn sur fail, never-throws.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement. Glob : src/worker/__tests__/**/*.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { logPerfBudget } from '../perf-budget-log';

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  const env = { DB: db } as unknown as Env;
  return { env, db };
}

function auditInsertCount(db: ReturnType<typeof createMockD1>): number {
  return db.calls.filter((c) => /INSERT INTO audit_log/i.test(c.sql)).length;
}

describe('Sprint 25 — logPerfBudget', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('LCP value=5000 (fail >4000) → INSERT audit_log perf.budget_exceeded', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'LCP', value: 5000 });

    const inserts = db.calls.filter((c) => /INSERT INTO audit_log/i.test(c.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    // action = 3e binding (cf. helpers.ts:120-123 ordre user_id, action, ...).
    const args = inserts[0]!.args;
    expect(args[1]).toBe('perf.budget_exceeded');
    expect(args[2]).toBe('web_vitals');
  });

  it('LCP value=2000 (pass <=2500) → aucun INSERT audit_log', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'LCP', value: 2000 });
    expect(auditInsertCount(db)).toBe(0);
  });

  it('LCP value=3000 (needs-improvement) → aucun INSERT audit_log', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'LCP', value: 3000 });
    expect(auditInsertCount(db)).toBe(0);
  });

  it('TTFB value=5000 (hors TRACKED set {LCP,CLS,INP}) → aucun INSERT', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'TTFB', value: 5000 });
    expect(auditInsertCount(db)).toBe(0);
  });

  it('FCP value=10000 (hors TRACKED set) → aucun INSERT', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'FCP', value: 10000 });
    expect(auditInsertCount(db)).toBe(0);
  });

  it('CLS value=0.30 (fail >0.25) → INSERT audit_log perf.budget_exceeded', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'CLS', value: 0.30 });

    const inserts = db.calls.filter((c) => /INSERT INTO audit_log/i.test(c.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0]!.args[1]).toBe('perf.budget_exceeded');
  });

  it('INP value=600 (fail >500) → INSERT audit_log + console.warn', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'INP', value: 600 });

    expect(auditInsertCount(db)).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalled();
    const firstCall = warnSpy.mock.calls[0];
    // Le warn préfixe [PerfBudget] FAIL — on accepte n'importe quelle forme
    // tant que le payload est cité dans les args.
    expect(String(firstCall?.[0] ?? '')).toMatch(/PerfBudget/);
  });

  it('best-effort never-throws : payload malformé (name absent)', async () => {
    const { env, db } = makeEnv();
    await expect(
      logPerfBudget(env, { name: undefined as unknown as string, value: 5000 }),
    ).resolves.toBeUndefined();
    expect(auditInsertCount(db)).toBe(0);
  });

  it('best-effort never-throws : audit() qui throw (DB cassée)', async () => {
    // Env DB qui throw sur run() → logPerfBudget doit avaler silencieusement.
    const env = {
      DB: {
        prepare(_sql: string) {
          return {
            bind() {
              return this;
            },
            run() {
              throw new Error('DB connection closed');
            },
            all() {
              return { results: [] };
            },
            first() {
              return null;
            },
          };
        },
      },
    } as unknown as Env;

    await expect(logPerfBudget(env, { name: 'LCP', value: 5000 })).resolves.toBeUndefined();
  });

  it('userId optionnel : audit user_id = "system" quand userId absent', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'LCP', value: 5000 });
    const inserts = db.calls.filter((c) => /INSERT INTO audit_log/i.test(c.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0]!.args[0]).toBe('system');
  });

  it('userId fourni : audit user_id = userId', async () => {
    const { env, db } = makeEnv();
    await logPerfBudget(env, { name: 'LCP', value: 5000 }, 'user-42');
    const inserts = db.calls.filter((c) => /INSERT INTO audit_log/i.test(c.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0]!.args[0]).toBe('user-42');
  });
});
