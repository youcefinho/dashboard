// ── alert-evaluator.test.ts — Sprint 24 (Manager-B) ─────────────────────
//
// Couvre `evaluateAlertRules` :
//   1. error_rate > threshold → INSERT alert_events, channel='log' → warn.
//   2. enabled=0 → SKIP (le SELECT WHERE enabled=1 ne retourne pas la règle).
//   3. Pas de hits dans la fenêtre → no firing.
//   4. channel='webhook' → fetch best-effort appelé avec POST + JSON body.
//   5. Best-effort SWALLOW : err D1 sur la lecture des règles → {0,0}.
//   6. Retour { evaluated, fired } cohérent.
//
// ⚠ Tests NON exécutés (VM VMware). Écrits pour vitest.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env, AlertRuleRow } from '../types';
import { evaluateAlertRules } from '../lib/alert-evaluator';

// ── Mock D1 spécialisé : route selon la requête SQL.
//   - 'select * from alert_rules' (.all)        → rulesByQuery
//   - 'select 100.0 * sum' (.first, error_rate) → { v: errorRatePct }
//   - 'select count(*) as c from request_metrics' (.first) → { c: count }
//   - 'select latency_max_ms as v' (.first)     → { v: latencyMs }
//   - 'select count(*) as c from web_vitals' (.first) → { c: countVitals }
//   - 'select value as v from web_vitals' (.first) → { v: vitalValue }
//   - 'insert into alert_events' (.run)         → recorded in eventInserts
function makeEnv(opts: {
  rules?: AlertRuleRow[];
  errorRateValue?: number | null;
  reqCount?: number;
  latencyValue?: number | null;
  vitalCount?: number;
  vitalValue?: number | null;
  rulesThrow?: boolean;
}): { env: Env; eventInserts: Array<{ ruleId: string; payload: string }> } {
  const eventInserts: Array<{ ruleId: string; payload: string }> = [];
  const db = {
    prepare(sql: string) {
      const lower = sql.toLowerCase();
      let bound: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          bound = a;
          return stmt;
        },
        all: async () => {
          if (lower.includes('from alert_rules') && lower.includes('enabled = 1')) {
            if (opts.rulesThrow) throw new Error('no such table: alert_rules');
            return { results: opts.rules ?? [] };
          }
          return { results: [] };
        },
        first: async () => {
          if (lower.includes('100.0 * sum')) {
            return { v: opts.errorRateValue ?? null };
          }
          if (lower.includes('count(*) as c from request_metrics')) {
            return { c: opts.reqCount ?? 0 };
          }
          if (lower.includes('latency_max_ms as v')) {
            return opts.latencyValue == null ? null : { v: opts.latencyValue };
          }
          if (lower.includes('count(*) as c from web_vitals')) {
            return { c: opts.vitalCount ?? 0 };
          }
          if (lower.includes('value as v from web_vitals')) {
            return opts.vitalValue == null ? null : { v: opts.vitalValue };
          }
          return null;
        },
        run: async () => {
          if (lower.includes('insert into alert_events')) {
            eventInserts.push({
              ruleId: String(bound[0] ?? ''),
              payload: String(bound[1] ?? ''),
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } as unknown as Env, eventInserts };
}

function ruleErrorRate(over: Partial<AlertRuleRow> = {}): AlertRuleRow {
  return {
    id: 'rule-er-1',
    name: 'Error rate > 5%',
    condition_type: 'error_rate',
    metric_name: null,
    threshold: 5,
    window_minutes: 60,
    notification_channel: 'log',
    notification_target: '',
    enabled: 1,
    created_by: 'admin',
    created_at: '2026-05-22 00:00:00',
    updated_at: '2026-05-22 00:00:00',
    ...over,
  };
}

describe('Sprint 24 — evaluateAlertRules', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    warnSpy.mockClear();
    debugSpy.mockClear();
    fetchSpy.mockClear();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = origFetch;
  });

  it('error_rate au-dessus seuil → INSERT alert_event + warn (channel log)', async () => {
    const { env, eventInserts } = makeEnv({
      rules: [ruleErrorRate({ threshold: 5 })],
      errorRateValue: 12.5,
    });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(1);
    expect(result.fired).toBe(1);
    expect(eventInserts.length).toBe(1);
    expect(eventInserts[0]!.ruleId).toBe('rule-er-1');
    const payload = JSON.parse(eventInserts[0]!.payload) as Record<string, unknown>;
    expect(payload.observed).toBe(12.5);
    expect(payload.threshold).toBe(5);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rule disabled (enabled=0) → SELECT WHERE enabled=1 ne la voit pas, fired=0', async () => {
    // On simule le filtre côté query : pas de rule dans le SELECT.
    const { env, eventInserts } = makeEnv({
      rules: [], // déjà filtré par WHERE enabled=1
      errorRateValue: 50,
    });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(0);
    expect(result.fired).toBe(0);
    expect(eventInserts.length).toBe(0);
  });

  it('pas de hits dans la fenêtre (value null) → no firing', async () => {
    const { env, eventInserts } = makeEnv({
      rules: [ruleErrorRate({ threshold: 5 })],
      errorRateValue: null,
    });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(1);
    expect(result.fired).toBe(0);
    expect(eventInserts.length).toBe(0);
  });

  it('value <= threshold → no firing', async () => {
    const { env, eventInserts } = makeEnv({
      rules: [ruleErrorRate({ threshold: 50 })],
      errorRateValue: 12,
    });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(1);
    expect(result.fired).toBe(0);
    expect(eventInserts.length).toBe(0);
  });

  it('channel webhook → fetch POST best-effort appelé', async () => {
    const { env, eventInserts } = makeEnv({
      rules: [
        ruleErrorRate({
          notification_channel: 'webhook',
          notification_target: 'https://hook.example.com/alerts',
          threshold: 1,
        }),
      ],
      errorRateValue: 25,
    });
    const result = await evaluateAlertRules(env);
    expect(result.fired).toBe(1);
    expect(eventInserts.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('https://hook.example.com/alerts');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { observed: number; threshold: number };
    expect(body.observed).toBe(25);
    expect(body.threshold).toBe(1);
  });

  it('webhook KO (fetch throw) → fired++ quand même, never-throw', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    const { env } = makeEnv({
      rules: [
        ruleErrorRate({
          notification_channel: 'webhook',
          notification_target: 'https://hook.example.com/alerts',
          threshold: 1,
        }),
      ],
      errorRateValue: 25,
    });
    const result = await evaluateAlertRules(env);
    expect(result.fired).toBe(1);
  });

  it('best-effort SWALLOW : SELECT alert_rules KO → {evaluated:0, fired:0}', async () => {
    const { env } = makeEnv({ rulesThrow: true });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(0);
    expect(result.fired).toBe(0);
  });

  it('retour { evaluated, fired } cumule plusieurs règles', async () => {
    // 2 règles error_rate, l'une firing, l'autre sous seuil.
    // Le mock retourne la même errorRateValue pour les deux (limitation du mock,
    // mais le test vérifie surtout le compteur evaluated).
    const { env, eventInserts } = makeEnv({
      rules: [
        ruleErrorRate({ id: 'r1', threshold: 1 }), // fire
        ruleErrorRate({ id: 'r2', threshold: 99 }), // skip
      ],
      errorRateValue: 10,
    });
    const result = await evaluateAlertRules(env);
    expect(result.evaluated).toBe(2);
    expect(result.fired).toBe(1);
    expect(eventInserts.length).toBe(1);
    expect(eventInserts[0]!.ruleId).toBe('r1');
  });
});
