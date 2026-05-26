// ── telephony-engine.test.ts — Tests RENFORCEMENT telephony-engine.ts ────────
//
// Couvre les helpers PURS extraits de telephony.ts : E.164 strict, whitelist
// statut Twilio, consent CRTC, parseStatusCallback, TwiML builder, IVR config
// validator.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  TELEPHONY_ERROR_CODES,
  VALID_CALL_STATUSES,
  MISSED_CALL_STATUSES,
  VALID_CALL_DIRECTIONS,
  IVR_MAX_DEPTH,
  IVR_MAX_OPTIONS_PER_MENU,
  IVR_VALID_ACTIONS,
  validatePhoneE164,
  isValidCallStatus,
  isMissedCallStatus,
  validateCrtcConsent,
  escapeXml,
  parseStatusCallback,
  formatTwimlResponse,
  validateIvrConfig,
} from '../lib/telephony-engine';

describe('telephony-engine — constants & guards', () => {
  it('exposes Twilio call status whitelist', () => {
    expect(VALID_CALL_STATUSES).toContain('queued');
    expect(VALID_CALL_STATUSES).toContain('ringing');
    expect(VALID_CALL_STATUSES).toContain('completed');
    expect(VALID_CALL_STATUSES).toContain('failed');
    expect(VALID_CALL_STATUSES).toContain('mock');
  });

  it('exposes missed statuses subset', () => {
    expect(MISSED_CALL_STATUSES).toContain('no-answer');
    expect(MISSED_CALL_STATUSES).toContain('busy');
    expect(MISSED_CALL_STATUSES).toContain('failed');
    expect(MISSED_CALL_STATUSES).toContain('canceled');
  });

  it('exposes 2 directions', () => {
    expect(VALID_CALL_DIRECTIONS).toEqual(['inbound', 'outbound']);
  });

  it('exposes IVR caps', () => {
    expect(IVR_MAX_DEPTH).toBe(3);
    expect(IVR_MAX_OPTIONS_PER_MENU).toBe(10);
    expect(IVR_VALID_ACTIONS).toContain('dial');
    expect(IVR_VALID_ACTIONS).toContain('voicemail');
    expect(IVR_VALID_ACTIONS).toContain('submenu');
  });

  it('exposes stable error codes', () => {
    expect(TELEPHONY_ERROR_CODES.INVALID_PHONE).toBe('invalid_phone');
    expect(TELEPHONY_ERROR_CODES.CONSENT_REQUIRED).toBe('consent_required');
    expect(TELEPHONY_ERROR_CODES.IVR_DEPTH_EXCEEDED).toBe('ivr_depth_exceeded');
  });
});

describe('telephony-engine — validatePhoneE164', () => {
  it('accepts valid E.164 numbers', () => {
    expect(validatePhoneE164('+14165551234')).toBe(true);
    expect(validatePhoneE164('+15145551234')).toBe(true);
    expect(validatePhoneE164('+33123456789')).toBe(true);
    expect(validatePhoneE164('+447911123456')).toBe(true);
  });

  it('rejects missing + prefix', () => {
    expect(validatePhoneE164('14165551234')).toBe(false);
  });

  it('rejects leading 0 after +', () => {
    expect(validatePhoneE164('+04165551234')).toBe(false);
  });

  it('rejects too short / too long', () => {
    expect(validatePhoneE164('+1416')).toBe(false);
    expect(validatePhoneE164('+1234567890123456789')).toBe(false);
  });

  it('rejects spaces / hyphens / parens', () => {
    expect(validatePhoneE164('+1 416 555 1234')).toBe(false);
    expect(validatePhoneE164('+1-416-555-1234')).toBe(false);
    expect(validatePhoneE164('+1(416)5551234')).toBe(false);
  });

  it('rejects non-string / empty', () => {
    expect(validatePhoneE164('')).toBe(false);
    expect(validatePhoneE164(null)).toBe(false);
    expect(validatePhoneE164(undefined)).toBe(false);
    expect(validatePhoneE164(14165551234)).toBe(false);
  });
});

