// ── Sprint 35 — snapshot-import.ts — Helpers d'import bundle multi-table ────
// Implémentation Agent A2 (fichier EXCLUSIF).
//
// Contrat figé (docs/LOT-SNAPSHOTS-S35.md §6) :
//   - parseBundle               : JSON.parse + check magic+schema_version
//   - validateBundleSchema      : structure + types + clés conformes
//   - verifySignature           : re-sérialise sans signature + sha256Hex
//                                 vs `signature.hash_hex` → match exact
//   - remapEntityIds            : remplace tous les IDs (PK + FK applicatives)
//                                 par de nouveaux IDs côté target. Idempotent
//                                 par (client_id, name) sur les entités
//                                 nommables (workflows, templates, forms...).
//   - applyImport(mode=dry_run) : NE TOUCHE PAS la base — produit seulement
//                                 le log + summary (preview UI 3 colonnes).
//   - applyImport(mode=commit)  : INSERT (jamais UPDATE) avec les nouveaux IDs.
//                                 Skip silencieux si nom déjà pris côté target
//                                 (idempotence par (client_id, name)).

import type { Env } from '../types';
import type { SnapshotBundle, SnapshottableEntity } from './snapshot-export';
import { SNAPSHOTTABLE_ENTITIES, SNAPSHOT_MAGIC_HEADER } from './snapshot-export';

export interface ImportLogEntry {
  entity: SnapshottableEntity;
  action: 'created' | 'skipped' | 'failed';
  old_id: string | null;
  new_id: string | null;
  reason?: string;
}

