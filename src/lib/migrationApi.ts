// ── Client API — Migration GHL CSV (LOT RÉEL — Manager C) ────
// Module séparé : `src/lib/api.ts` est exclusif Manager B (LOT-REEL §6.E).
// On consomme `apiFetch` (pattern identique) sans modifier api.ts.
//
// Endpoints backend FIGÉS (worker/migration-ghl-csv.ts — NE PAS toucher) :
//   POST /api/migration/ghl/csv/preview
//   POST /api/migration/ghl/csv/run
// Réponses backend wrappées `{ data: {...} }`. Admin-only (403 sinon).

import { apiFetch } from './api';
import type { ApiResponse } from './types';

// ── Types réponse (verbatim §6.C) ───────────────────────────

export interface GhlCsvPreviewResult {
  rows_total: number;
  rows_valid: number;
  rows_skipped: number;
  sample_first_10: Record<string, string>[];
  custom_fields_detected: string[];
  conflicts: {
    duplicate_emails_in_csv: string[];
    existing_contacts: string[];
  };
  mapping_used: Record<string, string>;
}

export interface GhlCsvRunResult {
  session_id: string;
  imported: number;
  skipped: number;
  errors: number;
  log: string[];
}

// ── POST /api/migration/ghl/csv/preview ─────────────────────
// `apiFetch` déballe déjà l'enveloppe { data } du backend → ApiResponse<T>.data
// contient directement le payload typé ci-dessus.
export async function ghlCsvPreview(
  clientId: string,
  csvData: string,
  fieldMapping?: Record<string, string>,
): Promise<ApiResponse<GhlCsvPreviewResult>> {
  return apiFetch<GhlCsvPreviewResult>('/migration/ghl/csv/preview', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      csv_data: csvData,
      ...(fieldMapping ? { field_mapping: fieldMapping } : {}),
    }),
  });
}

// ── POST /api/migration/ghl/csv/run ─────────────────────────
export async function ghlCsvRun(
  clientId: string,
  csvData: string,
  fieldMapping: Record<string, string>,
): Promise<ApiResponse<GhlCsvRunResult>> {
  return apiFetch<GhlCsvRunResult>('/migration/ghl/csv/run', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      csv_data: csvData,
      field_mapping: fieldMapping,
    }),
  });
}
