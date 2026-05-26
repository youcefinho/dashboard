// ── snapshots-list-engine.ts — Pure helpers list/CRUD snapshots (DISTINCT) ──
// Utils P2-2 RENFORCEMENT — helpers pour `snapshots.ts` (handlers list/get/
// create/publish/archive/delete). VOLONTAIREMENT DISTINCT de `snapshot-engine.ts`
// (qui couvre l'import bundle) et de `snapshot-export.ts` (qui couvre collect/
// sign). Ici on n'a QUE de la validation pure + parsing filtres + checksums.
//
// ZÉRO I/O, ZÉRO state. Aucune dépendance D1/Env.

export const SNAPSHOTS_LIST_ERROR_CODES = Object.freeze({
  NAME_REQUIRED: 'NAME_REQUIRED',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  NAME_INVALID: 'NAME_INVALID',
  DESCRIPTION_TOO_LONG: 'DESCRIPTION_TOO_LONG',
  BUNDLE_TOO_LARGE: 'BUNDLE_TOO_LARGE',
  STATUS_INVALID: 'STATUS_INVALID',
  LIMIT_INVALID: 'LIMIT_INVALID',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  DATE_INVALID: 'DATE_INVALID',
} as const);

export type SnapshotsListErrorCode =
  (typeof SNAPSHOTS_LIST_ERROR_CODES)[keyof typeof SNAPSHOTS_LIST_ERROR_CODES];

/** Cap dur sur le nom snapshot (s'aligne sur sanitizeInput appelé dans handlers). */
export const MAX_SNAPSHOT_NAME_LENGTH = 200 as const;

/** Cap dur sur la description snapshot. */
export const MAX_SNAPSHOT_DESCRIPTION_LENGTH = 2000 as const;

/** Cap dur sur la taille bundle sérialisé (MiB). 50 MiB = sécurité D1 BLOB.
 *  NB : snapshot-export pose 5 MiB par défaut côté export — ce 50 MiB est la
 *  borne haute défensive sur le chemin import (bundle externe). */
export const MAX_BUNDLE_SIZE_MB = 50 as const;
export const MAX_BUNDLE_SIZE_BYTES = MAX_BUNDLE_SIZE_MB * 1024 * 1024;

/** Whitelist statuts (figés Sprint 35). */
export const VALID_SNAPSHOT_STATUSES: ReadonlySet<string> = Object.freeze(
  new Set<string>(['draft', 'published', 'archived']),
);

/** Cap dur sur LIMIT côté list (anti-dump). */
export const MAX_LIST_LIMIT = 100 as const;
export const DEFAULT_LIST_LIMIT = 100 as const;

// ───────────────────────────────────────────────────────────────────────────
// Validation primitives
// ───────────────────────────────────────────────────────────────────────────

/** Nom snapshot : non vide après trim, ≤ MAX_SNAPSHOT_NAME_LENGTH. */
export function validateSnapshotName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_SNAPSHOT_NAME_LENGTH) return false;
  return true;
}

/** Description : optionnelle, ≤ MAX_SNAPSHOT_DESCRIPTION_LENGTH si présente. */
export function validateSnapshotDescription(desc: unknown): boolean {
  if (desc === null || desc === undefined || desc === '') return true;
  if (typeof desc !== 'string') return false;
  return desc.length <= MAX_SNAPSHOT_DESCRIPTION_LENGTH;
}

/** Status doit être dans la whitelist. */
export function validateSnapshotStatus(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  return VALID_SNAPSHOT_STATUSES.has(status);
}

/** Validation taille bundle (en bytes). Renvoie ok + error code structuré. */
export function validateBundleSize(
  bytes: unknown,
): { ok: boolean; error?: SnapshotsListErrorCode; size?: number } {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return { ok: false, error: SNAPSHOTS_LIST_ERROR_CODES.BUNDLE_TOO_LARGE };
  }
  if (bytes > MAX_BUNDLE_SIZE_BYTES) {
    return { ok: false, error: SNAPSHOTS_LIST_ERROR_CODES.BUNDLE_TOO_LARGE, size: bytes };
  }
  return { ok: true, size: bytes };
}

// ───────────────────────────────────────────────────────────────────────────
// Checksum SHA-256 du bundle (utilisé par snapshot-export.signPayload mais
// helper indépendant exposé pour tests + verify côté import).
// ───────────────────────────────────────────────────────────────────────────

/** SHA-256 hex d'un Uint8Array (ou ArrayBuffer). Web Crypto API (Workers native). */
export async function computeBundleChecksum(
  content: Uint8Array | ArrayBuffer | string,
): Promise<string> {
  let bytes: ArrayBuffer;
  if (typeof content === 'string') {
    bytes = new TextEncoder().encode(content).buffer as ArrayBuffer;
  } else if (content instanceof Uint8Array) {
    // Slice to a fresh ArrayBuffer to satisfy TS DOM lib (avoids SharedArrayBuffer ambiguity).
    bytes = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
  } else {
    bytes = content;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    const byte = view[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Compare 2 hashes en temps constant (anti-timing attack). */
export function checksumsEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Parse filtres GET /api/snapshots
// ───────────────────────────────────────────────────────────────────────────

export interface SnapshotFilters {
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit: number;
}

/** ISO 8601 datetime simple check (YYYY-MM-DD ou full ISO). */
function isIsoDateLike(s: string): boolean {
  if (s.length < 10) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

/** Parse les filtres list avec validation. Valeurs invalides → ignorées silencieusement
 *  (sauf limit, qui se ramène toujours au DEFAULT_LIST_LIMIT). */
export function parseSnapshotFilters(query: URLSearchParams): SnapshotFilters {
  const out: SnapshotFilters = { limit: DEFAULT_LIST_LIMIT };

  const status = query.get('status');
  if (status && validateSnapshotStatus(status)) {
    out.status = status;
  }

  const after = query.get('created_after') || query.get('createdAfter');
  if (after && isIsoDateLike(after)) {
    out.createdAfter = after;
  }
  const before = query.get('created_before') || query.get('createdBefore');
  if (before && isIsoDateLike(before)) {
    out.createdBefore = before;
  }

  const limitRaw = query.get('limit');
  if (limitRaw) {
    const n = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      out.limit = Math.min(n, MAX_LIST_LIMIT);
    }
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Filename safe (pour Content-Disposition download)
// ───────────────────────────────────────────────────────────────────────────

/** Sanitize un nom pour usage filesystem / Content-Disposition.
 *  Normalize NFKD + remplace tout non-[\w.-] par '-' + collapse + trim + cap 80. */
export function sanitizeFilenamePart(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || 'snapshot';
}

// ───────────────────────────────────────────────────────────────────────────
// Compute summary depuis bundle.entities (helper réutilisé par list + export)
// ───────────────────────────────────────────────────────────────────────────

/** Compte les rows par entité depuis un dict { entity: rows[] }. Defensive : skip
 *  non-array, ne throw jamais. */
export function computeTablesSummary(
  entities: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!entities || typeof entities !== 'object') return out;
  for (const [key, rows] of Object.entries(entities)) {
    out[key] = Array.isArray(rows) ? rows.length : 0;
  }
  return out;
}

/** Parse en best-effort un tables_summary_json (string D1) → object ou null. */
export function parseTablesSummaryJson(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Valide que toutes les valeurs sont des nombres ≥ 0 (defensive).
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return null;
  }
}