export interface ImportSummary {
  total_entities: number;
  totals: Record<
    SnapshottableEntity,
    { created: number; skipped: number; failed: number }
  >;
  id_mapping: Record<SnapshottableEntity, Record<string, string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers locaux (re-implémentés ici pour éviter dépendance circulaire avec
// snapshot-export.ts dont les helpers homonymes sont posés par A1 en parallèle).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sérialisation JSON deterministe (clés triées récursivement). Garantit que
 * deux bundles logiquement identiques produisent la même string → même hash.
 */
function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => deterministicStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ':' + deterministicStringify(obj[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * SHA-256 hex d'une string UTF-8 via Web Crypto API (Workers native).
 */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Whitelist O(1) des 27 entités snapshottables (anti-injection table arbitraire).
 */
const ENTITY_SET: Set<string> = new Set(SNAPSHOTTABLE_ENTITIES);

/**
 * Clé naturelle de déduplication par entité (idempotence import).
 * - Entités nommables (client_id, name|key|slug) → skip si déjà présent côté target
 * - Entités ordonnées enfants (parent_id, order/sort) → skip si même (parent, position)
 * - Singleton-par-tenant (reputation_settings) → skip si déjà présent pour client_id
 */
type DedupKind =
  | { kind: 'by_client_name'; field: 'name' }
  | { kind: 'by_client_field'; field: 'key' | 'slug' | 'label' }
  | { kind: 'by_parent_order'; parent: string; order: string }
  | { kind: 'by_client_singleton' }
  | { kind: 'none' };

function dedupKey(entity: SnapshottableEntity): DedupKind {
  switch (entity) {
    case 'pipelines':
    case 'smart_lists':
    case 'workflow_folders':
    case 'workflows':
    case 'template_folders':
    case 'email_templates':
    case 'sms_templates':
    case 'snippets':
    case 'forms':
    case 'lead_segments':
    case 'task_templates':
    case 'booking_event_types':
    case 'calendars':
    case 'catalog_items':
    case 'ai_brand_voices':
    case 'ivr_menus':
    case 'report_templates':
      return { kind: 'by_client_name', field: 'name' };
    case 'custom_field_defs':
      return { kind: 'by_client_field', field: 'key' };
    case 'lost_reasons':
      return { kind: 'by_client_field', field: 'label' };
    case 'trigger_links':
    case 'quick_replies':
    case 'saved_replies':
      return { kind: 'by_client_name', field: 'name' };
    case 'pipeline_stages':
      return { kind: 'by_parent_order', parent: 'pipeline_id', order: 'sort_order' };
    case 'workflow_steps':
      return { kind: 'by_parent_order', parent: 'workflow_id', order: 'step_order' };
    case 'form_field_options':
      return { kind: 'by_parent_order', parent: 'form_id', order: 'sort_order' };
    case 'availability_rules':
      return { kind: 'by_parent_order', parent: 'calendar_id', order: 'day_of_week' };
    case 'reputation_settings':
      return { kind: 'by_client_singleton' };
  }
  return { kind: 'none' };
}

/**
 * Champs FK applicatives connues entre les 27 entités (pour remap cross-entity).
 * Pour chaque entité enfant, on liste les champs qui pointent vers une autre
 * entité. Le remap se fait sur les valeurs trouvées dans le mapping de l'entité
 * cible (peu importe la table source qui possède l'old_id).
 */
const KNOWN_FK_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'pipeline_id',
  'workflow_id',
  'form_id',
  'calendar_id',
  'folder_id',
  'template_folder_id',
  'workflow_folder_id',
  'parent_id',
  'event_type_id',
  'booking_event_type_id',
  'segment_id',
  'lead_segment_id',
  'voice_id',
  'brand_voice_id',
  'menu_id',
  'ivr_menu_id',
  'pipeline_stage_id',
  'stage_id',
  'lost_reason_id',
  'custom_field_id',
  'custom_field_def_id',
  'snippet_id',
  'template_id',
  'email_template_id',
  'sms_template_id',
  'catalog_item_id',
  'task_template_id',
  'report_template_id',
  'trigger_link_id',
  'smart_list_id',
  'quick_reply_id',
  'saved_reply_id',
  'reputation_settings_id',
]);

/**
 * Build d'un mapping inverse global { old_id → new_id } en réunissant tous les
 * mappings d'entités. Permet de résoudre n'importe quelle FK applicative
 * pointant vers n'importe laquelle des 27 entités, sans hardcoder le mapping
 * field → table source.
 */
function buildGlobalIdMap(
  mapping: Record<SnapshottableEntity, Record<string, string>>,
): Map<string, string> {
  const global = new Map<string, string>();
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    const m = mapping[entity];
    if (!m) continue;
    for (const oldId of Object.keys(m)) {
      const newId = m[oldId];
      if (newId) global.set(oldId, newId);
    }
  }
  return global;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports publics — signatures FIGÉES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse un bundle sérialisé. JSON.parse + retour structuré (pas de throw).
 * La validation magic / schema_version est faite par validateBundleSchema.
 */
export function parseBundle(
  raw: string,
): { ok: true; bundle: SnapshotBundle } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'invalid_json' };
  }
  return { ok: true, bundle: parsed as SnapshotBundle };
}

/**
 * Validation structurelle stricte : champs obligatoires + types + whitelist
 * entités. Rejette tout bundle dont une clé `entities.*` n'appartient pas
 * à SNAPSHOTTABLE_ENTITIES (anti-injection table arbitraire).
 */
export function validateBundleSchema(
  bundle: SnapshotBundle,
): { ok: true } | { ok: false; error: string } {
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, error: 'malformed_bundle' };
  }
  if (bundle.magic !== SNAPSHOT_MAGIC_HEADER) {
    return { ok: false, error: 'invalid_magic' };
  }
  if (
    typeof bundle.schema_version !== 'number' ||
    bundle.schema_version > 1 ||
    bundle.schema_version < 1
  ) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (!bundle.entities || typeof bundle.entities !== 'object') {
    return { ok: false, error: 'malformed_bundle' };
  }
  if (!bundle.signature || typeof bundle.signature !== 'object') {
    return { ok: false, error: 'malformed_bundle' };
  }
  if (
    typeof bundle.signature.hash_hex !== 'string' ||
    bundle.signature.hash_hex.length === 0
  ) {
    return { ok: false, error: 'malformed_bundle' };
  }
  if (!bundle.source || typeof bundle.source !== 'object') {
    return { ok: false, error: 'malformed_bundle' };
  }
  // Whitelist entités : toute clé non listée → rejet.
  for (const key of Object.keys(bundle.entities)) {
    if (!ENTITY_SET.has(key)) {
      return { ok: false, error: 'malformed_bundle' };
    }
    const rows = (bundle.entities as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) {
      return { ok: false, error: 'malformed_bundle' };
    }
  }
  return { ok: true };
}

