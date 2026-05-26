// ── snapshot-import-engine.ts — Pure helpers validation bundle import ───────
// Utils P2-2 RENFORCEMENT — helpers PURS pour `snapshot-import.ts` (parseBundle,
// validateBundleSchema, verifySignature, applyImport). ZÉRO I/O, ZÉRO state D1.
//
// Couvre :
//   - Manifest validation (magic + schema_version + signature + source)
//   - Bundle integrity (SHA-256 verify deterministic)
//   - Import mode whitelist ('dry_run' | 'commit')
//   - Per-entity validation (whitelist 27 entities + types)
//   - Summary computation (created/skipped/failed/total)
//
// Délibérément n'utilise PAS d'import depuis `snapshot-export.ts` pour rester
// dans la philo "engine = lib pur" — duplique les constantes en mode `as const`.

export const SNAPSHOT_IMPORT_ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON',
  MALFORMED_BUNDLE: 'MALFORMED_BUNDLE',
  INVALID_MAGIC: 'INVALID_MAGIC',
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
  SIGNATURE_MISSING: 'SIGNATURE_MISSING',
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  UNKNOWN_ENTITY: 'UNKNOWN_ENTITY',
  ENTITY_NOT_ARRAY: 'ENTITY_NOT_ARRAY',
  INVALID_MODE: 'INVALID_MODE',
  ROW_INVALID: 'ROW_INVALID',
} as const);

export type SnapshotImportErrorCode =
  (typeof SNAPSHOT_IMPORT_ERROR_CODES)[keyof typeof SNAPSHOT_IMPORT_ERROR_CODES];

/** Versions schema supportées (Sprint 35 → version 1.0 unique). Frozen. */
export const BUNDLE_VERSION_SUPPORTED: ReadonlyArray<number> = Object.freeze([1]);

export const SNAPSHOT_MAGIC_HEADER_EXPECTED = 'intralys-snapshot-v1' as const;

/** Whitelist des 27 entités importables (calque exact snapshot-export). Frozen. */
export const IMPORTABLE_ENTITIES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'pipelines',
    'pipeline_stages',
    'lost_reasons',
    'custom_field_defs',
    'smart_lists',
    'workflow_folders',
    'workflows',
    'workflow_steps',
    'trigger_links',
    'template_folders',
    'email_templates',
    'sms_templates',
    'snippets',
    'forms',
    'form_field_options',
    'lead_segments',
    'task_templates',
    'booking_event_types',
    'calendars',
    'availability_rules',
    'catalog_items',
    'ai_brand_voices',
    'ivr_menus',
    'quick_replies',
    'saved_replies',
    'report_templates',
    'reputation_settings',
  ]),
);

export const VALID_IMPORT_MODES: ReadonlyArray<'dry_run' | 'commit'> = Object.freeze([
  'dry_run',
  'commit',
]);

// ───────────────────────────────────────────────────────────────────────────
// Manifest validation
// ───────────────────────────────────────────────────────────────────────────

export interface ManifestValidation {
  ok: boolean;
  error?: SnapshotImportErrorCode;
  details?: string;
}

/** Valide la structure d'un manifest bundle (magic + schema_version + signature
 *  + source). NE valide PAS le contenu de `entities` (cf. validateEntityBundle).
 *  Renvoie ok + error code (jamais throw). */
