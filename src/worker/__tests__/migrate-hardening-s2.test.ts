// ════════════════════════════════════════════════════════════════════════════
// Sprint 2 — Tests durcissement runner migrate.ts (§2-D)
// ════════════════════════════════════════════════════════════════════════════
//
// Trou 1 : fichier sur disque absent du manifest → ERREUR DURE (retour []).
// Trou 2 : fallback 5-buckets + fichiers hors-portée (sprintE*/team-*/etc.) → STOP.
// Tests PURS (pas d'I/O) : getOrderedMigrations / hasFallbackUnsupportedFiles.

import { describe, it, expect, vi, afterEach } from 'vitest';

// On importe les fonctions exportées
import {
  getOrderedMigrations,
  hasFallbackUnsupportedFiles,
  FALLBACK_UNSUPPORTED_PATTERNS,
} from '../../../scripts/migrate';

// Mock fs pour injecter un manifest virtuel sans toucher au disque
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: actual.readdirSync,
  };
});

import { existsSync, readFileSync } from 'fs';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────

function makeManifest(entries: { seq: number; file: string }[]): string {
  return JSON.stringify({ migrations: entries });
}

const FAKE_ROOT = '/fake/root';

afterEach(() => {
  vi.restoreAllMocks();
  // Nettoyer exitCode si le test l'a positionné
  process.exitCode = undefined;
});

// ════════════════════════════════════════════════════════════
// Trou 1 : fichier sur disque absent du manifest → ERREUR DURE
// ════════════════════════════════════════════════════════════

describe('S2 §2-D — Trou 1 : fichier hors-manifest = ERREUR DURE', () => {
  it('retourne [] quand un fichier est sur disque mais hors manifest', () => {
    const manifest = makeManifest([
      { seq: 1, file: 'migration-phase1.sql' },
    ]);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(manifest);

    // Sur disque : le fichier du manifest + un intrus
    const allFiles = ['migration-phase1.sql', 'migration-team-lotA-seq79.sql'];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);

    // Le fichier intrus cause un STOP → retour []
    expect(result).toEqual([]);
  });

  it('inclut normalement les fichiers quand TOUS sont au manifest', () => {
    const manifest = makeManifest([
      { seq: 1, file: 'migration-phase1.sql' },
      { seq: 79, file: 'migration-team-lotA-seq79.sql' },
    ]);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(manifest);

    const allFiles = ['migration-phase1.sql', 'migration-team-lotA-seq79.sql'];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);

    expect(result).toEqual([
      'migration-phase1.sql',
      'migration-team-lotA-seq79.sql',
    ]);
  });

  it('ordonne par seq croissant quand manifest valide', () => {
    const manifest = makeManifest([
      { seq: 83, file: 'migration-funnel-seq83.sql' },
      { seq: 79, file: 'migration-team-lotA-seq79.sql' },
      { seq: 1, file: 'migration-phase1.sql' },
    ]);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(manifest);

    const allFiles = [
      'migration-funnel-seq83.sql',
      'migration-team-lotA-seq79.sql',
      'migration-phase1.sql',
    ];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);
    expect(result).toEqual([
      'migration-phase1.sql',
      'migration-team-lotA-seq79.sql',
      'migration-funnel-seq83.sql',
    ]);
  });
});

// ════════════════════════════════════════════════════════════
// Trou 2 : fallback 5-buckets + fichiers hors-portée → STOP
// ════════════════════════════════════════════════════════════