/**
 * Re-sérialise le bundle SANS la `signature` (clés triées deterministes),
 * SHA-256 du résultat, comparaison stricte avec `bundle.signature.hash_hex`.
 * Renvoie `{ ok:false, expected, actual }` si mismatch (anti-altération).
 */
export async function verifySignature(
  bundle: SnapshotBundle,
): Promise<{ ok: true } | { ok: false; expected: string; actual: string }> {
  const expected = bundle.signature?.hash_hex ?? '';
  // Crée une copie SANS signature pour calculer le hash de référence.
  const unsignedCopy: Record<string, unknown> = {};
  for (const key of Object.keys(bundle)) {
    if (key === 'signature') continue;
    unsignedCopy[key] = (bundle as unknown as Record<string, unknown>)[key];
  }
  const serialized = deterministicStringify(unsignedCopy);
  const actual = await sha256Hex(serialized);
  if (actual === expected) {
    return { ok: true };
  }
  return { ok: false, expected, actual };
}

/**
 * Remappe TOUS les IDs (PK + FK applicatives entre les 27 entités) par de
 * nouveaux IDs target. Pur (ne touche pas la base). Renvoie le bundle
 * transformé + le mapping (utile pour log + UI preview).
 *
 * Algo :
 *   1) Premier pass : pour chaque (entity, row) → mapping[entity][row.id] = new_id
 *   2) Deuxième pass : copie le bundle, et pour chaque row :
 *        - row.id = new_id de l'entité courante
 *        - tout champ `*_id` (ou champ FK connu) dont la valeur est dans le
 *          global map → réécrit avec la new_id correspondante
 */
export function remapEntityIds(
  bundle: SnapshotBundle,
): {
  remapped: SnapshotBundle;
  mapping: Record<SnapshottableEntity, Record<string, string>>;
} {
  const mapping = {} as Record<SnapshottableEntity, Record<string, string>>;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    mapping[entity] = {};
  }

  // Premier pass : générer les nouveaux IDs pour chaque PK.
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    const rows = bundle.entities[entity];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const oldId = (row as Record<string, unknown>).id;
      if (typeof oldId === 'string' && oldId.length > 0) {
        mapping[entity][oldId] = crypto.randomUUID();
      }
    }
  }

  const globalMap = buildGlobalIdMap(mapping);

  // Deuxième pass : copie deep et remap.
  const remappedEntities = {} as Record<
    SnapshottableEntity,
    Array<Record<string, unknown>>
  >;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    const rows = bundle.entities[entity];
    if (!Array.isArray(rows)) {
      remappedEntities[entity] = [];
      continue;
    }
    remappedEntities[entity] = rows.map((row) => {
      const src = row as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src)) {
        const val = src[key];
        if (key === 'id' && typeof val === 'string' && mapping[entity][val]) {
          out[key] = mapping[entity][val];
          continue;
        }
        // FK applicative : tout champ se terminant par _id OU connu, avec une
        // valeur string qui matche un old_id global → remap.
        if (
          typeof val === 'string' &&
          (key.endsWith('_id') || KNOWN_FK_FIELDS.has(key)) &&
          globalMap.has(val)
        ) {
          out[key] = globalMap.get(val)!;
          continue;
        }
        out[key] = val;
      }
      return out;
    });
  }

  const remapped: SnapshotBundle = {
    magic: bundle.magic,
    schema_version: bundle.schema_version,
    generated_at: bundle.generated_at,
    source: bundle.source,
    entities: remappedEntities,
    signature: bundle.signature,
  };

  return { remapped, mapping };
}

/**
 * Construit l'INSERT SQL à partir des clés présentes dans la row (les colonnes
 * exportées = colonnes à insérer côté target). `client_id` et `agency_id` sont
 * FORCÉS depuis options (bornage tenant — §6.6).
 */
