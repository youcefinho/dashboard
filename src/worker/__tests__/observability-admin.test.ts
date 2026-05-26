// ── observability-admin.test.ts — Sprint 24 (Manager-B) ─────────────────
//
// Couvre les 6 handlers de `observability-admin.ts` (le 7e — web-vitals —
// est déjà couvert par sd-observability.test.ts, on ne re-teste pas le proxy).
//
//   1. handleGetObservabilityHealth → shape { status, db, version, uptime_s,
//      ai_mock, migrations_count, last_migration }.
//   2. handleGetRequestMetrics → agrégat par route + p50/p95/p99 cohérents.
//   3. period invalide → 400 INVALID_INPUT.
//   4. handleListAlerts → { rules:[], events:[] } si tables vides.
//   5. handleCreateAlertRule → body valide INSERT + audit ; threshold négatif
//      → 400 ALERT_RULE_INVALID.
//   6. handleUpdateAlertRule → 404 ALERT_NOT_FOUND ; UPDATE partiel.
//   7. handleDeleteAlertRule → 404 si déjà supprimé (idempotent best-effort).
//   8. Dégradation : seq122 absente → unavailable:true 200.
//
// ⚠ Tests NON exécutés (VM VMware). Écrits pour vitest.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import {
  handleGetObservabilityHealth,
  handleGetRequestMetrics,
  handleGetErrorMetrics,
  handleListAlerts,
  handleCreateAlertRule,
  handleUpdateAlertRule,
  handleDeleteAlertRule,
} from '../observability-admin';

const AUTH = { userId: 'admin-1', role: 'admin' };

// ── Mock D1 spécialisé Sprint 24 ─────────────────────────────────────────
// Le mock d'`_helpers.createMockD1` partagé renvoie `.run() → changes:1` en
// dur, ce qui nous empêche de tester DELETE idempotent (404 si changes=0).
// On utilise donc des mocks ad-hoc pour avoir contrôle fin.

