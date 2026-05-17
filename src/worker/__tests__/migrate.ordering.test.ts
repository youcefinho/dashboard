// ── Tests S2 M1 — ordre des migrations (manifest vs fallback 5-buckets) ──
// Non exécutés sur la VM (pas de bun/node) — Rochdi run via Antigravity.
// Déterministes : fs mocké, aucun accès disque réel, aucun wrangler.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// État du faux filesystem, piloté test-par-test.
const fsState: { files: Record<string, string> } = { files: {} };

vi.mock('fs', () => ({
  existsSync: (p: string) => p in fsState.files,
  readFileSync: (p: string) => {
    if (!(p in fsState.files)) throw new Error(`ENOENT mock: ${p}`);
    return fsState.files[p];
  },
  // readdirSync non utilisé par getOrderedMigrations (on passe allFiles).
  readdirSync: () => [],
}));

import { getOrderedMigrations, getOrderedMigrationsFallback } from '../../../scripts/migrate';

const ROOT = '/proj';
const MANIFEST_PATH = `${ROOT}/docs/migrations-manifest.json`;

function manifest(entries: Array<{ seq: number; file: string }>) {
  return JSON.stringify({ _meta: { read_only: true }, migrations: entries });
}

beforeEach(() => {
  fsState.files = {};
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('getOrderedMigrations — manifest présent', () => {
  it('retourne l\'ordre du manifest trié par seq, filtré aux fichiers présents', () => {
    fsState.files[MANIFEST_PATH] = manifest([
      { seq: 3, file: 'migration-phase3.sql' },
      { seq: 1, file: 'migration-phase1.sql' },
      { seq: 2, file: 'migration-phase2.sql' },
    ]);
    const allFiles = ['migration-phase2.sql', 'migration-phase1.sql', 'migration-phase3.sql'];

    const ordered = getOrderedMigrations(allFiles, ROOT);

    expect(ordered).toEqual([
      'migration-phase1.sql',
      'migration-phase2.sql',
      'migration-phase3.sql',
    ]);
  });

  it('inclut les fichiers sprint43+/sprintE* (bug 5-buckets corrigé)', () => {
    fsState.files[MANIFEST_PATH] = manifest([
      { seq: 1, file: 'migration-phase1.sql' },
      { seq: 50, file: 'migration-sprint43.sql' },
      { seq: 73, file: 'migration-sprintE9-m1.sql' },
    ]);
    const allFiles = [
      'migration-phase1.sql',
      'migration-sprint43.sql',
      'migration-sprintE9-m1.sql',
    ];

    const ordered = getOrderedMigrations(allFiles, ROOT);

    expect(ordered).toContain('migration-sprint43.sql');
    expect(ordered).toContain('migration-sprintE9-m1.sql');
    // Le fallback 5-buckets aurait DROP ces fichiers : on prouve la non-régression.
    expect(getOrderedMigrationsFallback(allFiles)).not.toContain('migration-sprint43.sql');
  });

  it('warn (pas crash) si le manifest référence un fichier absent sur disque', () => {
    fsState.files[MANIFEST_PATH] = manifest([
      { seq: 1, file: 'migration-phase1.sql' },
      { seq: 2, file: 'migration-fantome.sql' },
    ]);
    const allFiles = ['migration-phase1.sql'];

    const ordered = getOrderedMigrations(allFiles, ROOT);

    expect(ordered).toEqual(['migration-phase1.sql']);
    expect(console.warn).toHaveBeenCalled();
  });

  it('warn (pas crash) si un fichier disque est absent du manifest', () => {
    fsState.files[MANIFEST_PATH] = manifest([{ seq: 1, file: 'migration-phase1.sql' }]);
    const allFiles = ['migration-phase1.sql', 'migration-orphelin.sql'];

    const ordered = getOrderedMigrations(allFiles, ROOT);

    expect(ordered).toEqual(['migration-phase1.sql']);
    expect(ordered).not.toContain('migration-orphelin.sql');
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('getOrderedMigrations — fallback 5-buckets', () => {
  const allFiles = [
    'migration-phase13.sql',
    'migration-phase1.sql',
    'migration_p3_2.sql',
    'migration-sprint2-phase0.sql',
    'migration-sprint3.sql',
    'migration-phase14.sql',
  ];

  it('fallback EXACT quand manifest absent (zéro régression)', () => {
    const ordered = getOrderedMigrations(allFiles, ROOT);
    expect(ordered).toEqual(getOrderedMigrationsFallback(allFiles));
    expect(console.warn).toHaveBeenCalled();
  });

  it('fallback quand JSON invalide', () => {
    fsState.files[MANIFEST_PATH] = '{ broken json';
    const ordered = getOrderedMigrations(allFiles, ROOT);
    expect(ordered).toEqual(getOrderedMigrationsFallback(allFiles));
  });

  it('fallback quand manifest sans tableau migrations exploitable', () => {
    fsState.files[MANIFEST_PATH] = JSON.stringify({ _meta: {}, migrations: [] });
    const ordered = getOrderedMigrations(allFiles, ROOT);
    expect(ordered).toEqual(getOrderedMigrationsFallback(allFiles));
  });

  it('ordre 5-buckets : phaseEarly → p3 → sprint2 → sprint3 → phaseLate', () => {
    const ordered = getOrderedMigrationsFallback(allFiles);
    expect(ordered).toEqual([
      'migration-phase1.sql',
      'migration-phase13.sql',
      'migration_p3_2.sql',
      'migration-sprint2-phase0.sql',
      'migration-sprint3.sql',
      'migration-phase14.sql',
    ]);
  });
});