function buildInsertSql(
  entity: SnapshottableEntity,
  row: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(row)) {
    cols.push(key);
    const v = row[key];
    // D1 accepte string/number/null/boolean. Objets/arrays sérialisés JSON.
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      values.push(v as unknown);
    } else {
      values.push(JSON.stringify(v));
    }
  }
  const placeholders = cols.map(() => '?').join(', ');
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const sql = `INSERT INTO ${entity} (${colList}) VALUES (${placeholders})`;
  return { sql, values };
}

/**
 * Lookup d'idempotence : renvoie l'ID existant côté target si la row "duplique"
 * une row déjà présente (selon la dedupKey de l'entité). null sinon.
 */
async function findExistingId(
  env: Env,
  entity: SnapshottableEntity,
  row: Record<string, unknown>,
  targetClientId: string,
): Promise<string | null> {
  const dk = dedupKey(entity);
  try {
    if (dk.kind === 'by_client_name') {
      const name = row[dk.field];
      if (typeof name !== 'string' || name.length === 0) return null;
      const res = await env.DB.prepare(
        `SELECT id FROM ${entity} WHERE client_id = ? AND ${dk.field} = ? LIMIT 1`,
      )
        .bind(targetClientId, name)
        .first<{ id: string }>();
      return res?.id ?? null;
    }
    if (dk.kind === 'by_client_field') {
      const val = row[dk.field];
      if (typeof val !== 'string' || val.length === 0) return null;
      const res = await env.DB.prepare(
        `SELECT id FROM ${entity} WHERE client_id = ? AND ${dk.field} = ? LIMIT 1`,
      )
        .bind(targetClientId, val)
        .first<{ id: string }>();
      return res?.id ?? null;
    }
    if (dk.kind === 'by_parent_order') {
      const parent = row[dk.parent];
      const order = row[dk.order];
      if (typeof parent !== 'string' || parent.length === 0) return null;
      if (typeof order !== 'number') return null;
      const res = await env.DB.prepare(
        `SELECT id FROM ${entity} WHERE ${dk.parent} = ? AND ${dk.order} = ? LIMIT 1`,
      )
        .bind(parent, order)
        .first<{ id: string }>();
      return res?.id ?? null;
    }
    if (dk.kind === 'by_client_singleton') {
      const res = await env.DB.prepare(
        `SELECT id FROM ${entity} WHERE client_id = ? LIMIT 1`,
      )
        .bind(targetClientId)
        .first<{ id: string }>();
      return res?.id ?? null;
    }
  } catch {
    // Si la table n'a pas la colonne attendue ou n'existe pas, on traite
    // comme "pas de duplicate connu" et on laisse l'INSERT/skip suivre.
    return null;
  }
  return null;
}

/**
 * Applique l'import. En mode `dry_run` : aucune écriture, seulement le log +
 * summary (UI 3 colonnes created/skipped/failed). En mode `commit` :
 * INSERT (jamais UPDATE) avec nouveaux IDs target, idempotence par
 * (client_id, name) — un workflow déjà présent avec ce nom → skipped.
 */
