// ── lib/custom-fields-engine.ts — Core CRM P0-3 (renforcement custom-fields) ─
//
// Helpers PURS (zéro I/O, zéro D1) extraits/dérivés de custom-fields.ts pour
// rendre la validation des schémas, des valeurs typées et du cap multi-tenant
// testable indépendamment du runtime Worker. Tout est additif.
//
// CONTENU :
//   - CUSTOM_FIELD_ERROR_CODES        codes erreur stables
//   - CUSTOM_FIELD_VALID_TYPES        enum frozen (string/number/date/select/
//                                      multiselect/url/email/boolean/phone/text)
//   - MAX_FIELDS_PER_TENANT           50
//   - MAX_FIELD_NAME_LEN              100
//   - MAX_SELECT_OPTIONS              50
//   - MAX_VALUE_LEN                   1 000 (string/url/email)
//   - MAX_MULTISELECT_VALUES          20
//   - isValidFieldType                guard rapide
//   - slugifyFieldName                normalisation slug DB
//   - validateFieldSchema             validation d'un schema (CREATE/UPDATE)
//   - validateFieldValue(value,schema) validation valeur typée selon schema
//   - canAddFieldForTenant            check cap MAX_FIELDS_PER_TENANT
//
// AUCUNE dépendance Worker → 100 % unit-testable.

// ════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════

export const CUSTOM_FIELD_ERROR_CODES = {
  FIELD_NOT_FOUND: 'field_not_found',
  INVALID_TYPE: 'invalid_field_type',
  INVALID_NAME: 'invalid_field_name',
  INVALID_SLUG: 'invalid_slug',
  MISSING_OPTIONS: 'missing_options',
  INVALID_OPTIONS: 'invalid_options',
  TOO_MANY_OPTIONS: 'too_many_options',
  INVALID_VALUE: 'invalid_field_value',
  VALUE_TOO_LONG: 'value_too_long',
  REQUIRED_FIELD: 'required_field_missing',
  TENANT_CAP_REACHED: 'tenant_cap_reached',
  TOO_MANY_MULTISELECT_VALUES: 'too_many_multiselect_values',
  DUPLICATE_SLUG: 'duplicate_slug',
} as const;

export type CustomFieldErrorCode =
  (typeof CUSTOM_FIELD_ERROR_CODES)[keyof typeof CUSTOM_FIELD_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  ENUMS FROZEN
// ════════════════════════════════════════════════════════════

/**
 * Types acceptés (calque custom-fields.ts handleCreateCustomField l.39).
 * 'text' = alias 'string' (legacy DB). Multi-select retournés sous forme
 * de JSON.stringify(array) en valeur stockée.
 */
export const CUSTOM_FIELD_VALID_TYPES = Object.freeze([
  'text',
  'string',
  'number',
  'date',
  'select',
  'multiselect',
  'multi-select',
  'boolean',
  'url',
  'phone',
  'email',
] as const);
export type CustomFieldType = (typeof CUSTOM_FIELD_VALID_TYPES)[number];

// ════════════════════════════════════════════════════════════
//  CAPS / LIMITES
// ════════════════════════════════════════════════════════════

export const MAX_FIELDS_PER_TENANT = 50 as const;
export const MAX_FIELD_NAME_LEN = 100 as const;
export const MAX_SELECT_OPTIONS = 50 as const;
export const MAX_VALUE_LEN = 1000 as const;
export const MAX_MULTISELECT_VALUES = 20 as const;

// ════════════════════════════════════════════════════════════
//  GUARDS RAPIDES
// ════════════════════════════════════════════════════════════

export function isValidFieldType(t: unknown): t is CustomFieldType {
  return (
    typeof t === 'string' &&
    (CUSTOM_FIELD_VALID_TYPES as readonly string[]).includes(t)
  );
}

/**
 * Normalise un nom en slug DB : alphanum + underscores, lowercase,
 * trim leading/trailing underscores. Refuse les inputs qui produiraient
 * un slug vide (e.g. "!!!").
 */
export function slugifyFieldName(name: unknown): {
  ok: boolean;
  slug?: string;
  error?: CustomFieldErrorCode;
} {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: CUSTOM_FIELD_ERROR_CODES.INVALID_NAME };
  }
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) {
    return { ok: false, error: CUSTOM_FIELD_ERROR_CODES.INVALID_SLUG };
  }
  return { ok: true, slug };
}

// ════════════════════════════════════════════════════════════
//  VALIDATE FIELD SCHEMA
// ════════════════════════════════════════════════════════════

export interface FieldSchemaInput {
  name?: unknown;
  field_type?: unknown;
  options?: unknown;
  is_required?: unknown;
}

