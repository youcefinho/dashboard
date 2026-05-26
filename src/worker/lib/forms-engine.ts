// ── forms-engine.ts — helpers PURS pour LOT FORMS XL (Sprint 7) ─────────────
//
// Engine helpers RENFORCEMENT pour forms.ts. ZÉRO I/O (pas de DB, pas de
// fetch). Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Whitelist types de champs (text/email/phone/select/multiselect/file/
//     textarea/date/checkbox)
//   - Validation d'un FormField (type + options pour select/multiselect)
//   - Validation d'une soumission contre un schéma (required + type-check
//     léger), aligné sur l'éval conditionnelle de forms.ts:isFieldVisible
//   - Détection bot (honeypot _hp)
//   - Sanitize per-type
//   - Empreinte de dédup (hash stable) — utile pour throttle / replay-attack
//
// 100% additif : forms.ts continue de fonctionner sans cet engine. Les
// handlers peuvent l'appeler EN AMONT pour valider AVANT toute requête DB.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const FORMS_ERROR_CODES = {
  INVALID_FIELD_TYPE: 'forms.field.type_invalid',
  INVALID_FIELD_NAME: 'forms.field.name_invalid',
  MISSING_OPTIONS: 'forms.field.options_required',
  INVALID_OPTIONS: 'forms.field.options_invalid',
  MISSING_REQUIRED: 'forms.submission.missing_required',
  INVALID_EMAIL: 'forms.submission.email_invalid',
  INVALID_PHONE: 'forms.submission.phone_invalid',
  INVALID_DATE: 'forms.submission.date_invalid',
  BOT_DETECTED: 'forms.submission.bot_detected',
  FIELD_TOO_LONG: 'forms.submission.field_too_long',
} as const;

// ── Whitelist : types acceptés (figés Phase A) ──────────────────────────────
export const VALID_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'select',
  'multiselect',
  'file',
  'textarea',
  'date',
  'checkbox',
  'number',
  'url',
] as const;
export type FieldType = (typeof VALID_FIELD_TYPES)[number];

// Bornes max raisonnables (alignées sur sanitizeInput dans forms.ts).
export const MAX_FIELD_NAME_LENGTH = 100;
export const MAX_TEXT_VALUE_LENGTH = 2000;
export const MAX_TEXTAREA_VALUE_LENGTH = 10000;
export const MAX_EMAIL_LENGTH = 200;
export const MAX_PHONE_LENGTH = 30;
export const MAX_URL_LENGTH = 500;

// ── Validation d'une définition de champ ────────────────────────────────────
export interface FieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  options?: Array<string | { value: string; label?: string }>;
  custom_field_id?: string;
}

export interface FieldDefinitionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export function validateFieldDefinition(field: unknown): FieldDefinitionResult {
  if (!field || typeof field !== 'object') {
    return { ok: false, error: FORMS_ERROR_CODES.INVALID_FIELD_NAME };
  }
  const f = field as Record<string, unknown>;
  if (typeof f.name !== 'string' || f.name.trim().length === 0) {
    return { ok: false, error: FORMS_ERROR_CODES.INVALID_FIELD_NAME, field: 'name' };
  }
  if (f.name.length > MAX_FIELD_NAME_LENGTH) {
    return { ok: false, error: FORMS_ERROR_CODES.INVALID_FIELD_NAME, field: 'name' };
  }
  if (typeof f.type !== 'string' || !VALID_FIELD_TYPES.includes(f.type as FieldType)) {
    return {
      ok: false,
      error: FORMS_ERROR_CODES.INVALID_FIELD_TYPE,
      field: f.name as string | undefined,
    };
  }
  // select/multiselect : options non vides obligatoires
  if (f.type === 'select' || f.type === 'multiselect') {
    if (!Array.isArray(f.options) || f.options.length === 0) {
      return {
        ok: false,
        error: FORMS_ERROR_CODES.MISSING_OPTIONS,
        field: f.name as string,
      };
    }
    for (const opt of f.options) {
      if (typeof opt === 'string') continue;
      if (opt && typeof opt === 'object' && typeof (opt as Record<string, unknown>).value === 'string') continue;
      return {
        ok: false,
        error: FORMS_ERROR_CODES.INVALID_OPTIONS,
        field: f.name as string,
      };
    }
  }
  return { ok: true };
}

