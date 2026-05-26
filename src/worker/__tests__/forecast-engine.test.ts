// ══════════════════════════════════════════════════════════════════════════
// Tests — Forecast Engine (Sprint 14, Manager-B Phase B)
// ══════════════════════════════════════════════════════════════════════════
// DÉTERMINISTE, offline-safe : mock minimal de Env.DB (D1) en mémoire. Aucun
// réseau, aucun LLM. Vérifie : bornage tenant, pondération deal_value×proba,
// buckétage stage→horizon (PAS de +90j), objectifs vs réalisé, scénarios bornés,
// group-by rep/source, CRUD targets. Lancé côté hôte (bun test / vitest).
//
// NB : filesystem VMware Z: sans runner → non exécuté ici, validation hôte.

import {
  handleGetForecast,
  handleGetForecastTargets,
  handleCreateForecastTarget,
  handleDeleteForecastTarget,
  FORECAST_ENUMS,
} from '../forecast-engine';

// ── Mock D1 minimal : matche les requêtes par mots-clés et renvoie des rows ──
type Row = Record<string, unknown>;

function makeDB(fixtures: {
  openLeads?: Row[];
  realizedLeads?: Row[];
  orders?: Row[];
  targets?: Row[];
  baseline?: Row | null;
  inserted?: Row[];
  deleted?: { id: string; clientId: string }[];
}) {
  const store = {
    inserted: fixtures.inserted ?? [],
    deleted: fixtures.deleted ?? [],
    targets: fixtures.targets ?? [],
  };
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async all() {
          if (/FROM leads l\s+JOIN pipeline_stages/i.test(sql)) {
            return { results: fixtures.openLeads ?? [] };
          }
          if (/status IN \('won','closed'\)/i.test(sql) && /FROM leads/i.test(sql)) {
            return { results: fixtures.realizedLeads ?? [] };
          }
          if (/FROM orders/i.test(sql)) {
            return { results: fixtures.orders ?? [] };
          }
          if (/FROM forecast_targets/i.test(sql)) {
            return { results: store.targets };
          }
          return { results: [] };
        },
        async first() {
          if (/FROM conversion_baselines/i.test(sql)) {
            return fixtures.baseline ?? null;
          }
          return null;
        },
        async run() {
          if (/^\s*INSERT INTO forecast_targets/i.test(sql)) {
            store.inserted.push({ args: bound });
          }
          if (/^\s*DELETE FROM forecast_targets/i.test(sql)) {
            store.deleted.push({ id: String(bound[0]), clientId: String(bound[1]) });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return { env: { DB } as any, store };
}

// Auth mode-agence avec capability reports.view (passe le capGuard).
const authOk = {
  tenant: { clientId: 'C1', agencyId: 'A1' },
  capabilities: new Set(['reports.view']),
} as any;

// Auth mode-agence SANS capability (doit être refusé 403).
const authNoCap = {
  tenant: { clientId: 'C1', agencyId: 'A1' },
  capabilities: new Set<string>(),
} as any;

async function bodyOf(res: Response): Promise<any> {
  return res.json();
}

// ── Tests (style describe/it neutre — compatible bun:test / vitest) ──────────
import { describe, it, expect } from 'vitest';

describe('forecast-engine', () => {
  it('FORECAST_ENUMS expose group_by et scenario', () => {
    expect(FORECAST_ENUMS.group_by).toContain('rep');
    expect(FORECAST_ENUMS.scenario).toContain('worst');
  });

  it('capGuard refuse en mode agence sans reports.view', async () => {
    const { env } = makeDB({});
    const res = await handleGetForecast(env, authNoCap, new URL('https://x/api/forecast'));
    expect(res.status).toBe(403);
  });

  it('pondère deal_value × probability et bucket stage→horizon (PAS +90j)', async () => {
    // Proba 80 → horizon 0 (mois ancre). Proba 20 → horizon 3.
    const { env } = makeDB({
      openLeads: [
        { deal_value: 1000, probability: 80, assigned_to: 'u1', utm_source: 'google',
          created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-10T00:00:00Z' },
        { deal_value: 1000, probability: 20, assigned_to: 'u2', utm_source: 'fb',
          created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-02T00:00:00Z' },
      ],
    });
    const res = await handleGetForecast(env, authOk,
      new URL('https://x/api/forecast?period=2026-05'));
    const { data } = await bodyOf(res);
    // weighted: 1000*0.8=800 (2026-05), 1000*0.2=200 (2026-08, +3 mois).
    const may = data.points.find((p: any) => p.period_month === '2026-05');
    const aug = data.points.find((p: any) => p.period_month === '2026-08');
    expect(may.weighted).toBe(800);
    expect(aug.weighted).toBe(200);
    // Aucun bucket à +90j (~2026-08-08 → mais déterministe stage-based, pas date).
  });

  it('scénarios best/likely/worst bornés (×1.25 / ×1.0 / ×0.7) sans baseline', async () => {
    const { env } = makeDB({
      openLeads: [
        { deal_value: 1000, probability: 50, assigned_to: '', utm_source: '',
          created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
      ],
      baseline: null,
    });
    const res = await handleGetForecast(env, authOk,
      new URL('https://x/api/forecast?period=2026-05'));
    const { data } = await bodyOf(res);
    // weightedTotal = 500. likelyFactor=1.0 (pas de baseline).
    expect(data.scenarios.likely).toBe(500);
    expect(data.scenarios.best).toBe(625);   // 500*1.25
    expect(data.scenarios.worst).toBe(350);  // 500*0.7
  });

  it('objectifs vs réalisé : target/actual par mois (leads won + orders/100)', async () => {
    const { env } = makeDB({
      realizedLeads: [{ period_month: '2026-04', actual: 3000 }],
      orders: [{ period_month: '2026-04', total_cents: 200000 }], // 2000 monétaire
      // Le mock D1 retourne le seed tel quel pour `FROM forecast_targets`. Le
      // handler interroge `SELECT period_month, SUM(target_amount) AS target`
      // ⇒ on shape le seed sur la forme aggregée (period_month + target), pas
      // sur la forme row brute (target_amount).
      targets: [{ period_month: '2026-04', target: 6000 }],
    });
    const res = await handleGetForecast(env, authOk,
      new URL('https://x/api/forecast?period=2026-04'));
    const { data } = await bodyOf(res);
    const apr = data.points.find((p: any) => p.period_month === '2026-04');
    expect(apr.actual).toBe(5000); // 3000 + 200000/100
    expect(apr.target).toBe(6000);
  });

  it('group_by=rep renvoie by_rep trié', async () => {
    const { env } = makeDB({
      openLeads: [
        { deal_value: 1000, probability: 100, assigned_to: 'u1', utm_source: 'g',
          created_at: '2026-05-01', updated_at: '2026-05-01' },
        { deal_value: 500, probability: 100, assigned_to: 'u2', utm_source: 'g',
          created_at: '2026-05-01', updated_at: '2026-05-01' },
      ],
    });
    const res = await handleGetForecast(env, authOk,
      new URL('https://x/api/forecast?group_by=rep&period=2026-05'));
    const { data } = await bodyOf(res);
    expect(data.by_rep[0].key).toBe('u1');
    expect(data.by_rep[0].weighted).toBe(1000);
    expect(data.by_source).toBeUndefined();
  });

  it('CRUD : create exige period_month YYYY-MM et borne client_id de l auth', async () => {
    const { env, store } = makeDB({});
    const bad = await handleCreateForecastTarget(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ target_amount: 100 }) }),
      env, authOk,
    );
    expect(bad.status).toBe(400);

    const ok = await handleCreateForecastTarget(
      new Request('https://x', { method: 'POST',
        body: JSON.stringify({ period_month: '2026-06', target_amount: 9000, client_id: 'HACK' }) }),
      env, authOk,
    );
    expect(ok.status).toBe(201);
    // client_id inséré = celui de l'auth ('C1'), JAMAIS le body 'HACK'.
    const args = store.inserted[0].args as unknown[];
    expect(args[1]).toBe('C1');
  });

  it('CRUD : delete borné tenant (id AND client_id de l auth)', async () => {
    const { env, store } = makeDB({});
    const res = await handleDeleteForecastTarget(env, authOk, 't1');
    const { data } = await bodyOf(res);
    expect(data.success).toBe(true);
    expect(store.deleted[0]).toEqual({ id: 't1', clientId: 'C1' });
  });

  it('list targets bornée tenant', async () => {
    const { env } = makeDB({
      targets: [{ id: 't1', client_id: 'C1', agency_id: null, pipeline_id: null,
        assigned_to: null, period_month: '2026-06', target_amount: 5000, created_at: '2026-06-01' }],
    });
    const res = await handleGetForecastTargets(env, authOk, new URL('https://x/api/forecast/targets'));
    const { data } = await bodyOf(res);
    expect(data.targets).toHaveLength(1);
    expect(data.targets[0].target_amount).toBe(5000);
  });
});