describe('telephony-engine — isValidCallStatus / isMissedCallStatus', () => {
  it('isValidCallStatus accepts whitelist', () => {
    expect(isValidCallStatus('queued')).toBe(true);
    expect(isValidCallStatus('completed')).toBe(true);
    expect(isValidCallStatus('mock')).toBe(true);
  });

  it('isValidCallStatus rejects unknown / casing', () => {
    expect(isValidCallStatus('QUEUED')).toBe(false);
    expect(isValidCallStatus('unknown')).toBe(false);
    expect(isValidCallStatus('')).toBe(false);
    expect(isValidCallStatus(null)).toBe(false);
  });

  it('isMissedCallStatus is subset of valid', () => {
    expect(isMissedCallStatus('no-answer')).toBe(true);
    expect(isMissedCallStatus('busy')).toBe(true);
    expect(isMissedCallStatus('canceled')).toBe(true);
    expect(isMissedCallStatus('completed')).toBe(false);
    expect(isMissedCallStatus('queued')).toBe(false);
  });
});

describe('telephony-engine — validateCrtcConsent', () => {
  it('accepts strict true only', () => {
    expect(validateCrtcConsent(true)).toBe(true);
  });

  it('rejects anything not strictly true (CRTC bi-party)', () => {
    expect(validateCrtcConsent(false)).toBe(false);
    expect(validateCrtcConsent(1)).toBe(false);
    expect(validateCrtcConsent('true')).toBe(false);
    expect(validateCrtcConsent(null)).toBe(false);
    expect(validateCrtcConsent(undefined)).toBe(false);
  });
});

describe('telephony-engine — escapeXml', () => {
  it('escapes 5 XML special chars', () => {
    expect(escapeXml('<a&b>"c\'d')).toBe('&lt;a&amp;b&gt;&quot;c&apos;d');
  });

  it('handles empty / null safely', () => {
    expect(escapeXml('')).toBe('');
    expect(escapeXml(null as unknown as string)).toBe('');
  });
});

describe('telephony-engine — parseStatusCallback', () => {
  it('parses full Twilio body', () => {
    const r = parseStatusCallback({
      CallSid: 'CA12345',
      CallStatus: 'completed',
      From: '+14165551234',
      To: '+15145551234',
      CallDuration: '42',
      RecordingUrl: 'https://api.twilio.com/rec.wav',
      ErrorCode: '',
    });
    expect(r.callSid).toBe('CA12345');
    expect(r.status).toBe('completed');
    expect(r.from).toBe('+14165551234');
    expect(r.duration).toBe(42);
    expect(r.recordingUrl).toBe('https://api.twilio.com/rec.wav');
  });

  it('rejects unknown CallStatus ⇒ null', () => {
    const r = parseStatusCallback({ CallSid: 'CA1', CallStatus: 'weird_status' });
    expect(r.status).toBeNull();
  });

  it('returns null fields on missing body', () => {
    const r = parseStatusCallback(null);
    expect(r.callSid).toBeNull();
    expect(r.status).toBeNull();
    expect(r.duration).toBeNull();
  });

  it('handles NaN duration ⇒ null', () => {
    const r = parseStatusCallback({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: 'abc' });
    expect(r.duration).toBeNull();
  });

  it('captures errorCode when present', () => {
    const r = parseStatusCallback({ CallSid: 'CA1', CallStatus: 'failed', ErrorCode: '13201' });
    expect(r.errorCode).toBe('13201');
  });
});