export function validateBundleManifest(manifest: unknown): ManifestValidation {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.MALFORMED_BUNDLE };
  }
  const m = manifest as Record<string, unknown>;

  if (m.magic !== SNAPSHOT_MAGIC_HEADER_EXPECTED) {
    return {
      ok: false,
      error: SNAPSHOT_IMPORT_ERROR_CODES.INVALID_MAGIC,
      details: typeof m.magic === 'string' ? m.magic.slice(0, 64) : 'missing',
    };
  }

  const ver = m.schema_version;
  if (typeof ver !== 'number' || !BUNDLE_VERSION_SUPPORTED.includes(ver)) {
    return {
      ok: false,
      error: SNAPSHOT_IMPORT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      details: String(ver),
    };
  }

  if (!m.signature || typeof m.signature !== 'object') {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.SIGNATURE_MISSING };
  }
  const sig = m.signature as Record<string, unknown>;
  if (typeof sig.hash_hex !== 'string' || sig.hash_hex.length === 0) {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.SIGNATURE_MISSING };
  }
  // SHA-256 hex = 64 chars
  if (sig.hash_hex.length !== 64 || !/^[0-9a-f]+$/i.test(sig.hash_hex)) {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.SIGNATURE_MISSING };
  }

  if (!m.source || typeof m.source !== 'object') {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.MALFORMED_BUNDLE };
  }

  if (!m.entities || typeof m.entities !== 'object' || Array.isArray(m.entities)) {
    return { ok: false, error: SNAPSHOT_IMPORT_ERROR_CODES.MALFORMED_BUNDLE };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Bundle integrity (SHA-256 verify)
// ───────────────────────────────────────────────────────────────────────────

/** SHA-256 hex d'une string UTF-8 via Web Crypto. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    const byte = view[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Vérifie qu'une string sérialisée matche le checksum attendu en comparaison
 *  temps constant. Retourne true si match exact. */
export async function validateBundleIntegrity(
  serializedBundle: string,
  expectedChecksum: string,
): Promise<boolean> {
  if (typeof serializedBundle !== 'string' || typeof expectedChecksum !== 'string') {
    return false;
  }
  if (expectedChecksum.length !== 64) return false;
  const actual = await sha256Hex(serializedBundle);
  if (actual.length !== expectedChecksum.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedChecksum.charCodeAt(i);
  }
  return diff === 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Import mode parsing
// ───────────────────────────────────────────────────────────────────────────

/** Parse le mode d'import depuis une string (body POST). Renvoie null si invalide
 *  — le caller décide quoi faire (400 ou default). */
export function parseImportMode(mode: unknown): 'dry_run' | 'commit' | null {
  if (typeof mode !== 'string') return null;
  if (mode === 'dry_run' || mode === 'commit') return mode;
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-entity validation
// ───────────────────────────────────────────────────────────────────────────

export interface EntityValidationResult {
  ok: boolean;
  valid: number;
  invalid: number;
  errors: Array<{ index: number; reason: SnapshotImportErrorCode | string }>;
}

/** Valide un tableau de rows pour une entité donnée :
 *   - entityName doit être dans la whitelist
 *   - rows doit être un Array
 *   - chaque row doit être un objet non-null (anti-injection scalar/array)
 *   - chaque row.id, si présent, doit être une string non-vide
 *  Renvoie résumé ok/valid/invalid + errors par index. */
export function validateEntityBundle(
  entityName: string,
  rows: unknown,
): EntityValidationResult {
  const errors: Array<{ index: number; reason: SnapshotImportErrorCode | string }> = [];

  if (!IMPORTABLE_ENTITIES.has(entityName)) {
    return {
      ok: false,
      valid: 0,
      invalid: 0,
      errors: [{ index: -1, reason: SNAPSHOT_IMPORT_ERROR_CODES.UNKNOWN_ENTITY }],
    };
  }
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      valid: 0,
      invalid: 0,
      errors: [{ index: -1, reason: SNAPSHOT_IMPORT_ERROR_CODES.ENTITY_NOT_ARRAY }],
    };
  }

  let valid = 0;
  let invalid = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalid += 1;
      errors.push({ index: i, reason: SNAPSHOT_IMPORT_ERROR_CODES.ROW_INVALID });
      continue;
    }
    const r = row as Record<string, unknown>;
    if ('id' in r) {
      if (typeof r.id !== 'string' || r.id.length === 0) {
        invalid += 1;
        errors.push({ index: i, reason: 'id_invalid' });
        continue;
      }
    }
    valid += 1;
  }

  return { ok: invalid === 0, valid, invalid, errors };
}

// ───────────────────────────────────────────────────────────────────────────
// Summary computation
// ───────────────────────────────────────────────────────────────────────────

export interface ImportTotals {
  created: number;
  skipped: number;
  failed: number;
}

export interface ImportSummaryAggregate {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  per_entity: Record<string, ImportTotals>;
}

/** Aggrège les compteurs par entité en totaux globaux. Defensive : accepte des
 *  formes partielles (clé manquante = 0). */
export function computeImportSummary(
  perEntity: Record<string, Partial<ImportTotals>> | null | undefined,
): ImportSummaryAggregate {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const cleaned: Record<string, ImportTotals> = {};

  if (perEntity && typeof perEntity === 'object') {
    for (const [entity, totals] of Object.entries(perEntity)) {
      const c = typeof totals?.created === 'number' && totals.created >= 0 ? totals.created : 0;
      const s = typeof totals?.skipped === 'number' && totals.skipped >= 0 ? totals.skipped : 0;
      const f = typeof totals?.failed === 'number' && totals.failed >= 0 ? totals.failed : 0;
      created += c;
      skipped += s;
      failed += f;
      cleaned[entity] = { created: c, skipped: s, failed: f };
    }
  }

  return {
    created,
    skipped,
    failed,
    total: created + skipped + failed,
    per_entity: cleaned,
  };
}