export async function applyImport(
  env: Env,
  bundle: SnapshotBundle,
  options: {
    targetClientId: string;
    targetAgencyId: string | null;
    mode: 'dry_run' | 'commit';
    startedBy: string;
    importId: string;
  },
): Promise<{ summary: ImportSummary; log: ImportLogEntry[] }> {
  const { remapped, mapping } = remapEntityIds(bundle);

  const log: ImportLogEntry[] = [];
  const totals = {} as Record<
    SnapshottableEntity,
    { created: number; skipped: number; failed: number }
  >;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    totals[entity] = { created: 0, skipped: 0, failed: 0 };
  }

  // Itération parents → enfants selon l'ordre de la whitelist.
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    const rows = remapped.entities[entity];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    for (const row of rows) {
      const src = row as Record<string, unknown>;
      // Old_id (avant remap) : on retrouve via le mapping inverse pour log.
      const newId = typeof src.id === 'string' ? src.id : null;
      let oldId: string | null = null;
      for (const [k, v] of Object.entries(mapping[entity])) {
        if (v === newId) {
          oldId = k;
          break;
        }
      }

      // Bornage tenant : forcer client_id / agency_id depuis options (§6.6).
      const targetRow: Record<string, unknown> = { ...src };
      if ('client_id' in targetRow) {
        targetRow.client_id = options.targetClientId;
      }
      if ('agency_id' in targetRow) {
        targetRow.agency_id = options.targetAgencyId;
      }

      try {
        // Idempotence : check existant côté target AVANT toute écriture.
        const existingId = await findExistingId(
          env,
          entity,
          targetRow,
          options.targetClientId,
        );
        if (existingId) {
          // Re-mappe l'old_id vers l'ID existant côté target (préserve FK
          // applicatives internes au bundle pour les enfants à venir).
          if (oldId) {
            mapping[entity][oldId] = existingId;
          }
          totals[entity].skipped += 1;
          log.push({
            entity,
            action: 'skipped',
            old_id: oldId,
            new_id: existingId,
            reason: 'duplicate_by_name',
          });
          continue;
        }

        if (options.mode === 'commit') {
          const { sql, values } = buildInsertSql(entity, targetRow);
          await env.DB.prepare(sql)
            .bind(...values)
            .run();
        }
        totals[entity].created += 1;
        log.push({
          entity,
          action: 'created',
          old_id: oldId,
          new_id: newId,
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? 'unknown_error');
        totals[entity].failed += 1;
        log.push({
          entity,
          action: 'failed',
          old_id: oldId,
          new_id: newId,
          reason: msg,
        });
      }
    }
  }

  // Si on a re-mappé certains old_id vers des ID existants après le premier
  // pass (skip duplicate), les enfants déjà traités ont peut-être inséré une
  // FK pointant vers le new_id "neuf" plutôt que vers l'existing_id. Ce risque
  // est minimisé par l'ordre parents → enfants de SNAPSHOTTABLE_ENTITIES :
  // les parents sont résolus AVANT les enfants, donc le mapping est à jour
  // au moment où on construit les FK enfants.

  const summary: ImportSummary = {
    total_entities: SNAPSHOTTABLE_ENTITIES.length,
    totals,
    id_mapping: mapping,
  };

  return { summary, log };
}

/**
 * Persiste le log JSON de l'import (append idempotent — full overwrite des
 * colonnes JSON, l'ID est PK donc UPDATE est atomique). Met aussi à jour
 * summary_json pour cohérence (le caller appelle typiquement appendImportLog
 * une fois à la fin avec le log complet).
 */
export async function appendImportLog(
  env: Env,
  importId: string,
  entries: ImportLogEntry[],
): Promise<void> {
  // Récupère le log existant pour append (idempotent : si vide, on écrit
  // directement entries ; sinon on concat).
  const existing = await env.DB.prepare(
    `SELECT log_json FROM snapshot_imports WHERE id = ? LIMIT 1`,
  )
    .bind(importId)
    .first<{ log_json: string | null }>();

  let merged: ImportLogEntry[] = entries;
  if (existing?.log_json) {
    try {
      const prev = JSON.parse(existing.log_json) as ImportLogEntry[];
      if (Array.isArray(prev)) {
        merged = prev.concat(entries);
      }
    } catch {
      // log_json corrompu : on l'écrase avec les nouvelles entrées plutôt
      // que de perdre l'info de cet appel.
      merged = entries;
    }
  }

  // Recalcule un summary minimal à partir du log mergé (compteurs par entité).
  const totals = {} as Record<
    SnapshottableEntity,
    { created: number; skipped: number; failed: number }
  >;
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    totals[entity] = { created: 0, skipped: 0, failed: 0 };
  }
  for (const entry of merged) {
    if (totals[entry.entity]) {
      totals[entry.entity][entry.action] += 1;
    }
  }
  const summary: Pick<ImportSummary, 'total_entities' | 'totals'> = {
    total_entities: SNAPSHOTTABLE_ENTITIES.length,
    totals,
  };

  await env.DB.prepare(
    `UPDATE snapshot_imports
        SET log_json = ?, summary_json = ?
      WHERE id = ?`,
  )
    .bind(JSON.stringify(merged), JSON.stringify(summary), importId)
    .run();
}