function makeEnv(opts: {
  // Health
  selectOneOk?: boolean;
  migrationsCount?: number | null;
  lastMigration?: { seq: number; file: string } | null;
  // Request metrics
  reqMetricsRows?: Array<{
    route: string;
    count: number;
    error_count: number;
    lat_sum: number;
    lat_max: number;
  }>;
  reqMetricsThrow?: boolean;
  // Error metrics
  errorRows?: Array<{ action: string; count: number; last_at: string }>;
  errorThrow?: boolean;
  // Alerts list
  alertRules?: Array<Record<string, unknown>>;
  alertEvents?: Array<Record<string, unknown>>;
  alertsThrow?: boolean;
  // CRUD
  ruleExistsId?: string;
  ruleFetchById?: Record<string, unknown> | null;
  generatedId?: string;
  deleteChanges?: number;
  // Audit log (best-effort)
  auditThrow?: boolean;
}): Env {
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
          if (
            lower.includes('from request_metrics') &&
            lower.includes('group by route')
          ) {
            if (opts.reqMetricsThrow) throw new Error('no such table: request_metrics');
            return { results: opts.reqMetricsRows ?? [] };
          }
          if (lower.includes("action like 'error.%'")) {
            if (opts.errorThrow) throw new Error('no such table: audit_log');
            return { results: opts.errorRows ?? [] };
          }
          if (lower.includes('from alert_rules') && lower.includes('order by created_at')) {
            if (opts.alertsThrow) throw new Error('no such table: alert_rules');
            return { results: opts.alertRules ?? [] };
          }
          if (lower.includes('from alert_events') && lower.includes('order by triggered_at')) {
            if (opts.alertsThrow) throw new Error('no such table: alert_events');
            return { results: opts.alertEvents ?? [] };
          }
          return { results: [] };
        },
        first: async () => {
          if (lower === 'select 1') return opts.selectOneOk === false ? null : { val: 1 };
          if (lower.includes('count(*) as c from _migrations')) {
            return opts.migrationsCount == null ? null : { c: opts.migrationsCount };
          }
          if (lower.includes('from _migrations order by seq desc')) {
            return opts.lastMigration ?? null;
          }
          if (lower.includes('lower(hex(randomblob(16))) as id')) {
            return { id: opts.generatedId ?? 'gen-id-1' };
          }
          if (lower.includes('select id from alert_rules where id =')) {
            const id = String(bound[0] ?? '');
            return opts.ruleExistsId && id === opts.ruleExistsId ? { id } : null;
          }
          if (lower.includes('select * from alert_rules where id =')) {
            return opts.ruleFetchById ?? null;
          }
          // health.ts : SELECT 1 / SELECT COUNT(*) FROM _migrations
          if (lower.includes('count(*) as c from _migrations')) {
            return opts.migrationsCount == null ? null : { c: opts.migrationsCount };
          }
          return null;
        },
        run: async () => {
          if (lower.startsWith('delete from alert_rules')) {
            return { success: true, meta: { changes: opts.deleteChanges ?? 0 } };
          }
          if (lower.startsWith('insert into audit_log')) {
            if (opts.auditThrow) throw new Error('no such column: request_id');
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { DB: db } as unknown as Env;
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://x.test${path}`, init);
}

// ── 1. health ──────────────────────────────────────────────────────────────

describe('Sprint 24 — handleGetObservabilityHealth', () => {
  it('retourne shape { status, db, version, uptime_s, ai_mock, migrations_count, last_migration }', async () => {
    const env = makeEnv({
      migrationsCount: 122,
      lastMigration: { seq: 122, file: 'migration-observability-seq122.sql' },
    });
    const res = await handleGetObservabilityHealth(env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('ok');
    expect(body.data.db).toBe('ok');
    expect(body.data.version).toBe('2.1.0');
    expect(typeof body.data.uptime_s).toBe('number');
    expect(typeof body.data.ai_mock).toBe('boolean');
    expect(body.data.migrations_count).toBe(122);
    expect(body.data.last_migration).toBe('122:migration-observability-seq122.sql');
  });

  it('migrations_count/last_migration null si _migrations absente (best-effort)', async () => {
    const env = makeEnv({}); // pas de migrationsCount / lastMigration
    const res = await handleGetObservabilityHealth(env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.migrations_count).toBeNull();
    expect(body.data.last_migration).toBeNull();
  });
});

// ── 2/3. request-metrics ──────────────────────────────────────────────────

describe('Sprint 24 — handleGetRequestMetrics', () => {
  it('agrège par route, p50/p95/p99/error_rate_pct cohérents', async () => {
    const env = makeEnv({
      reqMetricsRows: [
        { route: '/api/leads', count: 100, error_count: 5, lat_sum: 5000, lat_max: 800 },
        { route: '/api/health', count: 50, error_count: 0, lat_sum: 500, lat_max: 50 },
      ],
    });
    const res = await handleGetRequestMetrics(req('/api/admin/observability/request-metrics?period=24h'), env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { metrics: Array<Record<string, number | string>> };
    };
    expect(body.data.metrics.length).toBe(2);
    const leads = body.data.metrics[0]!;
    expect(leads.route).toBe('/api/leads');
    expect(leads.count).toBe(100);
    expect(leads.error_count).toBe(5);
    expect(leads.p50_ms).toBe(50); // 5000/100
    expect(leads.p99_ms).toBe(800); // lat_max
    expect(leads.p95_ms).toBe(760); // lat_max * 0.95
    expect(leads.error_rate_pct).toBe(5); // 5/100*100
  });

  it('period invalide → 400 INVALID_INPUT', async () => {
    const env = makeEnv({});
    const res = await handleGetRequestMetrics(req('/api/admin/observability/request-metrics?period=bogus'), env, AUTH);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('table seq122 absente → unavailable:true 200 (jamais 5xx)', async () => {
    const env = makeEnv({ reqMetricsThrow: true });
    const res = await handleGetRequestMetrics(req('/api/admin/observability/request-metrics?period=24h'), env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { metrics: unknown[]; unavailable?: boolean } };
    expect(body.data.unavailable).toBe(true);
    expect(body.data.metrics).toEqual([]);
  });

  it('period par défaut = 24h quand absent', async () => {
    const env = makeEnv({ reqMetricsRows: [] });
    const res = await handleGetRequestMetrics(req('/api/admin/observability/request-metrics'), env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { metrics: unknown[] } };
    expect(body.data.metrics).toEqual([]);
  });
});

// ── 4. errors ──────────────────────────────────────────────────────────────

describe('Sprint 24 — handleGetErrorMetrics', () => {
  it('retourne errors[] groupé par action', async () => {
    const env = makeEnv({
      errorRows: [
        { action: 'error.5xx', count: 12, last_at: '2026-05-22 10:00:00' },
      ],
    });
    const res = await handleGetErrorMetrics(req('/api/admin/observability/errors?period=7d'), env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { errors: Array<{ action: string; count: number }> } };
    expect(body.data.errors.length).toBe(1);
    expect(body.data.errors[0]!.action).toBe('error.5xx');
    expect(body.data.errors[0]!.count).toBe(12);
  });

  it('audit_log absente → unavailable:true 200', async () => {
    const env = makeEnv({ errorThrow: true });
    const res = await handleGetErrorMetrics(req('/api/admin/observability/errors?period=24h'), env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { errors: unknown[]; unavailable?: boolean } };
    expect(body.data.unavailable).toBe(true);
  });
});

// ── 5. list alerts ────────────────────────────────────────────────────────

describe('Sprint 24 — handleListAlerts', () => {
  it('tables vides → { rules:[], events:[] }', async () => {
    const env = makeEnv({});
    const res = await handleListAlerts(env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rules: unknown[]; events: unknown[] } };
    expect(body.data.rules).toEqual([]);
    expect(body.data.events).toEqual([]);
  });

  it('désérialise enabled 0/1 → boolean + payload JSON', async () => {
    const env = makeEnv({
      alertRules: [
        {
          id: 'r1',
          name: 'High errors',
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
        },
      ],
      alertEvents: [
        {
          id: 'e1',
          rule_id: 'r1',
          triggered_at: '2026-05-22 01:00:00',
          payload: JSON.stringify({ observed: 12, threshold: 5 }),
          resolved_at: null,
        },
      ],
    });
    const res = await handleListAlerts(env, AUTH);
    const body = (await res.json()) as {
      data: {
        rules: Array<{ id: string; enabled: boolean }>;
        events: Array<{ id: string; payload: Record<string, unknown> }>;
      };
    };
    expect(body.data.rules[0]!.enabled).toBe(true);
    expect(body.data.events[0]!.payload.observed).toBe(12);
  });

  it('tables absentes → [] best-effort', async () => {
    const env = makeEnv({ alertsThrow: true });
    const res = await handleListAlerts(env, AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rules: unknown[]; events: unknown[] } };
    expect(body.data.rules).toEqual([]);
    expect(body.data.events).toEqual([]);
  });
});

// ── 6. create rule ─────────────────────────────────────────────────────────

describe('Sprint 24 — handleCreateAlertRule', () => {
  const validBody = {
    name: 'Error rate > 5%',
    condition_type: 'error_rate',
    threshold: 5,
    window_minutes: 60,
    notification_channel: 'log',
  };

  it('body valide → INSERT + audit + rule retournée', async () => {
    const env = makeEnv({
      generatedId: 'rule-new-1',
      ruleFetchById: {
        id: 'rule-new-1',
        name: 'Error rate > 5%',
        condition_type: 'error_rate',
        metric_name: null,
        threshold: 5,
        window_minutes: 60,
        notification_channel: 'log',
        notification_target: '',
        enabled: 1,
        created_by: 'admin-1',
        created_at: '2026-05-22 00:00:00',
        updated_at: '2026-05-22 00:00:00',
      },
    });
    const res = await handleCreateAlertRule(
      req('/api/admin/observability/alert-rules', {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rule: { id: string; enabled: boolean } } };
    expect(body.data.rule.id).toBe('rule-new-1');
    expect(body.data.rule.enabled).toBe(true);
  });

  it('threshold négatif → 400 ALERT_RULE_INVALID', async () => {
    const env = makeEnv({});
    const res = await handleCreateAlertRule(
      req('/api/admin/observability/alert-rules', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, threshold: -1 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('ALERT_RULE_INVALID');
  });

  it('condition_type hors enum → 400 ALERT_RULE_INVALID', async () => {
    const env = makeEnv({});
    const res = await handleCreateAlertRule(
      req('/api/admin/observability/alert-rules', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, condition_type: 'bogus' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALERT_RULE_INVALID');
  });

  it('body absent / non-JSON → 400 ALERT_RULE_INVALID', async () => {
    const env = makeEnv({});
    const res = await handleCreateAlertRule(
      req('/api/admin/observability/alert-rules', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
    );
    expect(res.status).toBe(400);
  });
});

// ── 7. update rule ─────────────────────────────────────────────────────────

describe('Sprint 24 — handleUpdateAlertRule', () => {
  it("id inconnu → 404 ALERT_NOT_FOUND", async () => {
    const env = makeEnv({ ruleExistsId: undefined });
    const res = await handleUpdateAlertRule(
      req('/api/admin/observability/alert-rules/missing', {
        method: 'PATCH',
        body: JSON.stringify({ threshold: 10 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
      'missing',
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALERT_NOT_FOUND');
  });

  it('partial update valide → UPDATE + rule renvoyée', async () => {
    const env = makeEnv({
      ruleExistsId: 'rule-1',
      ruleFetchById: {
        id: 'rule-1',
        name: 'High errors',
        condition_type: 'error_rate',
        metric_name: null,
        threshold: 10, // updated
        window_minutes: 60,
        notification_channel: 'log',
        notification_target: '',
        enabled: 1,
        created_by: 'admin',
        created_at: '2026-05-22 00:00:00',
        updated_at: '2026-05-22 01:00:00',
      },
    });
    const res = await handleUpdateAlertRule(
      req('/api/admin/observability/alert-rules/rule-1', {
        method: 'PATCH',
        body: JSON.stringify({ threshold: 10 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
      'rule-1',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rule: { threshold: number } } };
    expect(body.data.rule.threshold).toBe(10);
  });

  it('threshold négatif → 400 ALERT_RULE_INVALID', async () => {
    const env = makeEnv({ ruleExistsId: 'rule-1' });
    const res = await handleUpdateAlertRule(
      req('/api/admin/observability/alert-rules/rule-1', {
        method: 'PATCH',
        body: JSON.stringify({ threshold: -1 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
      AUTH,
      'rule-1',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALERT_RULE_INVALID');
  });
});

// ── 8. delete rule ─────────────────────────────────────────────────────────

describe('Sprint 24 — handleDeleteAlertRule', () => {
  it('changes=1 → { ok:true }', async () => {
    const env = makeEnv({ deleteChanges: 1 });
    const res = await handleDeleteAlertRule(env, AUTH, 'rule-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it('changes=0 (déjà supprimé) → 404 ALERT_NOT_FOUND', async () => {
    const env = makeEnv({ deleteChanges: 0 });
    const res = await handleDeleteAlertRule(env, AUTH, 'rule-gone');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ALERT_NOT_FOUND');
  });
});
