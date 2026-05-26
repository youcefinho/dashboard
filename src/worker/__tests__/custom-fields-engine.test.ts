// ── custom-fields-engine.test.ts — Tests RENFORCEMENT custom-fields-engine ──
//
// Couvre les helpers PURS extraits de custom-fields.ts : slugify, validation
// schema (type whitelist + options pour select), validation valeur typée
// (string/number/date/select/multi-select/url/email/boolean/phone),
// cap MAX_FIELDS_PER_TENANT.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  CUSTOM_FIELD_ERROR_CODES,
  CUSTOM_FIELD_VALID_TYPES,
  MAX_FIELDS_PER_TENANT,
  MAX_FIELD_NAME_LEN,
  MAX_SELECT_OPTIONS,
  MAX_VALUE_LEN,
  MAX_MULTISELECT_VALUES,
  isValidFieldType,
  slugifyFieldName,
  validateFieldSchema,
  validateFieldValue,
  canAddFieldForTenant,
  type NormalizedFieldSchema,
} from '../lib/custom-fields-engine';

describe('custom-fields-engine — constants & guards', () => {
  it('exposes 11 valid types including string + text alias', () => {
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('string');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('text');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('number');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('date');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('select');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('multiselect');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('multi-select');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('boolean');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('url');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('email');
    expect(CUSTOM_FIELD_VALID_TYPES).toContain('phone');
  });

  it('isValidFieldType rejects unknown', () => {
    expect(isValidFieldType('string')).toBe(true);
    expect(isValidFieldType('object')).toBe(false);
    expect(isValidFieldType(null)).toBe(false);
  });

  it('exposes correct caps', () => {
    expect(MAX_FIELDS_PER_TENANT).toBe(50);
    expect(MAX_FIELD_NAME_LEN).toBe(100);
    expect(MAX_SELECT_OPTIONS).toBe(50);
    expect(MAX_VALUE_LEN).toBe(1000);
    expect(MAX_MULTISELECT_VALUES).toBe(20);
  });
});

describe('custom-fields-engine — slugifyFieldName', () => {
  it('produces lowercase underscore slug', () => {
    expect(slugifyFieldName('My Field Name').slug).toBe('my_field_name');
  });

  it('collapses repeated underscores', () => {
    expect(slugifyFieldName('a--b  c').slug).toBe('a_b_c');
  });

  it('strips leading/trailing underscores', () => {
    expect(slugifyFieldName('   spaced   ').slug).toBe('spaced');
    expect(slugifyFieldName('!!!hello!!!').slug).toBe('hello');
  });

  it('rejects empty', () => {
    expect(slugifyFieldName('').ok).toBe(false);
    expect(slugifyFieldName('   ').ok).toBe(false);
  });

  it('rejects input producing empty slug', () => {
    const r = slugifyFieldName('!!!');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.INVALID_SLUG);
  });

  it('rejects non-string', () => {
    expect(slugifyFieldName(42).ok).toBe(false);
    expect(slugifyFieldName(null).ok).toBe(false);
  });
});

