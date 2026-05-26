// ══════════════════════════════════════════════════════════════════════════
// Tests — Snapshot Export Coverage (Sprint 35 / LOT SNAPSHOTS, Agent C1)
// ══════════════════════════════════════════════════════════════════════════
// DÉTERMINISTE, offline-safe : mock minimal de Env.DB (D1) en mémoire.
// Couvre 5 cas critiques de `src/worker/lib/snapshot-export.ts` :
//   1. collectSnapshotPayload sur tenant peuplé → 27 clés (Array) non-vides
//   2. SQL exécuté avec LIMIT 10000 par entité (borne dure)
//   3. client_id présent sur 100 % des rows collectées
//   4. Table manquante (prepare throw) → entity bundle vide, pas de crash
//   5. signPayload + serializeBundle DETERMINISTE + reproductible

import { describe, it, expect, vi } from 'vitest';
import {
  collectSnapshotPayload,
  signPayload,
  serializeBundle,
  SNAPSHOTTABLE_ENTITIES,
  SNAPSHOT_MAGIC_HEADER,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotBundle,
  type SnapshottableEntity,
} from '../lib/snapshot-export';
import type { Env } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * Identifie l'entité ciblée par une string SQL `SELECT * FROM <entity> ...`.
 * Retourne null si non reconnu (SELECT agency_id FROM clients par ex.).
 */
function matchEntity(sql: string): SnapshottableEntity | null {
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    // Match précis : `FROM <entity> WHERE` (évite collisions partielles).
    const re = new RegExp(`FROM\\s+${entity}\\s+WHERE`, 'i');
    if (re.test(sql)) return entity;
  }
  return null;
}

/**
 * Construit un stub D1 minimal qui :
 *  - sur SELECT agency_id FROM clients → retourne { agency_id }
 *  - sur SELECT * FROM <entity> → retourne entitiesData[entity] (ou [] par défaut)
 *  - sur entity ∈ throwOn → throw (simule table manquante)
 *
 * Trace toutes les prepare() pour assertions ultérieures.
 */
function makeStubD1(
  entitiesData: Partial<Record<SnapshottableEntity, Row[]>>,
  options?: {
    agencyId?: string | null;
    throwOn?: SnapshottableEntity[];
  },
): { DB: D1Database; prepareSpy: ReturnType<typeof vi.fn> } {
  const throwSet = new Set(options?.throwOn ?? []);
  const agencyId = options?.agencyId === undefined ? 'agency-x' : options.agencyId;

  const prepareSpy = vi.fn((sql: string) => {
    const entity = matchEntity(sql);
    if (entity && throwSet.has(entity)) {
      // Throw au moment du prepare → couvre le catch dans collectSnapshotPayload.
      throw new Error(`no such table: ${entity}`);
    }
    const stmt: Record<string, unknown> = {};
    stmt.bind = vi.fn().mockReturnValue(stmt);
    stmt.all = vi.fn().mockResolvedValue({
      results: entity ? entitiesData[entity] ?? [] : [],
      success: true,
      meta: {},
    });
    stmt.first = vi.fn().mockResolvedValue(
      /FROM clients/i.test(sql) ? { agency_id: agencyId } : null,
    );
    stmt.run = vi.fn().mockResolvedValue({ success: true, meta: {} });
    return stmt;
  });

  return {
    DB: { prepare: prepareSpy } as unknown as D1Database,
    prepareSpy,
  };
}

function makeEnv(DB: D1Database): Env {
  return { DB } as unknown as Env;
}

/**
 * Génère un set de rows fictif (1 row par entité, contenant client_id + id).
 */
