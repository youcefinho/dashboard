// ── chat-widgets-engine.test.ts — Tests RENFORCEMENT chat-widgets-engine.ts ──
//
// Couvre validation widget config, validateColorHex, sanitizeWelcomeMessage
// (XSS strip), allowed_origins, business_hours, generateEmbedSnippet.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  CHAT_WIDGETS_ERROR_CODES,
  MAX_WELCOME_LENGTH,
  MAX_ALLOWED_ORIGINS,
  VALID_POSITIONS,
  VALID_THEMES,
  validateColorHex,
  sanitizeWelcomeMessage,
  validateWidgetConfig,
  validateAllowedOrigins,
  validateBusinessHours,
  generateEmbedSnippet,
} from '../lib/chat-widgets-engine';

describe('chat-widgets-engine — constants', () => {
  it('exposes position whitelist', () => {
    expect(VALID_POSITIONS).toEqual(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
  });

  it('exposes theme whitelist', () => {
    expect(VALID_THEMES).toEqual(['light', 'dark', 'auto']);
  });

  it('exposes caps', () => {
    expect(MAX_WELCOME_LENGTH).toBe(200);
    expect(MAX_ALLOWED_ORIGINS).toBe(50);
  });

  it('exposes stable error codes', () => {
    expect(CHAT_WIDGETS_ERROR_CODES.INVALID_NAME).toBe('invalid_name');
    expect(CHAT_WIDGETS_ERROR_CODES.WELCOME_TOO_LONG).toBe('welcome_too_long');
    expect(CHAT_WIDGETS_ERROR_CODES.INVALID_COLOR).toBe('invalid_color');
  });
});

describe('chat-widgets-engine — validateColorHex', () => {
  it('accepts #RRGGBB (lower + upper)', () => {
    expect(validateColorHex('#abcdef')).toBe(true);
    expect(validateColorHex('#ABCDEF')).toBe(true);
    expect(validateColorHex('#012345')).toBe(true);
  });

  it('accepts #RGB short form', () => {
    expect(validateColorHex('#fff')).toBe(true);
    expect(validateColorHex('#000')).toBe(true);
    expect(validateColorHex('#aBc')).toBe(true);
  });

  it('rejects missing #', () => {
    expect(validateColorHex('abcdef')).toBe(false);
    expect(validateColorHex('ffffff')).toBe(false);
  });

  it('rejects invalid hex / length', () => {
    expect(validateColorHex('#ggg')).toBe(false);
    expect(validateColorHex('#12345')).toBe(false);
    expect(validateColorHex('#1234567')).toBe(false);
  });

  it('rejects non-hex formats', () => {
    expect(validateColorHex('rgb(0,0,0)')).toBe(false);
    expect(validateColorHex('red')).toBe(false);
    expect(validateColorHex('')).toBe(false);
    expect(validateColorHex(null)).toBe(false);
  });
});

describe('chat-widgets-engine — sanitizeWelcomeMessage', () => {
  it('strips <script> blocks completely', () => {
    expect(sanitizeWelcomeMessage('Hello <script>alert(1)</script> world')).toBe('Hello  world');
  });

  it('strips <style> blocks completely', () => {
    expect(sanitizeWelcomeMessage('Hi <style>body{}</style>')).toBe('Hi');
  });

  it('strips ordinary tags but keeps text', () => {
    expect(sanitizeWelcomeMessage('Hello <b>world</b>')).toBe('Hello world');
  });

  it('strips javascript: URIs', () => {
    expect(sanitizeWelcomeMessage('click javascript:alert(1)')).toBe('click alert(1)');
  });

  it('strips data:text/html URIs', () => {
    expect(sanitizeWelcomeMessage('open data:text/html,<x>')).toBe('open ,');
  });

  it('strips on* event handlers', () => {
    const r = sanitizeWelcomeMessage('hello onclick="evil()" world');
    expect(r).not.toContain('onclick');
  });

  it('returns empty for non-string', () => {
    expect(sanitizeWelcomeMessage(null)).toBe('');
    expect(sanitizeWelcomeMessage(undefined)).toBe('');
    expect(sanitizeWelcomeMessage(42)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeWelcomeMessage('   hello   ')).toBe('hello');
  });
});

describe('chat-widgets-engine — validateWidgetConfig', () => {
  it('accepts valid minimal config', () => {
    const r = validateWidgetConfig({ name: 'My Widget' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing/empty name', () => {
    expect(validateWidgetConfig({}).ok).toBe(false);
    expect(validateWidgetConfig({ name: '' }).ok).toBe(false);
    expect(validateWidgetConfig({ name: '   ' }).ok).toBe(false);
  });

  it('rejects name too long', () => {
    const r = validateWidgetConfig({ name: 'x'.repeat(201) });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('name');
  });

  it('accepts valid position', () => {
    expect(validateWidgetConfig({ name: 'w', position: 'bottom-right' }).ok).toBe(true);
    expect(validateWidgetConfig({ name: 'w', position: 'top-left' }).ok).toBe(true);
  });

  it('rejects invalid position', () => {
    const r = validateWidgetConfig({ name: 'w', position: 'center' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHAT_WIDGETS_ERROR_CODES.INVALID_POSITION);
  });

  it('accepts valid theme', () => {
    expect(validateWidgetConfig({ name: 'w', theme: 'dark' }).ok).toBe(true);
  });

  it('rejects invalid theme', () => {
    const r = validateWidgetConfig({ name: 'w', theme: 'rainbow' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHAT_WIDGETS_ERROR_CODES.INVALID_THEME);
  });

  it('rejects invalid primary_color', () => {
    const r = validateWidgetConfig({ name: 'w', primary_color: 'red' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHAT_WIDGETS_ERROR_CODES.INVALID_COLOR);
  });

  it('accepts valid welcome_message', () => {
    expect(validateWidgetConfig({ name: 'w', welcome_message: 'Hi' }).ok).toBe(true);
  });

  it('rejects welcome_message too long', () => {
    const r = validateWidgetConfig({ name: 'w', welcome_message: 'x'.repeat(MAX_WELCOME_LENGTH + 1) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CHAT_WIDGETS_ERROR_CODES.WELCOME_TOO_LONG);
  });

  it('rejects non-string welcome_message', () => {
    const r = validateWidgetConfig({ name: 'w', welcome_message: 123 });
    expect(r.ok).toBe(false);
  });
});

describe('chat-widgets-engine — validateAllowedOrigins', () => {
  it('accepts empty / null', () => {
    expect(validateAllowedOrigins(null).ok).toBe(true);
    expect(validateAllowedOrigins(undefined).ok).toBe(true);
    expect(validateAllowedOrigins([]).ok).toBe(true);
  });

  it('accepts array of valid origins', () => {
    expect(validateAllowedOrigins(['https://intralys.app', 'https://buteau.ca']).ok).toBe(true);
  });

  it('rejects non-array', () => {
    expect(validateAllowedOrigins('https://intralys.app').ok).toBe(false);
  });

  it('rejects too many origins', () => {
    const lots = Array.from({ length: MAX_ALLOWED_ORIGINS + 1 }, (_, i) => `https://x${i}.app`);
    expect(validateAllowedOrigins(lots).ok).toBe(false);
  });

  it('rejects empty/oversized entries', () => {
    expect(validateAllowedOrigins(['']).ok).toBe(false);
    expect(validateAllowedOrigins(['x'.repeat(501)]).ok).toBe(false);
  });

  it('rejects non-string entries', () => {
    expect(validateAllowedOrigins([123]).ok).toBe(false);
  });
});

describe('chat-widgets-engine — validateBusinessHours', () => {
  it('accepts null/undefined (always-open)', () => {
    expect(validateBusinessHours(null).ok).toBe(true);
    expect(validateBusinessHours(undefined).ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateBusinessHours('mon-fri 9-5').ok).toBe(false);
    expect(validateBusinessHours([]).ok).toBe(false);
  });

  it('accepts valid weekly schedule', () => {
    const r = validateBusinessHours({
      monday: { open: '09:00', close: '17:00' },
      saturday: null, // closed
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown weekday', () => {
    const r = validateBusinessHours({ funday: { open: '09:00', close: '17:00' } });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid HH:MM', () => {
    expect(validateBusinessHours({ monday: { open: '9:00', close: '17:00' } }).ok).toBe(false);
    expect(validateBusinessHours({ monday: { open: '25:00', close: '17:00' } }).ok).toBe(false);
  });

  it('rejects open >= close', () => {
    expect(validateBusinessHours({ monday: { open: '17:00', close: '09:00' } }).ok).toBe(false);
    expect(validateBusinessHours({ monday: { open: '09:00', close: '09:00' } }).ok).toBe(false);
  });
});

describe('chat-widgets-engine — generateEmbedSnippet', () => {
  it('generates V1 snippet inline script', () => {
    const s = generateEmbedSnippet({ clientId: 'tenantA', widgetId: 'wid1' });
    expect(s).toContain('Intralys Chat Widget v1');
    expect(s).toContain('clientId: "tenantA"');
    expect(s).toContain('widgetId: "wid1"');
    expect(s).toContain('https://chat.intralys.app/widget/v1/embed.js');
  });

  it('generates V2 snippet ESM loader', () => {
    const s = generateEmbedSnippet({ clientId: 'tenantA', widgetId: 'wid1', useV2: true });
    expect(s).toContain('Intralys Chat Widget v2');
    expect(s).toContain('type="module"');
    expect(s).toContain('data-client-id="tenantA"');
    expect(s).toContain('data-widget-id="wid1"');
  });

  it('respects custom origin', () => {
    const s = generateEmbedSnippet({ clientId: 'a', widgetId: 'b', origin: 'https://staging.intralys.app' });
    expect(s).toContain('https://staging.intralys.app');
  });

  it('strips dangerous chars from origin payload', () => {
    // Goal: the user-controlled `origin` string must not be allowed to smuggle
    // `<`, `>`, `"`, or `'` into the snippet. The snippet itself contains
    // legitimate quotes/angle brackets, so we verify the *origin payload*
    // appears with dangerous chars removed.
    const s = generateEmbedSnippet({
      clientId: 'a',
      widgetId: 'b',
      origin: 'https://example.com"<evil>',
    });
    expect(s).not.toContain('<evil>');
    expect(s).toContain('https://example.comevil');
  });

  it('throws on invalid clientId', () => {
    expect(() => generateEmbedSnippet({ clientId: 'bad/id', widgetId: 'b' })).toThrow();
    expect(() => generateEmbedSnippet({ clientId: '', widgetId: 'b' })).toThrow();
  });

  it('throws on invalid widgetId', () => {
    expect(() => generateEmbedSnippet({ clientId: 'a', widgetId: 'bad id' })).toThrow();
    expect(() => generateEmbedSnippet({ clientId: 'a', widgetId: 'x'.repeat(65) })).toThrow();
  });
});