export interface ValidateSchemaResult {
  ok: boolean;
  error?: CustomFieldErrorCode;
  message?: string;
  schema?: NormalizedFieldSchema;
}

export interface NormalizedFieldSchema {
  name: string;
  slug: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
}

/**
 * Valide + normalise un schema custom field pré-INSERT/UPDATE :
 *   - name obligatoire, ≤ MAX_FIELD_NAME_LEN, slug non-vide
 *   - field_type obligatoire, whitelisted
 *   - options requises ssi type ∈ {select, multiselect, multi-select}
 *     ⇒ array de strings non-vides, ≤ MAX_SELECT_OPTIONS, déduplée
 *   - options DOIVENT être absent/[] pour types non-enum (refusé sinon)
 *   - is_required normalisé en boolean
 */
export function validateFieldSchema(
  input: FieldSchemaInput,
): ValidateSchemaResult {
  // Name
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.INVALID_NAME,
      message: 'name required',
    };
  }
  if (input.name.length > MAX_FIELD_NAME_LEN) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.INVALID_NAME,
      message: `name exceeds ${MAX_FIELD_NAME_LEN} chars`,
    };
  }
  const slugRes = slugifyFieldName(input.name);
  if (!slugRes.ok) {
    return { ok: false, error: slugRes.error, message: 'name produces invalid slug' };
  }

  // Type
  if (!isValidFieldType(input.field_type)) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.INVALID_TYPE,
      message: `field_type must be one of: ${CUSTOM_FIELD_VALID_TYPES.join(', ')}`,
    };
  }
  const field_type = input.field_type as CustomFieldType;
  const isEnum =
    field_type === 'select' ||
    field_type === 'multiselect' ||
    field_type === 'multi-select';

  // Options
  let options: string[] = [];
  if (input.options !== undefined && input.options !== null) {
    if (!Array.isArray(input.options)) {
      return {
        ok: false,
        error: CUSTOM_FIELD_ERROR_CODES.INVALID_OPTIONS,
        message: 'options must be an array',
      };
    }
    for (const o of input.options) {
      if (typeof o !== 'string' || !o.trim()) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_OPTIONS,
          message: 'each option must be a non-empty string',
        };
      }
    }
    const trimmed = (input.options as string[]).map((o) => o.trim());
    // Dédupe (case-sensitive, on garde la première occurrence)
    const seen = new Set<string>();
    options = trimmed.filter((o) => {
      if (seen.has(o)) return false;
      seen.add(o);
      return true;
    });
    if (options.length > MAX_SELECT_OPTIONS) {
      return {
        ok: false,
        error: CUSTOM_FIELD_ERROR_CODES.TOO_MANY_OPTIONS,
        message: `options exceed ${MAX_SELECT_OPTIONS}`,
      };
    }
  }

  if (isEnum && options.length === 0) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.MISSING_OPTIONS,
      message: 'select/multiselect requires non-empty options',
    };
  }
  if (!isEnum && options.length > 0) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.INVALID_OPTIONS,
      message: `options not allowed for type ${field_type}`,
    };
  }

  return {
    ok: true,
    schema: {
      name: input.name.trim(),
      slug: slugRes.slug!,
      field_type,
      options,
      is_required: input.is_required === true || input.is_required === 1,
    },
  };
}

// ════════════════════════════════════════════════════════════
//  VALIDATE FIELD VALUE (typed selon schema)
// ════════════════════════════════════════════════════════════

const URL_REGEX = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const PHONE_REGEX = /^[+]?[0-9()\-\s.]{7,30}$/;

export interface ValidateValueResult {
  ok: boolean;
  error?: CustomFieldErrorCode;
  message?: string;
  normalized?: string;
}

/**
 * Valide une valeur scalaire selon le schema d'un champ. Retourne la valeur
 * normalisée (string DB-ready) en cas de succès.
 *
 * Cas par type :
 *   - text/string : string ≤ MAX_VALUE_LEN
 *   - number      : Number.isFinite, retourne String(n)
 *   - date        : ISO date YYYY-MM-DD ou ISO full datetime
 *   - select      : doit faire partie de schema.options
 *   - multiselect : array de strings, tous ∈ options, ≤ MAX_MULTISELECT_VALUES
 *                   retourne JSON.stringify(array)
 *   - boolean     : true/false/'true'/'false'/1/0
 *   - url         : http(s) regex + ≤ MAX_VALUE_LEN
 *   - email       : RFC simplifié + ≤ MAX_VALUE_LEN
 *   - phone       : E.164-ish (digits + - ( ) . espaces), 7–30 chars
 *
 * Valeur null/undefined/'' :
 *   - rejet si is_required = true (REQUIRED_FIELD)
 *   - acceptée sinon (normalized = '')
 */
