// ── snapshots-import-idempotent.test.ts — Sprint 35 Phase C (agent C2) ────
//
// 4 cas vitest pour applyImport + remapEntityIds (A2 — snapshot-import.ts) :
//
//   1) Import dry_run vers tenant B vide
//      → toutes 'created' (virtuels), ZÉRO INSERT (run() jamais appelé).
//
//   2) Import commit vers tenant B vide
//      → toutes 'created' avec nouveaux UUIDs + FK pipeline_stages.pipeline_id
//      remappée vers mapping.pipelines[old_id] (cohérence cross-entity).
//
//   3) Re-import même bundle 2x
//      → toutes 'skipped' (idempotence par (client_id, name)) + mapping[old]
//      pointe vers l'ID existant côté target (préserve FK enfants).
//
//   4) client_id force overwrite vers target (jamais source preserved)
//      → SQL INSERT bind contient client_id='B', pas 'A'.
//
// Mocks :
//   - D1 chainable (prepare → bind → first/run) avec CAPTURE des appels
//     { sql, binds } pour assertion fine de l'INSERT et des SELECT EXISTS.
//   - Pas de réseau, pas de filesystem.

import { describe, it, expect, vi } from 'vitest';
import { applyImport, remapEntityIds } from '../lib/snapshot-import';
import type { SnapshotBundle } from '../lib/snapshot-export';
import type { Env } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

interface Call {
  sql: string;
  binds: unknown[];
  op: 'first' | 'run' | 'all';
}

/**
 * makeDb — D1 mock chainable. `firstResolver(sql, binds)` permet au test de
 * décider dynamiquement le retour de chaque SELECT (utile pour simuler
 * "tenant B vide" vs "row already exists").
 *
 * Tous les appels prepare(sql)+bind(...args)+{first|run|all}() sont capturés
 * dans `calls` pour assertion fine côté test.
 */
function makeDb(opts: {
  firstResolver?: (sql: string, binds: unknown[]) => unknown | null;
  runResolver?: (sql: string, binds: unknown[]) => unknown;
} = {}) {
  const calls: Call[] = [];
  let pendingSql = '';
  let pendingBinds: unknown[] = [];

  const stmt = {
    bind: vi.fn((...args: unknown[]) => {
      pendingBinds = args;
      return stmt;
    }),
    first: vi.fn(async () => {
      const sql = pendingSql;
      const binds = pendingBinds;
      calls.push({ sql, binds, op: 'first' });
      const r = opts.firstResolver ? opts.firstResolver(sql, binds) : null;
      return r ?? null;
    }),
    run: vi.fn(async () => {
      const sql = pendingSql;
      const binds = pendingBinds;
      calls.push({ sql, binds, op: 'run' });
      return opts.runResolver
        ? opts.runResolver(sql, binds)
        : { success: true, meta: { changes: 1 } };
    }),
    all: vi.fn(async () => {
      const sql = pendingSql;
      const binds = pendingBinds;
      calls.push({ sql, binds, op: 'all' });
      return { results: [] };
    }),
  };

  const db = {
    prepare: vi.fn((sql: string) => {
      pendingSql = sql;
      pendingBinds = [];
      return stmt;
    }),
  };

  return { db, calls, stmt };
}

function makeEnv(dbOpts: Parameters<typeof makeDb>[0] = {}) {
  const { db, calls, stmt } = makeDb(dbOpts);
  const env = { DB: db } as unknown as Env;
  return { env, db, calls, stmt };
}

/**
 * Bundle fixture minimal — schema 1, magic 'intralys-snapshot-v1'.
 * `signature.hash_hex` n'est PAS vérifié par applyImport (c'est verifySignature
 * qui le fait, hors scope ici), on peut mettre n'importe quelle valeur.
 */
