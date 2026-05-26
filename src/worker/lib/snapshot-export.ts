// ── Sprint 35 — snapshot-export.ts — Helpers d'export bundle multi-table ────
// PHASE B : implémentation complète (signatures FIGÉES Phase A, inter-agent §6).
//
// Contrat figé (docs/LOT-SNAPSHOTS-S35.md §6) :
//   - SNAPSHOT_SCHEMA_VERSION = 1            (bump strict si breaking change)
//   - SNAPSHOT_BUNDLE_MAX_BYTES = 5 MiB      (borne dure pour éviter dump massif)
//   - SNAPSHOT_MAGIC_HEADER = 'intralys-snapshot-v1'  (identification format)
//   - SNAPSHOTTABLE_ENTITIES = whitelist 27 entités (ZÉRO PII/secrets/tokens)
//   - serialisation JSON DETERMINISTE (clés triées) → SHA-256 reproductible.
//
// Whitelist 27 entités : pipelines, stages, lost_reasons, custom_field_defs,
// smart_lists, workflow_folders/workflows/workflow_steps, trigger_links,
// template_folders, email_templates, sms_templates, snippets, forms,
// form_field_options, lead_segments, task_templates, booking_event_types,
// calendars, availability_rules, catalog_items, ai_brand_voices, ivr_menus,
// quick_replies, saved_replies, report_templates, reputation_settings.
// EXCLU explicitement : leads, messages, conversations, invoices, payments,
// oauth_connections, api_keys, integration_secrets, audit_log, files, users.

import type { Env } from '../types';

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;
export const SNAPSHOT_MAGIC_HEADER = 'intralys-snapshot-v1' as const;

export const SNAPSHOTTABLE_ENTITIES = [
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
] as const;

export type SnapshottableEntity = (typeof SNAPSHOTTABLE_ENTITIES)[number];

export interface SnapshotBundle {
  magic: 'intralys-snapshot-v1';
  schema_version: 1;
  generated_at: string;
  source: {
    client_id: string;
    agency_id: string | null;
    name: string;
    description: string | null;
  };
  entities: Record<SnapshottableEntity, Array<Record<string, unknown>>>;
  signature: { algo: 'sha256'; hash_hex: string };
}

// ── Helpers internes (NON exportés) ─────────────────────────────────────────

/**
 * Sérialisation JSON DETERMINISTE (clés triées récursivement). Garantit que
 * deux payloads logiquement identiques produisent EXACTEMENT la même string,
 * donc le même SHA-256 — peu importe l'ordre d'insertion JS / D1.
 */
function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(deterministicStringify).join(',') + ']';
  const keys = Object.keys(value as object).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + deterministicStringify((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

// ── API publique ────────────────────────────────────────────────────────────

/**
 * Collecte le payload (sans signature) en SELECTionnant les 27 entités
 * whitelistées pour un `clientId` donné.
 *
 * @param options.entities  sous-ensemble optionnel (par défaut : TOUTES).
 */
export async function collectSnapshotPayload(
  env: Env,
  clientId: string,
  options?: { entities?: readonly SnapshottableEntity[] },
): Promise<Omit<SnapshotBundle, 'signature'>> {
  // Lookup agency parent (NULL si client orphelin / absent).
  const agency = await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
    .bind(clientId)
    .first<{ agency_id: string | null }>();

  const requested = options?.entities ?? SNAPSHOTTABLE_ENTITIES;
  const entities = {} as Record<SnapshottableEntity, Array<Record<string, unknown>>>;

  // Initialise toutes les entités à [] pour garder un shape stable.
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    entities[entity] = [];
  }

  for (const entity of requested) {
    // Défense en profondeur — SNAPSHOTTABLE_ENTITIES est figée à la compile,
    // mais on revalide AVANT interpolation SQL pour bloquer tout futur drift.
    if (!SNAPSHOTTABLE_ENTITIES.includes(entity)) {
      continue;
    }
    try {
      const result = await env.DB.prepare(
        `SELECT * FROM ${entity} WHERE client_id = ? LIMIT 10000`,
      )
        .bind(clientId)
        .all<Record<string, unknown>>();
      entities[entity] = result.results ?? [];
    } catch {
      // Table manquante (migration pas encore appliquée sur ce tenant) ou
      // colonne client_id absente → on n'échoue pas tout l'export.
      entities[entity] = [];
    }
  }

  return {
    magic: SNAPSHOT_MAGIC_HEADER,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source: {
      client_id: clientId,
      agency_id: agency?.agency_id ?? null,
      name: '',
      description: null,
    },
    entities,
  };
}

/**
 * SHA-256 hex d'une string UTF-8. Doit être DETERMINISTE :
 * `serializeBundle(bundle)` puis `sha256Hex(serialized)` → même hash pour
 * payloads logiquement identiques, peu importe l'ordre d'insertion JS.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sérialise puis signe un bundle non signé. Renvoie le bundle complet
 * avec `signature.hash_hex` = SHA-256 de la sérialisation deterministe.
 */
export async function signPayload(
  unsignedBundle: Omit<SnapshotBundle, 'signature'>,
): Promise<SnapshotBundle> {
  const serialized = deterministicStringify(unsignedBundle);
  const hash = await sha256Hex(serialized);
  return { ...unsignedBundle, signature: { algo: 'sha256', hash_hex: hash } };
}

/**
 * Sérialisation JSON DETERMINISTE (clés triées récursivement). Garantit la
 * reproductibilité du SHA-256 : même payload → même string → même hash.
 */
export function serializeBundle(bundle: SnapshotBundle): string {
  return deterministicStringify(bundle);
}

/**
 * Vérifie que la taille sérialisée du bundle ne dépasse pas
 * SNAPSHOT_BUNDLE_MAX_BYTES (borne dure 5 MiB).
 */
export function validateBundleSize(
  serialized: string,
): { ok: true } | { ok: false; error: string } {
  if (serialized.length > SNAPSHOT_BUNDLE_MAX_BYTES) {
    return { ok: false, error: 'bundle_too_large' };
  }
  return { ok: true };
}
