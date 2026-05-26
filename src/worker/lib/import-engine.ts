// ── Import engine — Sprint P0-6 (2026-05-26) ─────────────────────────────────
//
// Helpers PURS pour le module Import bulk (ecommerce-import.ts).
// 100 % additif : renforce parsing CSV + validation per-row + dry-run +
// collection d'erreurs sans toucher au handler legacy.
//
// Conventions :
//   - PAS d'I/O : entrées sont déjà des objets / arrays.
//   - PAS de throw : `{ ok, error?, data?, warnings? }`.
//   - Imports relatifs.

// ── Codes / constantes figées ────────────────────────────────────────────────

export const IMPORT_ERROR_CODES = {
  ROW_INVALID: 'row_invalid',
  REQUIRED_FIELD_MISSING: 'required_field_missing',
  FIELD_TYPE_INVALID: 'field_type_invalid',
  FIELD_TOO_LONG: 'field_too_long',
  EMAIL_INVALID: 'email_invalid',
  PRICE_INVALID: 'price_invalid',
  QTY_INVALID: 'qty_invalid',
  IMPORT_TYPE_INVALID: 'import_type_invalid',
  TOO_MANY_ROWS: 'too_many_rows',
  CSV_HEADER_MISSING: 'csv_header_missing',
  CSV_COLUMN_COUNT_MISMATCH: 'csv_column_count_mismatch',
} as const;

export const MAX_IMPORT_ROWS = 10000;
export const MAX_FIELD_LENGTH = 5000;

export const VALID_IMPORT_TYPES = ['product', 'customer', 'order'] as const;
export type ImportType = (typeof VALID_IMPORT_TYPES)[number];

// ── Types ────────────────────────────────────────────────────────────────────

export interface CsvSchemaField {
  name: string;
  required?: boolean;
  /** type sémantique pour la validation (string par défaut). */
  type?: 'string' | 'number' | 'integer' | 'email' | 'boolean';
  maxLength?: number;
}

export interface CsvSchema {
  fields: CsvSchemaField[];
}

export interface ParseRowResult<T = Record<string, unknown>> {
  ok: boolean;
  data?: T;
  error?: string;
  field?: string;
}

export interface ValidateRowResult {
  ok: boolean;
  error?: string;
  field?: string;
  warnings: string[];
}

export interface ImportErrorEntry {
  row: number;
  error: string;
  field?: string;
}

export interface CollectErrorsResult {
  errors: ImportErrorEntry[];
  totalErrors: number;
}

export interface DryRunResult {
  wouldImport: number;
  wouldSkip: number;
  wouldError: number;
  errors: ImportErrorEntry[];
}

// ── Helpers internes ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function coerceFieldValue(raw: unknown, type: CsvSchemaField['type']): unknown {
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s == null) return null;
  switch (type) {
    case 'number': {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    case 'integer': {
      const n = Number(s);
      return Number.isFinite(n) && Number.isInteger(n) ? n : null;
    }
    case 'boolean': {
      if (typeof s === 'boolean') return s;
      const v = String(s).toLowerCase().trim();
      if (v === 'true' || v === '1' || v === 'yes' || v === 'oui') return true;
      if (v === 'false' || v === '0' || v === 'no' || v === 'non') return false;
      return null;
    }
    case 'email':
    case 'string':
    default:
      return String(s);
  }
}

// ── Helpers exportés ─────────────────────────────────────────────────────────

/**
 * Parse une ligne d'objet (déjà extraite d'un CSV → header→value map) selon
 * un schéma. PUR. Retourne `{ ok, data?, error?, field? }`.
 */
export function parseCsvRow(
  row: Record<string, unknown>,
  schema: CsvSchema,
): ParseRowResult {
  if (!row || typeof row !== 'object') {
    return { ok: false, error: IMPORT_ERROR_CODES.ROW_INVALID };
  }
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) {
    return { ok: false, error: IMPORT_ERROR_CODES.CSV_HEADER_MISSING };
  }

  const data: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const raw = row[field.name];
    const rawProvided = raw != null && raw !== '';
    const value = coerceFieldValue(raw, field.type || 'string');

    // Type coerce a échoué : raw fourni mais value=null → typage invalide.
    if (rawProvided && value == null) {
      if (field.type === 'number' || field.type === 'integer' || field.type === 'boolean') {
        return {
          ok: false,
          error: IMPORT_ERROR_CODES.FIELD_TYPE_INVALID,
          field: field.name,
        };
      }
    }

    if (field.required && (value == null || value === '')) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING,
        field: field.name,
      };
    }
    if (
      typeof value === 'string' &&
      field.maxLength &&
      value.length > field.maxLength
    ) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.FIELD_TOO_LONG,
        field: field.name,
      };
    }
    if (field.type === 'email' && typeof value === 'string') {
      if (!EMAIL_REGEX.test(value)) {
        return {
          ok: false,
          error: IMPORT_ERROR_CODES.EMAIL_INVALID,
          field: field.name,
        };
      }
    }
    data[field.name] = value;
  }
  return { ok: true, data };
}