describe('S2 §2-D — Trou 2 : fallback 5-buckets + fichiers avancés → STOP', () => {
  it('hasFallbackUnsupportedFiles détecte les fichiers team-/invoice-/funnel-/sprintE*', () => {
    const files = [
      'migration-phase1.sql',
      'migration-team-lotA-seq79.sql',
      'migration-invoice-real-seq82.sql',
      'migration-funnel-seq83.sql',
      'migration-sprintE1-m1-ecommerce-schema.sql',
      'migration-sprintER-m1.sql',
      'migration-sprintLOT1-m1.sql',
      'migration-booking-seq84.sql',
      'migration-promo-seq85.sql',
      'migration-emailseq-seq86.sql',
      'migration-member-seq87.sql',
    ];
    const unsupported = hasFallbackUnsupportedFiles(files);
    // Tout sauf migration-phase1.sql
    expect(unsupported).toHaveLength(10);
    expect(unsupported).toContain('migration-team-lotA-seq79.sql');
    expect(unsupported).toContain('migration-invoice-real-seq82.sql');
    expect(unsupported).toContain('migration-funnel-seq83.sql');
    expect(unsupported).toContain('migration-sprintE1-m1-ecommerce-schema.sql');
    expect(unsupported).toContain('migration-sprintER-m1.sql');
    expect(unsupported).toContain('migration-sprintLOT1-m1.sql');
    expect(unsupported).toContain('migration-booking-seq84.sql');
    expect(unsupported).toContain('migration-promo-seq85.sql');
    expect(unsupported).toContain('migration-emailseq-seq86.sql');
    expect(unsupported).toContain('migration-member-seq87.sql');
  });

  it('hasFallbackUnsupportedFiles retourne [] pour les fichiers legacy', () => {
    const files = [
      'migration-phase1.sql',
      'migration-phase13.sql',
      'migration_p3_cleanup.sql',
      'migration-sprint2-phase0.sql',
    ];
    expect(hasFallbackUnsupportedFiles(files)).toEqual([]);
  });

  it('STOP quand manifest absent et fichiers avancés sur disque', () => {
    // Manifest absent → fallback
    mockExistsSync.mockReturnValue(false);

    const allFiles = [
      'migration-phase1.sql',
      'migration-sprintE1-m1-ecommerce-schema.sql',
    ];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);
    expect(result).toEqual([]);
  });

  it('fallback OK quand manifest absent et UNIQUEMENT fichiers legacy', () => {
    mockExistsSync.mockReturnValue(false);

    const allFiles = ['migration-phase1.sql', 'migration-phase13.sql'];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);
    // Le fallback peut les ordonner
    expect(result.length).toBeGreaterThan(0);
  });

  it('STOP quand manifest JSON invalide et fichiers avancés sur disque', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('NOT JSON AT ALL {{{');

    const allFiles = ['migration-phase1.sql', 'migration-team-lotA-seq79.sql'];

    const result = getOrderedMigrations(allFiles, FAKE_ROOT);
    expect(result).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// FALLBACK_UNSUPPORTED_PATTERNS coverage
// ════════════════════════════════════════════════════════════

describe('FALLBACK_UNSUPPORTED_PATTERNS — couverture regex', () => {
  const positives = [
    'migration-sprintE1-m1.sql',
    'migration-sprintER-m1.sql',
    'migration-sprintS7-m1.sql',
    'migration-sprintLOT1-m1.sql',
    'migration-team-lotA-seq79.sql',
    'migration-invoice-real-seq82.sql',
    'migration-funnel-seq83.sql',
    'migration-booking-seq84.sql',
    'migration-promo-seq85.sql',
    'migration-emailseq-seq86.sql',
    'migration-member-seq87.sql',
  ];
  const negatives = [
    'migration-phase1.sql',
    'migration-phase14.sql',
    'migration_p3_cleanup.sql',
    'migration-sprint2-phase0.sql',
    'migration-sprint3.sql',
    'migration-sprint43.sql',
  ];

  for (const f of positives) {
    it(`match: ${f}`, () => {
      expect(FALLBACK_UNSUPPORTED_PATTERNS.some(p => p.test(f))).toBe(true);
    });
  }

  for (const f of negatives) {
    it(`no match: ${f}`, () => {
      expect(FALLBACK_UNSUPPORTED_PATTERNS.some(p => p.test(f))).toBe(false);
    });
  }
});