export function validateFieldValue(
  value: unknown,
  schema: NormalizedFieldSchema,
): ValidateValueResult {
  const isEmpty =
    value === null || value === undefined || value === '';
  if (isEmpty) {
    if (schema.is_required) {
      return {
        ok: false,
        error: CUSTOM_FIELD_ERROR_CODES.REQUIRED_FIELD,
        message: `field ${schema.slug} is required`,
      };
    }
    return { ok: true, normalized: '' };
  }

  switch (schema.field_type) {
    case 'text':
    case 'string': {
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected string',
        };
      }
      if (value.length > MAX_VALUE_LEN) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.VALUE_TOO_LONG,
          message: `value exceeds ${MAX_VALUE_LEN} chars`,
        };
      }
      return { ok: true, normalized: value };
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || Number.isNaN(n)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected finite number',
        };
      }
      return { ok: true, normalized: String(n) };
    }
    case 'date': {
      if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected ISO date',
        };
      }
      const ts = Date.parse(value);
      if (Number.isNaN(ts)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'invalid date',
        };
      }
      return { ok: true, normalized: value };
    }
    case 'select': {
      if (typeof value !== 'string') {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected option string',
        };
      }
      if (!schema.options.includes(value)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: `value not in options [${schema.options.join(', ')}]`,
        };
      }
      return { ok: true, normalized: value };
    }
    case 'multiselect':
    case 'multi-select': {
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected array',
        };
      }
      if (value.length > MAX_MULTISELECT_VALUES) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.TOO_MANY_MULTISELECT_VALUES,
          message: `multiselect exceeds ${MAX_MULTISELECT_VALUES} values`,
        };
      }
      for (const v of value) {
        if (typeof v !== 'string' || !schema.options.includes(v)) {
          return {
            ok: false,
            error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
            message: `value "${String(v)}" not in options`,
          };
        }
      }
      return { ok: true, normalized: JSON.stringify(value) };
    }
    case 'boolean': {
      if (value === true || value === 'true' || value === 1 || value === '1') {
        return { ok: true, normalized: 'true' };
      }
      if (value === false || value === 'false' || value === 0 || value === '0') {
        return { ok: true, normalized: 'false' };
      }
      return {
        ok: false,
        error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
        message: 'expected boolean',
      };
    }
    case 'url': {
      if (typeof value !== 'string' || !URL_REGEX.test(value)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected http(s) URL',
        };
      }
      if (value.length > MAX_VALUE_LEN) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.VALUE_TOO_LONG,
          message: `URL exceeds ${MAX_VALUE_LEN} chars`,
        };
      }
      return { ok: true, normalized: value };
    }
    case 'email': {
      if (typeof value !== 'string' || !EMAIL_REGEX.test(value.trim())) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected valid email',
        };
      }
      return { ok: true, normalized: value.trim().toLowerCase() };
    }
    case 'phone': {
      if (typeof value !== 'string' || !PHONE_REGEX.test(value)) {
        return {
          ok: false,
          error: CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE,
          message: 'expected phone number',
        };
      }
      return { ok: true, normalized: value.replace(/\s+/g, ' ').trim() };
    }
    default: {
      // exhaustive switch — unreachable si CUSTOM_FIELD_VALID_TYPES en sync
      return {
        ok: false,
        error: CUSTOM_FIELD_ERROR_CODES.INVALID_TYPE,
        message: `unknown type ${String(schema.field_type)}`,
      };
    }
  }
}

// ════════════════════════════════════════════════════════════
//  TENANT CAP
// ════════════════════════════════════════════════════════════

/**
 * Vérifie si un tenant peut encore créer un custom field (cap dur à
 * MAX_FIELDS_PER_TENANT = 50). Helper PUR : l'appelant fournit le count
 * actuel (un SELECT COUNT(*) en amont).
 */
export function canAddFieldForTenant(currentCount: number): {
  ok: boolean;
  error?: CustomFieldErrorCode;
  remaining: number;
} {
  if (!Number.isFinite(currentCount) || currentCount < 0) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.TENANT_CAP_REACHED,
      remaining: 0,
    };
  }
  if (currentCount >= MAX_FIELDS_PER_TENANT) {
    return {
      ok: false,
      error: CUSTOM_FIELD_ERROR_CODES.TENANT_CAP_REACHED,
      remaining: 0,
    };
  }
  return { ok: true, remaining: MAX_FIELDS_PER_TENANT - currentCount };
}
