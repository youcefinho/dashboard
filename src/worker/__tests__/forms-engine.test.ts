// ── Tests src/worker/lib/forms-engine.ts — LOT FORMS XL (Sprint 7) ─────────
// Helpers PURS : whitelist types, validation champ, validation soumission,
// honeypot, sanitize per-type, empreinte de dédup. ZÉRO I/O.
import { describe, it, expect } from 'vitest';
import {
  FORMS_ERROR_CODES,
  VALID_FIELD_TYPES,
  validateFieldDefinition,
  validateFormSubmission,
  detectBotSubmission,
  sanitizeFieldValue,
  computeSubmissionFingerprint,
} from '../lib/forms-engine';

describe('validateFieldDefinition — whitelist + grammaire', () => {
  it('accepte un champ text minimal', () => {
    expect(validateFieldDefinition({ name: 'email', type: 'email' }).ok).toBe(true);
  });

  it('refuse un type hors whitelist', () => {
    const r = validateFieldDefinition({ name: 'x', type: 'sql' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(FORMS_ERROR_CODES.INVALID_FIELD_TYPE);
  });

  it('refuse un champ sans nom', () => {
    const r = validateFieldDefinition({ type: 'text' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(FORMS_ERROR_CODES.INVALID_FIELD_NAME);
  });

  it('refuse select sans options', () => {
    const r = validateFieldDefinition({ name: 's', type: 'select' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(FORMS_ERROR_CODES.MISSING_OPTIONS);
  });

  it('refuse multiselect sans options', () => {
    const r = validateFieldDefinition({ name: 's', type: 'multiselect', options: [] });
    expect(r.ok).toBe(false);
  });

  it('accepte select avec options string ou objet', () => {
    expect(
      validateFieldDefinition({ name: 's', type: 'select', options: ['a', 'b'] }).ok,
    ).toBe(true);
    expect(
      validateFieldDefinition({
        name: 's',
        type: 'select',
        options: [{ value: 'a', label: 'A' }, { value: 'b' }],
      }).ok,
    ).toBe(true);
  });

  it('refuse select avec options malformées', () => {
    const r = validateFieldDefinition({ name: 's', type: 'select', options: [{}] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(FORMS_ERROR_CODES.INVALID_OPTIONS);
  });

  it('couvre tous les types whitelistés', () => {
    for (const type of VALID_FIELD_TYPES) {
      const def: Record<string, unknown> = { name: 'f', type };
      if (type === 'select' || type === 'multiselect') def.options = ['a'];
      expect(validateFieldDefinition(def).ok).toBe(true);
    }
  });
});

describe('detectBotSubmission — honeypot _hp', () => {
  it('détecte un honeypot rempli', () => {
    expect(detectBotSubmission({ _hp: 'spam' })).toBe(true);
  });

  it('ne déclenche pas si _hp vide ou absent', () => {
    expect(detectBotSubmission({ _hp: '' })).toBe(false);
    expect(detectBotSubmission({})).toBe(false);
    expect(detectBotSubmission({ _hp: '   ' })).toBe(false);
  });

  it('supporte un nom de honeypot custom', () => {
    expect(detectBotSubmission({ middle_name: 'x' }, 'middle_name')).toBe(true);
    expect(detectBotSubmission({ _hp: 'x' }, 'middle_name')).toBe(false);
  });

  it('ne crashe pas sur input invalide', () => {
    expect(detectBotSubmission(null as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('sanitizeFieldValue — per-type', () => {
  it('email : trim + lowercase + clamp', () => {
    expect(sanitizeFieldValue('  USER@EXAMPLE.COM  ', 'email')).toBe('user@example.com');
  });

  it('phone : strip non-numérique sauf +/-/()/./space', () => {
    expect(sanitizeFieldValue('+1 (514) 555-1234 abc', 'phone')).toBe('+1 (514) 555-1234');
  });

  it('checkbox : normalise true/on/1/yes → "1", reste → "0"', () => {
    expect(sanitizeFieldValue('true', 'checkbox')).toBe('1');
    expect(sanitizeFieldValue('on', 'checkbox')).toBe('1');
    expect(sanitizeFieldValue('yes', 'checkbox')).toBe('1');
    expect(sanitizeFieldValue('oui', 'checkbox')).toBe('1');
    expect(sanitizeFieldValue('1', 'checkbox')).toBe('1');
    expect(sanitizeFieldValue('', 'checkbox')).toBe('0');
    expect(sanitizeFieldValue('false', 'checkbox')).toBe('0');
  });

  it('textarea : clamp à 10000 chars (pas 2000)', () => {
    const long = 'a'.repeat(15000);
    expect(sanitizeFieldValue(long, 'textarea').length).toBe(10000);
  });

  it('text default : clamp à 2000 chars', () => {
    const long = 'a'.repeat(5000);
    expect(sanitizeFieldValue(long, 'text').length).toBe(2000);
  });

  it('null/undefined → ""', () => {
    expect(sanitizeFieldValue(null, 'text')).toBe('');
    expect(sanitizeFieldValue(undefined, 'text')).toBe('');
  });

  it('number : ne garde que chiffres + . + signe', () => {
    expect(sanitizeFieldValue('  -12.34abc', 'number')).toBe('-12.34');
  });
});

describe('validateFormSubmission — required + type checks', () => {
  it('accepte une soumission valide complète', () => {
    const schema = [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'text', required: true },
    ];
    const r = validateFormSubmission(
      { email: 'a@b.co', name: 'John' },
      schema,
    );
    expect(r.ok).toBe(true);
  });

  it('détecte un champ requis manquant', () => {
    const schema = [{ name: 'email', type: 'email', required: true }];
    const r = validateFormSubmission({}, schema);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.code).toBe(FORMS_ERROR_CODES.MISSING_REQUIRED);
  });

  it('détecte un email invalide', () => {
    const schema = [{ name: 'email', type: 'email', required: true }];
    const r = validateFormSubmission({ email: 'not-an-email' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.code).toBe(FORMS_ERROR_CODES.INVALID_EMAIL);
  });

  it('détecte un phone invalide', () => {
    const schema = [{ name: 'phone', type: 'phone', required: true }];
    const r = validateFormSubmission({ phone: '!!!' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.code).toBe(FORMS_ERROR_CODES.INVALID_PHONE);
  });

  it('détecte une date invalide', () => {
    const schema = [{ name: 'd', type: 'date', required: true }];
    expect(validateFormSubmission({ d: 'not-iso' }, schema).ok).toBe(false);
    expect(validateFormSubmission({ d: '2024-12-25' }, schema).ok).toBe(true);
    expect(validateFormSubmission({ d: '2024-12-25T10:00:00Z' }, schema).ok).toBe(true);
  });

  it('skip honeypot _hp', () => {
    const schema = [{ name: '_hp', type: 'text', required: true }];
    expect(validateFormSubmission({}, schema).ok).toBe(true);
  });

  it('skip type-check si champ vide et non requis', () => {
    const schema = [{ name: 'email', type: 'email', required: false }];
    expect(validateFormSubmission({}, schema).ok).toBe(true);
  });

  it('détecte FIELD_TOO_LONG sur text', () => {
    const schema = [{ name: 't', type: 'text' }];
    const r = validateFormSubmission({ t: 'a'.repeat(2001) }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.code).toBe(FORMS_ERROR_CODES.FIELD_TOO_LONG);
  });

  it('accumule plusieurs erreurs', () => {
    const schema = [
      { name: 'email', type: 'email', required: true },
      { name: 'phone', type: 'phone', required: true },
    ];
    const r = validateFormSubmission({ email: 'x', phone: '!!' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors?.length).toBe(2);
  });

  it('refuse un schéma non-array', () => {
    const r = validateFormSubmission({ a: 1 }, null as unknown as []);
    expect(r.ok).toBe(false);
  });
});

describe('computeSubmissionFingerprint — déterministe + stable', () => {
  it('produit le même hash pour des valeurs identiques', () => {
    const a = computeSubmissionFingerprint({ email: 'a@b.co', name: 'John' });
    const b = computeSubmissionFingerprint({ email: 'a@b.co', name: 'John' });
    expect(a).toBe(b);
  });

  it("est insensible à l'ordre des clés", () => {
    const a = computeSubmissionFingerprint({ name: 'X', email: 'a@b.co' });
    const b = computeSubmissionFingerprint({ email: 'a@b.co', name: 'X' });
    expect(a).toBe(b);
  });

  it('normalise la casse et le trim', () => {
    const a = computeSubmissionFingerprint({ email: '  A@B.CO  ' });
    const b = computeSubmissionFingerprint({ email: 'a@b.co' });
    expect(a).toBe(b);
  });

  it('ignore _hp et utm_*', () => {
    const a = computeSubmissionFingerprint({ email: 'a@b.co', _hp: 'spam' });
    const b = computeSubmissionFingerprint({ email: 'a@b.co' });
    expect(a).toBe(b);
    const c = computeSubmissionFingerprint({
      email: 'a@b.co',
      utm_source: 'x',
      utm_campaign: 'y',
    });
    expect(c).toBe(b);
  });

  it('produit des hashs différents pour des values différentes', () => {
    const a = computeSubmissionFingerprint({ email: 'a@b.co' });
    const b = computeSubmissionFingerprint({ email: 'b@c.co' });
    expect(a).not.toBe(b);
  });

  it('renvoie "0" sur input invalide', () => {
    expect(computeSubmissionFingerprint(null as unknown as Record<string, unknown>)).toBe('0');
  });
});