function makeBundle(
  entities: Partial<SnapshotBundle['entities']>,
  sourceClientId = 'A',
): SnapshotBundle {
  const fullEntities = {
    pipelines: [],
    pipeline_stages: [],
    lost_reasons: [],
    custom_field_defs: [],
    smart_lists: [],
    workflow_folders: [],
    workflows: [],
    workflow_steps: [],
    trigger_links: [],
    template_folders: [],
    email_templates: [],
    sms_templates: [],
    snippets: [],
    forms: [],
    form_field_options: [],
    lead_segments: [],
    task_templates: [],
    booking_event_types: [],
    calendars: [],
    availability_rules: [],
    catalog_items: [],
    ai_brand_voices: [],
    ivr_menus: [],
    quick_replies: [],
    saved_replies: [],
    report_templates: [],
    reputation_settings: [],
    ...entities,
  } as SnapshotBundle['entities'];

  return {
    magic: 'intralys-snapshot-v1',
    schema_version: 1,
    generated_at: '2026-05-24T00:00:00.000Z',
    source: {
      client_id: sourceClientId,
      agency_id: 'agA',
      name: 'test-bundle',
      description: null,
    },
    entities: fullEntities,
    signature: { algo: 'sha256', hash_hex: 'dummy_not_verified_here' },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Suite
// ══════════════════════════════════════════════════════════════════════════

describe('snapshot-import — idempotence + remap FK + tenant overwrite (Sprint 35 C2)', () => {
  // ────────────────────────────────────────────────────────────────────────
  // CAS 1 — dry_run vers tenant B vide : tout 'created' virtuel, ZÉRO INSERT
  // ────────────────────────────────────────────────────────────────────────
  it('1) dry_run vers tenant B vide → toutes "created", ZÉRO INSERT', async () => {
    // tenant B vide : firstResolver retourne null pour tous les SELECT EXISTS
    const { env, calls } = makeEnv({ firstResolver: () => null });

    const bundle = makeBundle({
      pipelines: [
        { id: 'old_p1', client_id: 'A', name: 'Pipe A' },
        { id: 'old_p2', client_id: 'A', name: 'Pipe B' },
      ],
      workflows: [{ id: 'old_w1', client_id: 'A', name: 'WF A' }],
    });

    const { summary, log } = await applyImport(env, bundle, {
      targetClientId: 'B',
      targetAgencyId: 'agB',
      mode: 'dry_run',
      startedBy: 'u1',
      importId: 'imp1',
    });

    // 3 rows toutes virtuellement créées
    expect(summary.totals.pipelines.created).toBe(2);
    expect(summary.totals.pipelines.skipped).toBe(0);
    expect(summary.totals.pipelines.failed).toBe(0);
    expect(summary.totals.workflows.created).toBe(1);
    expect(summary.totals.workflows.skipped).toBe(0);

    // 3 entries 'created' dans le log
    const created = log.filter((e) => e.action === 'created');
    expect(created).toHaveLength(3);

    // ZÉRO INSERT : aucun call op='run' (les SELECT EXISTS sont op='first')
    const inserts = calls.filter(
      (c) => c.op === 'run' && /^\s*INSERT\s+INTO/i.test(c.sql),
    );
    expect(inserts).toHaveLength(0);

    // En revanche les SELECT EXISTS ont bien été exécutés (3 pour les 3 rows)
    const selects = calls.filter((c) => c.op === 'first');
    expect(selects.length).toBeGreaterThanOrEqual(3);
  });

  // ────────────────────────────────────────────────────────────────────────
  // CAS 2 — commit vers tenant B vide : nouveaux UUIDs + FK remappées
  // ────────────────────────────────────────────────────────────────────────
  it('2) commit vers tenant B vide → nouveaux UUIDs + FK pipeline_id remappée', async () => {
    const { env, calls } = makeEnv({ firstResolver: () => null });

    const bundle = makeBundle({
      pipelines: [{ id: 'old_p1', client_id: 'A', name: 'P' }],
      pipeline_stages: [
        {
          id: 'old_s1',
          pipeline_id: 'old_p1',
          name: 'Stage 1',
          sort_order: 0,
        },
      ],
    });

    const { summary } = await applyImport(env, bundle, {
      targetClientId: 'B',
      targetAgencyId: 'agB',
      mode: 'commit',
      startedBy: 'u1',
      importId: 'imp1',
    });

    // Mapping généré : old_id → new UUID
    const newPipelineId = summary.id_mapping.pipelines['old_p1'];
    const newStageId = summary.id_mapping.pipeline_stages['old_s1'];
    expect(newPipelineId).toBeDefined();
    expect(newStageId).toBeDefined();
    // UUID format v4 (8-4-4-4-12 hex)
    expect(newPipelineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(newStageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // Et nouveaux UUIDs ≠ old_id
    expect(newPipelineId).not.toBe('old_p1');
    expect(newStageId).not.toBe('old_s1');

    // INSERT pipelines : bind contient le nouveau UUID en position 'id'
    const pipelineInsert = calls.find(
      (c) =>
        c.op === 'run' && /^INSERT INTO pipelines/i.test(c.sql),
    );
    expect(pipelineInsert).toBeDefined();
    expect(pipelineInsert!.binds).toContain(newPipelineId);

    // INSERT pipeline_stages : bind contient FK pipeline_id REMAPPÉE
    // vers le NEW UUID du pipeline parent (pas 'old_p1' qui n'existe pas en target)
    const stageInsert = calls.find(
      (c) =>
        c.op === 'run' && /^INSERT INTO pipeline_stages/i.test(c.sql),
    );
    expect(stageInsert).toBeDefined();
    expect(stageInsert!.binds).toContain(newStageId);
    expect(stageInsert!.binds).toContain(newPipelineId); // FK remappée
    expect(stageInsert!.binds).not.toContain('old_p1'); // ancienne FK absente
    expect(stageInsert!.binds).not.toContain('old_s1');

    // Compteurs
    expect(summary.totals.pipelines.created).toBe(1);
    expect(summary.totals.pipeline_stages.created).toBe(1);
    expect(summary.totals.pipelines.skipped).toBe(0);
    expect(summary.totals.pipeline_stages.skipped).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // CAS 3 — Re-import même bundle 2x : toutes 'skipped' + mapping vers existing
  // ────────────────────────────────────────────────────────────────────────
  it('3) re-import même bundle 2x → toutes "skipped", mapping pointe vers existing', async () => {
    // Tenant B contient DÉJÀ une pipeline nommée 'P' avec id='existing_p1'
    // → SELECT EXISTS WHERE name='P' retourne {id:'existing_p1'}
    const firstResolver = (sql: string, binds: unknown[]) => {
      // SELECT id FROM pipelines WHERE client_id = ? AND name = ? LIMIT 1
      if (/FROM pipelines\s+WHERE client_id/i.test(sql)) {
        // binds[0] = targetClientId 'B', binds[1] = 'P'
        if (binds[0] === 'B' && binds[1] === 'P') {
          return { id: 'existing_p1' };
        }
      }
      return null;
    };
    const { env, calls } = makeEnv({ firstResolver });

    const bundle = makeBundle({
      pipelines: [{ id: 'old_p1', client_id: 'A', name: 'P' }],
    });

    const { summary, log } = await applyImport(env, bundle, {
      targetClientId: 'B',
      targetAgencyId: 'agB',
      mode: 'commit',
      startedBy: 'u1',
      importId: 'imp1',
    });

    // 0 created, 1 skipped pour pipelines
    expect(summary.totals.pipelines.created).toBe(0);
    expect(summary.totals.pipelines.skipped).toBe(1);
    expect(summary.totals.pipelines.failed).toBe(0);

    // Log entry skipped avec reason
    const skipped = log.find(
      (e) => e.entity === 'pipelines' && e.action === 'skipped',
    );
    expect(skipped).toBeDefined();
    expect(skipped!.old_id).toBe('old_p1');
    expect(skipped!.new_id).toBe('existing_p1');
    expect(skipped!.reason).toBe('duplicate_by_name');

    // Mapping : old_p1 → existing_p1 (et PAS un UUID neuf)
    expect(summary.id_mapping.pipelines['old_p1']).toBe('existing_p1');

    // AUCUN INSERT pipelines exécuté (skip avant le run)
    const pipelineInserts = calls.filter(
      (c) => c.op === 'run' && /^INSERT INTO pipelines/i.test(c.sql),
    );
    expect(pipelineInserts).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // CAS 4 — client_id force overwrite vers target (§6.6 bornage tenant)
  // ────────────────────────────────────────────────────────────────────────
  it('4) client_id source "A" → forcé "B" target dans INSERT bind (jamais preserved)', async () => {
    const { env, calls } = makeEnv({ firstResolver: () => null });

    const bundle = makeBundle(
      {
        pipelines: [
          { id: 'old_p1', client_id: 'A', name: 'X', agency_id: 'agA' },
        ],
      },
      'A',
    );

    await applyImport(env, bundle, {
      targetClientId: 'B',
      targetAgencyId: 'agB',
      mode: 'commit',
      startedBy: 'u1',
      importId: 'imp1',
    });

    const pipelineInsert = calls.find(
      (c) => c.op === 'run' && /^INSERT INTO pipelines/i.test(c.sql),
    );
    expect(pipelineInsert).toBeDefined();

    // L'INSERT doit binder client_id='B' (target), PAS 'A' (source)
    // Reconstitue { col → value } depuis le SQL + binds pour assertion fine.
    const colsMatch = pipelineInsert!.sql.match(/\(([^)]+)\) VALUES/);
    expect(colsMatch).toBeTruthy();
    const cols = colsMatch![1]!
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, ''));
    const bindMap: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      bindMap[col] = pipelineInsert!.binds[i];
    });

    expect(bindMap.client_id).toBe('B'); // FORCÉ target
    expect(bindMap.client_id).not.toBe('A'); // jamais source preserved
    expect(bindMap.agency_id).toBe('agB'); // FORCÉ target aussi (§6.6)
    expect(bindMap.name).toBe('X'); // name préservé du bundle
  });

  // ────────────────────────────────────────────────────────────────────────
  // BONUS sanity — remapEntityIds (pur, sans DB) — vérifie FK cross-entity
  // ────────────────────────────────────────────────────────────────────────
  it('remapEntityIds — FK pipeline_id remappée via global map (pur, sans DB)', () => {
    const bundle = makeBundle({
      pipelines: [{ id: 'old_p1', client_id: 'A', name: 'P' }],
      pipeline_stages: [
        { id: 'old_s1', pipeline_id: 'old_p1', name: 'S', sort_order: 0 },
      ],
    });
    const { remapped, mapping } = remapEntityIds(bundle);

    const newPipelineId = mapping.pipelines['old_p1'];
    const newStageId = mapping.pipeline_stages['old_s1'];
    expect(newPipelineId).toBeDefined();
    expect(newStageId).toBeDefined();

    const stageRow = remapped.entities.pipeline_stages[0] as Record<
      string,
      unknown
    >;
    expect(stageRow.id).toBe(newStageId);
    expect(stageRow.pipeline_id).toBe(newPipelineId); // FK remappée
    expect(stageRow.pipeline_id).not.toBe('old_p1');
  });
});