function makePopulatedData(clientId: string): Partial<Record<SnapshottableEntity, Row[]>> {
  const data: Partial<Record<SnapshottableEntity, Row[]>> = {};
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    data[entity] = [
      { id: `${entity}_1`, client_id: clientId, name: `${entity} row 1` },
      { id: `${entity}_2`, client_id: clientId, name: `${entity} row 2` },
    ];
  }
  return data;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('snapshot-export — collectSnapshotPayload', () => {
  it('retourne EXACTEMENT 27 clés (entités whitelistées) toutes Array non-vides sur tenant peuplé', async () => {
    const clientId = 'cli_test';
    const data = makePopulatedData(clientId);
    const { DB } = makeStubD1(data);
    const env = makeEnv(DB);

    const bundle = await collectSnapshotPayload(env, clientId);

    // Shape : 27 clés exactes (matche la whitelist figée).
    const keys = Object.keys(bundle.entities);
    expect(keys.length).toBe(SNAPSHOTTABLE_ENTITIES.length);
    expect(keys.length).toBe(27);

    // Chaque clé est un Array et chaque entité whitelistée est présente.
    for (const entity of SNAPSHOTTABLE_ENTITIES) {
      expect(Array.isArray(bundle.entities[entity])).toBe(true);
      // Tenant peuplé → rows présents (2 par entité dans le fixture).
      expect(bundle.entities[entity].length).toBeGreaterThan(0);
    }

    // Header / source.
    expect(bundle.magic).toBe(SNAPSHOT_MAGIC_HEADER);
    expect(bundle.schema_version).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(bundle.source.client_id).toBe(clientId);
    expect(bundle.source.agency_id).toBe('agency-x');
  });

  it('exécute chaque SELECT d\'entité avec LIMIT 10000 (borne dure)', async () => {
    const clientId = 'cli_test';
    // Simule 10001 rows sur pipelines — le LIMIT doit être présent dans le SQL.
    const rows = Array.from({ length: 10001 }, (_, i) => ({
      id: `p_${i}`,
      client_id: clientId,
    }));
    const { DB, prepareSpy } = makeStubD1({ pipelines: rows });
    const env = makeEnv(DB);

    await collectSnapshotPayload(env, clientId);

    // Toutes les invocations SQL ciblant une entité whitelistée doivent
    // contenir "LIMIT 10000" (case-insensitive).
    const sqlCalls = prepareSpy.mock.calls.map((args) => String(args[0]));
    const entitySqls = sqlCalls.filter((sql) => matchEntity(sql) !== null);

    // Au moins 27 SELECT d'entités (un par whitelist).
    expect(entitySqls.length).toBe(SNAPSHOTTABLE_ENTITIES.length);

    for (const sql of entitySqls) {
      expect(sql).toMatch(/LIMIT\s+10000/i);
    }
  });

  it('chaque row collectée porte le client_id du tenant exporté (isolation tenant)', async () => {
    const clientId = 'cli_isolated';
    const data = makePopulatedData(clientId);
    const { DB } = makeStubD1(data);
    const env = makeEnv(DB);

    const bundle = await collectSnapshotPayload(env, clientId);

    let totalRows = 0;
    for (const entity of SNAPSHOTTABLE_ENTITIES) {
      const rows = bundle.entities[entity];
      for (const row of rows) {
        // Garantie : 100 % des rows portent le client_id attendu.
        expect(row.client_id).toBe(clientId);
        totalRows += 1;
      }
    }
    // Sanity check : on a bien collecté des rows (sinon la boucle passe trivialement).
    expect(totalRows).toBe(SNAPSHOTTABLE_ENTITIES.length * 2);
  });

  it('table manquante (prepare throw) → entity bundle = [] sans crasher tout l\'export', async () => {
    const clientId = 'cli_test';
    const data = makePopulatedData(clientId);
    // `snippets` n'existe pas (migration pas encore appliquée sur ce tenant).
    const { DB } = makeStubD1(data, { throwOn: ['snippets'] });
    const env = makeEnv(DB);

    const bundle = await collectSnapshotPayload(env, clientId);

    // L'entité manquante doit être présente sous forme de Array vide.
    expect(Array.isArray(bundle.entities.snippets)).toBe(true);
    expect(bundle.entities.snippets).toEqual([]);

    // Les autres entités doivent continuer à fonctionner normalement.
    expect(bundle.entities.pipelines.length).toBeGreaterThan(0);
    expect(bundle.entities.workflows.length).toBeGreaterThan(0);

    // Shape stable : toujours 27 clés malgré l'erreur ponctuelle.
    expect(Object.keys(bundle.entities).length).toBe(SNAPSHOTTABLE_ENTITIES.length);
  });
});

describe('snapshot-export — signPayload + serializeBundle (deterministic & reproducible)', () => {
  it('signPayload produit un hash SHA-256 deterministe + serializeBundle reproductible', async () => {
    // Fixture unsigned bundle (shape conforme à SnapshotBundle sans signature).
    const unsigned: Omit<SnapshotBundle, 'signature'> = {
      magic: SNAPSHOT_MAGIC_HEADER,
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      generated_at: '2026-05-24T12:00:00.000Z',
      source: {
        client_id: 'cli_fixture',
        agency_id: 'agency-fixture',
        name: 'Fixture Client',
        description: null,
      },
      // Initialise toutes les 27 entités à [] sauf pipelines (1 row).
      entities: SNAPSHOTTABLE_ENTITIES.reduce(
        (acc, entity) => {
          acc[entity] = [];
          return acc;
        },
        {} as Record<SnapshottableEntity, Array<Record<string, unknown>>>,
      ),
    };
    unsigned.entities.pipelines = [
      { id: 'p_1', client_id: 'cli_fixture', name: 'Vente' },
    ];

    // Deux signatures successives sur le MÊME payload → MÊME hash (deterministe).
    const signed1 = await signPayload(unsigned);
    const signed2 = await signPayload(unsigned);

    expect(signed1.signature.algo).toBe('sha256');
    expect(signed1.signature.hash_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(signed1.signature.hash_hex).toBe(signed2.signature.hash_hex);

    // Deux sérialisations successives → string EXACTEMENT identique.
    const serialize1 = serializeBundle(signed1);
    const serialize2 = serializeBundle(signed2);
    expect(serialize1).toBe(serialize2);

    // Bonus : la sérialisation doit être un JSON valide qui contient le hash.
    expect(() => JSON.parse(serialize1)).not.toThrow();
    expect(serialize1).toContain(signed1.signature.hash_hex);
  });
});