/**
 * Valide une ligne d'import selon le type cible (product/customer/order).
 * PUR. Retourne `{ ok, error?, field?, warnings[] }`.
 */
export function validateImportRow(
  row: Record<string, unknown>,
  type: ImportType,
): ValidateRowResult {
  const warnings: string[] = [];
  if (!row || typeof row !== 'object') {
    return { ok: false, error: IMPORT_ERROR_CODES.ROW_INVALID, warnings };
  }
  if (!(VALID_IMPORT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: IMPORT_ERROR_CODES.IMPORT_TYPE_INVALID, warnings };
  }

  if (type === 'product') {
    const title = (row.title || row.name || '').toString().trim();
    if (!title) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING,
        field: 'title',
        warnings,
      };
    }
    if (title.length > MAX_FIELD_LENGTH) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.FIELD_TOO_LONG,
        field: 'title',
        warnings,
      };
    }
    if (row.price != null && row.price !== '') {
      const n = Number(row.price);
      if (!Number.isFinite(n) || n < 0) {
        return {
          ok: false,
          error: IMPORT_ERROR_CODES.PRICE_INVALID,
          field: 'price',
          warnings,
        };
      }
    } else {
      warnings.push('price_missing');
    }
    if (row.quantity != null && row.quantity !== '') {
      const n = Number(row.quantity);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return {
          ok: false,
          error: IMPORT_ERROR_CODES.QTY_INVALID,
          field: 'quantity',
          warnings,
        };
      }
    }
    if (!row.sku) warnings.push('sku_missing');
  } else if (type === 'customer') {
    const email = (row.email || '').toString().trim();
    if (!email) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING,
        field: 'email',
        warnings,
      };
    }
    if (!EMAIL_REGEX.test(email)) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.EMAIL_INVALID,
        field: 'email',
        warnings,
      };
    }
    if (!row.first_name && !row.last_name && !row.name) {
      warnings.push('name_missing');
    }
  } else if (type === 'order') {
    if (!row.customer_email && !row.customer_id) {
      return {
        ok: false,
        error: IMPORT_ERROR_CODES.REQUIRED_FIELD_MISSING,
        field: 'customer',
        warnings,
      };
    }
    if (row.total != null && row.total !== '') {
      const n = Number(row.total);
      if (!Number.isFinite(n) || n < 0) {
        return {
          ok: false,
          error: IMPORT_ERROR_CODES.PRICE_INVALID,
          field: 'total',
          warnings,
        };
      }
    }
  }

  return { ok: true, warnings };
}

/**
 * Collecte les erreurs en passant les lignes une par une dans un validator
 * fourni par l'appelant (chacune retourne `{ ok, error?, field? }`). PUR.
 */
export function collectImportErrors(
  rows: Array<Record<string, unknown>>,
  validate: (row: Record<string, unknown>, index: number) => {
    ok: boolean;
    error?: string;
    field?: string;
  },
): CollectErrorsResult {
  const errors: ImportErrorEntry[] = [];
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i] || {};
    const res = validate(r, i);
    if (!res.ok) {
      errors.push({
        row: i + 1,
        error: res.error || IMPORT_ERROR_CODES.ROW_INVALID,
        field: res.field,
      });
    }
  }
  return { errors, totalErrors: errors.length };
}

/**
 * Dry-run d'un import : ne mute rien, simule combien de lignes seraient
 * importées / skippées / en erreur. PUR. `skipPredicate` permet d'injecter
 * une logique de "skip si déjà existant" sans toucher la DB ici.
 */
export function dryRunImport(
  rows: Array<Record<string, unknown>>,
  type: ImportType,
  skipPredicate?: (row: Record<string, unknown>, index: number) => boolean,
): DryRunResult {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > MAX_IMPORT_ROWS) {
    return {
      wouldImport: 0,
      wouldSkip: 0,
      wouldError: list.length,
      errors: [
        { row: 0, error: IMPORT_ERROR_CODES.TOO_MANY_ROWS },
      ],
    };
  }

  let wouldImport = 0;
  let wouldSkip = 0;
  const errors: ImportErrorEntry[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const r = list[i] || {};
    const v = validateImportRow(r, type);
    if (!v.ok) {
      errors.push({
        row: i + 1,
        error: v.error || IMPORT_ERROR_CODES.ROW_INVALID,
        field: v.field,
      });
      continue;
    }
    if (skipPredicate && skipPredicate(r, i)) {
      wouldSkip += 1;
      continue;
    }
    wouldImport += 1;
  }

  return {
    wouldImport,
    wouldSkip,
    wouldError: errors.length,
    errors,
  };
}