describe('custom-fields-engine — validateFieldSchema', () => {
  it('accepts minimal text schema', () => {
    const r = validateFieldSchema({ name: 'Notes', field_type: 'text' });
    expect(r.ok).toBe(true);
    expect(r.schema?.slug).toBe('notes');
    expect(r.schema?.field_type).toBe('text');
    expect(r.schema?.is_required).toBe(false);
  });

  it('rejects missing name', () => {
    const r = validateFieldSchema({ field_type: 'text' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.INVALID_NAME);
  });

  it('rejects name too long', () => {
    const r = validateFieldSchema({
      name: 'a'.repeat(101),
      field_type: 'text',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown field_type', () => {
    const r = validateFieldSchema({ name: 'x', field_type: 'object' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.INVALID_TYPE);
  });

  it('rejects select without options', () => {
    const r = validateFieldSchema({ name: 'Status', field_type: 'select' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.MISSING_OPTIONS);
  });

  it('rejects select with empty options array', () => {
    const r = validateFieldSchema({
      name: 'Status',
      field_type: 'select',
      options: [],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.MISSING_OPTIONS);
  });

  it('accepts select with options', () => {
    const r = validateFieldSchema({
      name: 'Status',
      field_type: 'select',
      options: ['active', 'inactive'],
    });
    expect(r.ok).toBe(true);
    expect(r.schema?.options).toEqual(['active', 'inactive']);
  });

  it('dedupes options', () => {
    const r = validateFieldSchema({
      name: 'Tags',
      field_type: 'multiselect',
      options: ['a', 'b', 'a', 'c'],
    });
    expect(r.ok).toBe(true);
    expect(r.schema?.options).toEqual(['a', 'b', 'c']);
  });

  it('rejects options for non-enum type', () => {
    const r = validateFieldSchema({
      name: 'Age',
      field_type: 'number',
      options: ['1', '2'],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.INVALID_OPTIONS);
  });

  it('rejects too many options', () => {
    const many = Array.from({ length: 51 }, (_, i) => `o${i}`);
    const r = validateFieldSchema({
      name: 'X',
      field_type: 'select',
      options: many,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.TOO_MANY_OPTIONS);
  });

  it('rejects non-string option', () => {
    const r = validateFieldSchema({
      name: 'X',
      field_type: 'select',
      options: ['a', 42 as unknown as string],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects empty string in options', () => {
    const r = validateFieldSchema({
      name: 'X',
      field_type: 'select',
      options: ['a', ''],
    });
    expect(r.ok).toBe(false);
  });

  it('normalizes is_required', () => {
    expect(
      validateFieldSchema({
        name: 'x',
        field_type: 'text',
        is_required: true,
      }).schema?.is_required,
    ).toBe(true);
    expect(
      validateFieldSchema({
        name: 'x',
        field_type: 'text',
        is_required: 1,
      }).schema?.is_required,
    ).toBe(true);
    expect(
      validateFieldSchema({
        name: 'x',
        field_type: 'text',
        is_required: 'yes' as unknown as boolean,
      }).schema?.is_required,
    ).toBe(false);
  });
});

describe('custom-fields-engine — validateFieldValue', () => {
  const textSchema: NormalizedFieldSchema = {
    name: 'Notes',
    slug: 'notes',
    field_type: 'text',
    options: [],
    is_required: false,
  };
  const reqText: NormalizedFieldSchema = { ...textSchema, is_required: true };
  const numSchema: NormalizedFieldSchema = {
    name: 'Age',
    slug: 'age',
    field_type: 'number',
    options: [],
    is_required: false,
  };
  const dateSchema: NormalizedFieldSchema = {
    name: 'Birth',
    slug: 'birth',
    field_type: 'date',
    options: [],
    is_required: false,
  };
  const selectSchema: NormalizedFieldSchema = {
    name: 'Status',
    slug: 'status',
    field_type: 'select',
    options: ['active', 'inactive'],
    is_required: false,
  };
  const multiSchema: NormalizedFieldSchema = {
    name: 'Tags',
    slug: 'tags',
    field_type: 'multiselect',
    options: ['a', 'b', 'c'],
    is_required: false,
  };
  const boolSchema: NormalizedFieldSchema = {
    name: 'Active',
    slug: 'active',
    field_type: 'boolean',
    options: [],
    is_required: false,
  };
  const urlSchema: NormalizedFieldSchema = {
    name: 'Website',
    slug: 'website',
    field_type: 'url',
    options: [],
    is_required: false,
  };
  const emailSchema: NormalizedFieldSchema = {
    name: 'Email',
    slug: 'email',
    field_type: 'email',
    options: [],
    is_required: false,
  };
  const phoneSchema: NormalizedFieldSchema = {
    name: 'Phone',
    slug: 'phone',
    field_type: 'phone',
    options: [],
    is_required: false,
  };

  it('accepts empty value for optional field', () => {
    expect(validateFieldValue('', textSchema).ok).toBe(true);
    expect(validateFieldValue(null, textSchema).ok).toBe(true);
    expect(validateFieldValue(undefined, textSchema).ok).toBe(true);
  });

  it('rejects empty value for required field', () => {
    const r = validateFieldValue('', reqText);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.REQUIRED_FIELD);
  });

  it('text: accepts string', () => {
    const r = validateFieldValue('hello', textSchema);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('hello');
  });

  it('text: rejects non-string', () => {
    expect(validateFieldValue(42, textSchema).ok).toBe(false);
  });

  it('text: rejects value > MAX_VALUE_LEN', () => {
    const r = validateFieldValue('a'.repeat(1001), textSchema);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.VALUE_TOO_LONG);
  });

  it('number: accepts numeric string', () => {
    const r = validateFieldValue('42', numSchema);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('42');
  });

  it('number: accepts negative + decimal', () => {
    expect(validateFieldValue(-3.14, numSchema).ok).toBe(true);
  });

  it('number: rejects NaN / Infinity', () => {
    expect(validateFieldValue('abc', numSchema).ok).toBe(false);
    expect(validateFieldValue(Infinity, numSchema).ok).toBe(false);
  });

  it('date: accepts YYYY-MM-DD', () => {
    expect(validateFieldValue('2026-01-15', dateSchema).ok).toBe(true);
  });

  it('date: accepts ISO datetime', () => {
    expect(
      validateFieldValue('2026-01-15T10:00:00Z', dateSchema).ok,
    ).toBe(true);
  });

  it('date: rejects garbage', () => {
    expect(validateFieldValue('not-a-date', dateSchema).ok).toBe(false);
  });

  it('select: accepts known option', () => {
    expect(validateFieldValue('active', selectSchema).ok).toBe(true);
  });

  it('select: rejects unknown option', () => {
    const r = validateFieldValue('archived', selectSchema);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.INVALID_VALUE);
  });

  it('multiselect: accepts array of valid options', () => {
    const r = validateFieldValue(['a', 'b'], multiSchema);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('["a","b"]');
  });

  it('multiselect: rejects unknown option in array', () => {
    expect(validateFieldValue(['a', 'z'], multiSchema).ok).toBe(false);
  });

  it('multiselect: rejects non-array', () => {
    expect(validateFieldValue('a', multiSchema).ok).toBe(false);
  });

  it('multiselect: rejects > MAX_MULTISELECT_VALUES', () => {
    const big = Array.from({ length: 21 }, () => 'a');
    const r = validateFieldValue(big, multiSchema);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.TOO_MANY_MULTISELECT_VALUES);
  });

  it('boolean: accepts true/false/1/0/"true"/"false"', () => {
    expect(validateFieldValue(true, boolSchema).normalized).toBe('true');
    expect(validateFieldValue(false, boolSchema).normalized).toBe('false');
    expect(validateFieldValue(1, boolSchema).normalized).toBe('true');
    expect(validateFieldValue(0, boolSchema).normalized).toBe('false');
    expect(validateFieldValue('true', boolSchema).normalized).toBe('true');
    expect(validateFieldValue('false', boolSchema).normalized).toBe('false');
  });

  it('boolean: rejects "yes"/"no"', () => {
    expect(validateFieldValue('yes', boolSchema).ok).toBe(false);
  });

  it('url: accepts https URL', () => {
    expect(
      validateFieldValue('https://example.com/path', urlSchema).ok,
    ).toBe(true);
  });

  it('url: rejects non-http', () => {
    expect(validateFieldValue('ftp://example.com', urlSchema).ok).toBe(false);
    expect(validateFieldValue('example.com', urlSchema).ok).toBe(false);
  });

  it('email: accepts valid + lowercases', () => {
    const r = validateFieldValue('User@Example.COM', emailSchema);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('user@example.com');
  });

  it('email: rejects invalid', () => {
    expect(validateFieldValue('not-email', emailSchema).ok).toBe(false);
  });

  it('phone: accepts international format', () => {
    expect(validateFieldValue('+1 (514) 555-1234', phoneSchema).ok).toBe(true);
  });

  it('phone: rejects too short', () => {
    expect(validateFieldValue('12', phoneSchema).ok).toBe(false);
  });
});

describe('custom-fields-engine — canAddFieldForTenant', () => {
  it('allows when below cap', () => {
    const r = canAddFieldForTenant(10);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(40);
  });

  it('refuses at cap', () => {
    const r = canAddFieldForTenant(50);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CUSTOM_FIELD_ERROR_CODES.TENANT_CAP_REACHED);
  });

  it('refuses above cap (data drift)', () => {
    expect(canAddFieldForTenant(55).ok).toBe(false);
  });

  it('refuses negative/NaN count', () => {
    expect(canAddFieldForTenant(-1).ok).toBe(false);
    expect(canAddFieldForTenant(NaN).ok).toBe(false);
  });

  it('allows at 49 (1 slot left)', () => {
    const r = canAddFieldForTenant(49);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(1);
  });
});