describe('telephony-engine — formatTwimlResponse', () => {
  it('builds Say only', () => {
    const xml = formatTwimlResponse({ say: 'Bonjour' });
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Say language="fr-CA">Bonjour</Say>');
  });

  it('escapes user content in Say', () => {
    const xml = formatTwimlResponse({ say: '<script>alert(1)</script>' });
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>');
  });

  it('builds Gather with prompt', () => {
    const xml = formatTwimlResponse({
      gather: { numDigits: 1, action: '/api/voice/ivr/abc', prompt: 'Tapez 1' },
    });
    expect(xml).toContain('<Gather numDigits="1"');
    expect(xml).toContain('action="/api/voice/ivr/abc"');
    expect(xml).toContain('<Say language="fr-CA">Tapez 1</Say>');
  });

  it('builds Dial with escaped number', () => {
    const xml = formatTwimlResponse({ dial: '+14165551234' });
    expect(xml).toContain('<Dial>+14165551234</Dial>');
  });

  it('builds Record + Hangup combined', () => {
    const xml = formatTwimlResponse({
      record: { action: '/cb', maxLength: 120, playBeep: true },
      hangup: true,
    });
    expect(xml).toContain('<Record action="/cb"');
    expect(xml).toContain('maxLength="120"');
    expect(xml).toContain('playBeep="true"');
    expect(xml).toContain('<Hangup />');
  });

  it('falls back to Hangup on empty parts', () => {
    const xml = formatTwimlResponse({});
    expect(xml).toContain('<Hangup />');
  });

  it('clamps numDigits to 1..10', () => {
    const xml = formatTwimlResponse({ gather: { numDigits: 0 } });
    expect(xml).toContain('numDigits="1"');
    const xml2 = formatTwimlResponse({ gather: { numDigits: 99 } });
    expect(xml2).toContain('numDigits="10"');
  });
});

describe('telephony-engine — validateIvrConfig', () => {
  it('accepts valid simple menu', () => {
    const r = validateIvrConfig({
      greeting: 'Bonjour',
      options: [
        { digit: '1', action: 'dial', target: '+14165551234' },
        { digit: '2', action: 'voicemail' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateIvrConfig('nope').ok).toBe(false);
    expect(validateIvrConfig([]).ok).toBe(false);
    expect(validateIvrConfig(null).ok).toBe(false);
  });

  it('rejects greeting too long', () => {
    const r = validateIvrConfig({ greeting: 'x'.repeat(501) });
    expect(r.ok).toBe(false);
  });

  it('rejects too many options', () => {
    const r = validateIvrConfig({
      options: Array.from({ length: 11 }, (_, i) => ({
        digit: String(i),
        action: 'voicemail',
      })),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid digit', () => {
    const r = validateIvrConfig({
      options: [{ digit: 'A', action: 'voicemail' }],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(TELEPHONY_ERROR_CODES.IVR_OPTION_INVALID);
  });

  it('rejects duplicate digit', () => {
    const r = validateIvrConfig({
      options: [
        { digit: '1', action: 'voicemail' },
        { digit: '1', action: 'voicemail' },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown action', () => {
    const r = validateIvrConfig({
      options: [{ digit: '1', action: 'transfer-to-mars' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects dial without target', () => {
    const r = validateIvrConfig({
      options: [{ digit: '1', action: 'dial' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects submenu beyond max depth', () => {
    const deep = (depth: number): unknown => {
      if (depth === 0) return { greeting: 'leaf', options: [{ digit: '1', action: 'voicemail' }] };
      return { greeting: `lvl ${depth}`, options: [{ digit: '1', action: 'submenu', submenu: deep(depth - 1) }] };
    };
    const ok = validateIvrConfig(deep(2)); // total depth 3 = IVR_MAX_DEPTH
    expect(ok.ok).toBe(true);
    const bad = validateIvrConfig(deep(3)); // depth 4
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe(TELEPHONY_ERROR_CODES.IVR_DEPTH_EXCEEDED);
  });

  it('accepts hangup action without target', () => {
    const r = validateIvrConfig({ options: [{ digit: '9', action: 'hangup' }] });
    expect(r.ok).toBe(true);
  });

  it('accepts *, # digits', () => {
    const r = validateIvrConfig({
      options: [
        { digit: '*', action: 'voicemail' },
        { digit: '#', action: 'hangup' },
      ],
    });
    expect(r.ok).toBe(true);
  });
});
