// ── templates-engine.test.ts — Renforcement P2 (2026-05-26) ───────────────
// Tests unitaires des helpers PURS templates-engine. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  TEMPLATES_ERROR_CODES,
  VALID_TEMPLATE_CHANNELS,
  MAX_SUBJECT_LENGTH,
  MAX_BODY_LENGTH,
  MAX_SMS_LENGTH,
  validateTemplateInput,
  extractTemplateVariables,
  interpolateTemplate,
  validateVariableNames,
  sanitizeHtmlBody,
} from '../lib/templates-engine';

describe('TEMPLATES constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(TEMPLATES_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_TEMPLATE_CHANNELS)).toBe(true);
  });

  it('Caps cohérents', () => {
    expect(MAX_SUBJECT_LENGTH).toBe(200);
    expect(MAX_BODY_LENGTH).toBe(100000);
    expect(MAX_SMS_LENGTH).toBe(1000);
  });
});

describe('validateTemplateInput', () => {
  it('accepte minimum valide email', () => {
    const r = validateTemplateInput({
      name: 'Welcome',
      channel: 'email',
      subject: 'Hi',
      body_html: '<p>x</p>',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette nom vide', () => {
    const r = validateTemplateInput({ name: '', channel: 'email', subject: 'x' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.NAME_REQUIRED);
  });

  it('rejette nom trop long', () => {
    const r = validateTemplateInput({
      name: 'x'.repeat(150),
      channel: 'email',
      subject: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.NAME_TOO_LONG);
  });

  it('rejette subject vide email', () => {
    const r = validateTemplateInput({ name: 'n', channel: 'email', subject: '' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.SUBJECT_REQUIRED);
  });

  it('accepte subject vide SMS', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'sms',
      body_text: 'STOP au 555',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette channel invalide', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'fax',
      subject: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.CHANNEL_INVALID);
  });

  it('rejette SMS trop long', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'sms',
      body_text: 'x'.repeat(1500) + ' STOP',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.SMS_TOO_LONG);
  });

  it('rejette SMS sans opt-out', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'sms',
      body_text: 'Hello world',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.SMS_MISSING_OPTOUT);
  });

  it('accepte SMS avec ARRÊT', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'sms',
      body_text: 'Hello, répondez ARRÊT pour stopper',
    });
    expect(r.ok).toBe(true);
  });

  it('accepte SMS avec ARRET (sans accent)', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'sms',
      body_text: 'Hello, ARRET pour stop',
    });
    expect(r.ok).toBe(true);
  });

  it('rejette body au-dessus du cap email', () => {
    const r = validateTemplateInput({
      name: 'n',
      channel: 'email',
      subject: 'x',
      body_html: 'x'.repeat(MAX_BODY_LENGTH + 100),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TEMPLATES_ERROR_CODES.BODY_TOO_LONG);
  });
});

describe('extractTemplateVariables', () => {
  it('extrait variables simples', () => {
    const v = extractTemplateVariables('Hello {{name}}, your {{order}} is ready');
    expect(v).toContain('name');
    expect(v).toContain('order');
  });

  it('extrait variables dotted', () => {
    const v = extractTemplateVariables('Hi {{lead.first_name}}');
    expect(v).toContain('lead.first_name');
  });

  it('dédoublonne', () => {
    const v = extractTemplateVariables('{{x}} {{x}} {{x}}');
    expect(v).toEqual(['x']);
  });

  it('texte vide → []', () => {
    expect(extractTemplateVariables('')).toEqual([]);
  });

  it('tolère espaces autour du nom', () => {
    const v = extractTemplateVariables('Hi {{ name }}');
    expect(v).toContain('name');
  });

  it('ignore les non-strings', () => {
    expect(extractTemplateVariables(null as never)).toEqual([]);
  });

  it('résultat trié alphabétiquement', () => {
    const v = extractTemplateVariables('{{zebra}} {{alpha}} {{mango}}');
    expect(v).toEqual(['alpha', 'mango', 'zebra']);
  });
});

describe('interpolateTemplate', () => {
  it('remplace les variables connues', () => {
    expect(interpolateTemplate('Hi {{name}}', { name: 'Bob' })).toBe('Hi Bob');
  });

  it('remplace par chaîne vide si null', () => {
    expect(interpolateTemplate('Hi {{name}}', { name: null })).toBe('Hi ');
  });

  it('conserve les variables inconnues', () => {
    expect(interpolateTemplate('Hi {{unknown}}', {})).toBe('Hi {{unknown}}');
  });

  it('supporte dotted notation', () => {
    expect(
      interpolateTemplate('Hi {{lead.name}}', { 'lead.name': 'Alice' }),
    ).toBe('Hi Alice');
  });

  it('supporte les nombres', () => {
    expect(interpolateTemplate('Total: {{n}}', { n: 42 })).toBe('Total: 42');
  });

  it('texte vide → vide', () => {
    expect(interpolateTemplate('', { x: 'y' })).toBe('');
  });

  it('remplacements multiples', () => {
    expect(interpolateTemplate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 })).toBe(
      '1 + 2 = 3',
    );
  });
});

describe('validateVariableNames', () => {
  it('accepte snake_case simple', () => {
    expect(validateVariableNames({ first_name: 'x' }).ok).toBe(true);
  });

  it('accepte dotted snake_case', () => {
    expect(validateVariableNames({ 'lead.first_name': 'x' }).ok).toBe(true);
  });

  it('rejette camelCase', () => {
    const r = validateVariableNames({ firstName: 'x' });
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain('firstName');
  });

  it('rejette espaces', () => {
    const r = validateVariableNames({ 'first name': 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejette caractères spéciaux', () => {
    const r = validateVariableNames({ 'lead-name': 'x' });
    expect(r.ok).toBe(false);
  });

  it('vars vide = OK', () => {
    expect(validateVariableNames({}).ok).toBe(true);
  });
});

describe('sanitizeHtmlBody', () => {
  it('strip <script>', () => {
    expect(sanitizeHtmlBody('<p>Hi</p><script>alert(1)</script>')).not.toMatch(
      /<script/,
    );
  });

  it('strip <iframe>', () => {
    expect(sanitizeHtmlBody('<iframe src="x"></iframe>')).not.toMatch(/<iframe/);
  });

  it('strip event handlers onclick', () => {
    const out = sanitizeHtmlBody('<a onclick="alert(1)" href="/">x</a>');
    expect(out).not.toMatch(/onclick/);
  });

  it('strip event handlers onerror', () => {
    const out = sanitizeHtmlBody('<img onerror="x" src="y" />');
    expect(out).not.toMatch(/onerror/);
  });

  it('strip javascript: URLs', () => {
    const out = sanitizeHtmlBody('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/);
  });

  it('strip <style>', () => {
    expect(sanitizeHtmlBody('<style>body{}</style><p>x</p>')).not.toMatch(
      /<style/,
    );
  });

  it('conserve le contenu propre', () => {
    const clean = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeHtmlBody(clean)).toBe(clean);
  });

  it('vide → vide', () => {
    expect(sanitizeHtmlBody('')).toBe('');
  });

  it('non-string → vide', () => {
    expect(sanitizeHtmlBody(null as never)).toBe('');
  });
});