// ── Sanitize per-type (déterministe) ────────────────────────────────────────
// Trim + clamp longueur selon le type. NE PAS percoler les valeurs — c'est
// applicatif (côté handler) qui décide d'écrire en DB.
export function sanitizeFieldValue(value: unknown, type: string): string {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : String(value);
  switch (type) {
    case 'email':
      return raw.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
    case 'phone':
      return raw.replace(/[^0-9+()\-.\s]/g, '').trim().slice(0, MAX_PHONE_LENGTH);
    case 'textarea':
      return raw.slice(0, MAX_TEXTAREA_VALUE_LENGTH);
    case 'url':
      return raw.trim().slice(0, MAX_URL_LENGTH);
    case 'number':
      // Garde signe + chiffres + point. Pas de conversion (caller décide).
      return raw.replace(/[^0-9.\-]/g, '').slice(0, 40);
    case 'date':
      return raw.trim().slice(0, 30);
    case 'checkbox':
      // Normalise "true"/"on"/"1" → "1", reste → "0"
      return /^(true|on|1|yes|oui)$/i.test(raw.trim()) ? '1' : '0';
    default:
      return raw.trim().slice(0, MAX_TEXT_VALUE_LENGTH);
  }
}

// ── Détection bot (honeypot _hp) ────────────────────────────────────────────
// Calque la convention `_hp` figée dans forms.ts. Peut être étendu avec un
// nom alternatif si le form override (rare).
export function detectBotSubmission(
  values: Record<string, unknown>,
  honeypotField: string = '_hp',
): boolean {
  if (!values || typeof values !== 'object') return false;
  const v = values[honeypotField];
  if (v === undefined || v === null) return false;
  return String(v).trim().length > 0;
}

// ── Validation soumission complète ──────────────────────────────────────────
export interface FormSubmissionResult {
  ok: boolean;
  error?: string;
  errors?: Array<{ field: string; code: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s()\-.]{6,30}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/;

export function validateFormSubmission(
  values: Record<string, unknown>,
  schema: FieldDefinition[],
): FormSubmissionResult {
  if (!values || typeof values !== 'object') {
    return { ok: false, error: FORMS_ERROR_CODES.MISSING_REQUIRED };
  }
  if (!Array.isArray(schema)) {
    return { ok: false, error: FORMS_ERROR_CODES.INVALID_FIELD_NAME };
  }

  const errors: Array<{ field: string; code: string }> = [];
  for (const field of schema) {
    if (!field || !field.name || field.name === '_hp') continue;
    const value = values[field.name];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    if (field.required && isEmpty) {
      errors.push({ field: field.name, code: FORMS_ERROR_CODES.MISSING_REQUIRED });
      continue;
    }
    if (isEmpty) continue; // optional, no value → skip type checks

    // Type-check léger (best-effort) — ne bloque pas si le format est exotique
    const raw = typeof value === 'string' ? value.trim() : String(value);
    switch (field.type) {
      case 'email':
        if (!EMAIL_RE.test(raw)) {
          errors.push({ field: field.name, code: FORMS_ERROR_CODES.INVALID_EMAIL });
        }
        break;
      case 'phone':
        if (!PHONE_RE.test(raw)) {
          errors.push({ field: field.name, code: FORMS_ERROR_CODES.INVALID_PHONE });
        }
        break;
      case 'date':
        if (!ISO_DATE_RE.test(raw)) {
          errors.push({ field: field.name, code: FORMS_ERROR_CODES.INVALID_DATE });
        }
        break;
      case 'text':
        if (raw.length > MAX_TEXT_VALUE_LENGTH) {
          errors.push({ field: field.name, code: FORMS_ERROR_CODES.FIELD_TOO_LONG });
        }
        break;
      case 'textarea':
        if (raw.length > MAX_TEXTAREA_VALUE_LENGTH) {
          errors.push({ field: field.name, code: FORMS_ERROR_CODES.FIELD_TOO_LONG });
        }
        break;
      default:
        break;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, error: errors[0]!.code };
  }
  return { ok: true };
}

// ── Empreinte de soumission (hash stable, déterministe) ─────────────────────
// Sert au throttle anti-replay : 2 submits identiques en <Xs ⇒ déduper.
// Hash FNV-1a 32-bit non cryptographique mais stable cross-runtime.
// Les clés sont triées et les valeurs trim() pour éviter les divergences.
export function computeSubmissionFingerprint(
  values: Record<string, unknown>,
): string {
  if (!values || typeof values !== 'object') return '0';
  const keys = Object.keys(values)
    .filter((k) => k !== '_hp' && k !== '_t' && !k.startsWith('utm_'))
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = values[k];
    const norm = v == null ? '' : String(v).trim().toLowerCase();
    parts.push(`${k}=${norm}`);
  }
  const joined = parts.join('&');
  let hash = 0x811c9dc5; // FNV-1a 32 offset
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV-1a prime
  }
  // Toujours positif, base36
  return (hash >>> 0).toString(36);
}
