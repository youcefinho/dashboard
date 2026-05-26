// ── messaging-engine.test.ts — Tests RENFORCEMENT messaging-engine.ts ────────
//
// Couvre les helpers PURS extraits de messages.ts : sanitization XSS, cap
// body par canal, validation channel/direction, validation attachments
// (count / size / mime whitelist).
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  MESSAGE_ERROR_CODES,
  MESSAGE_VALID_CHANNELS,
  MESSAGE_VALID_DIRECTIONS,
  MESSAGE_BODY_MAX_LEN,
  MESSAGE_SMS_BODY_MAX_LEN,
  MESSAGE_SUBJECT_MAX_LEN,
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_ALLOWED_MIME,
  isValidChannel,
  isValidDirection,
  sanitizeBody,
  validateMessageInput,
  validateAttachments,
  computeMessageBodyCapForChannel,
} from '../lib/messaging-engine';

describe('messaging-engine — constants & guards', () => {
  it('exposes all 10 valid channels', () => {
    expect(MESSAGE_VALID_CHANNELS).toContain('email');
    expect(MESSAGE_VALID_CHANNELS).toContain('sms');
    expect(MESSAGE_VALID_CHANNELS).toContain('whatsapp');
    expect(MESSAGE_VALID_CHANNELS).toContain('chat');
    expect(MESSAGE_VALID_CHANNELS).toContain('webchat');
    expect(MESSAGE_VALID_CHANNELS).toContain('internal_note');
    expect(MESSAGE_VALID_CHANNELS).toContain('facebook');
    expect(MESSAGE_VALID_CHANNELS).toContain('instagram');
  });

  it('exposes 2 valid directions', () => {
    expect(MESSAGE_VALID_DIRECTIONS).toEqual(['inbound', 'outbound']);
  });

  it('isValidChannel rejects unknown', () => {
    expect(isValidChannel('email')).toBe(true);
    expect(isValidChannel('fax')).toBe(false);
    expect(isValidChannel('')).toBe(false);
    expect(isValidChannel(null)).toBe(false);
  });

  it('isValidDirection rejects unknown', () => {
    expect(isValidDirection('inbound')).toBe(true);
    expect(isValidDirection('outbound')).toBe(true);
    expect(isValidDirection('both')).toBe(false);
  });

  it('caps are exposed', () => {
    expect(MESSAGE_BODY_MAX_LEN).toBe(10000);
    expect(MESSAGE_SMS_BODY_MAX_LEN).toBe(1600);
    expect(MESSAGE_SUBJECT_MAX_LEN).toBe(500);
    expect(ATTACHMENT_MAX_SIZE_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_MAX_COUNT).toBe(10);
  });

  it('ATTACHMENT_ALLOWED_MIME whitelists common images + PDF', () => {
    expect(ATTACHMENT_ALLOWED_MIME).toContain('image/png');
    expect(ATTACHMENT_ALLOWED_MIME).toContain('image/jpeg');
    expect(ATTACHMENT_ALLOWED_MIME).toContain('application/pdf');
    expect(ATTACHMENT_ALLOWED_MIME).not.toContain('application/x-msdownload');
    expect(ATTACHMENT_ALLOWED_MIME).not.toContain('application/x-sh');
  });
});

describe('messaging-engine — sanitizeBody (XSS strip)', () => {
  it('returns empty on non-string', () => {
    expect(sanitizeBody(null)).toBe('');
    expect(sanitizeBody(undefined)).toBe('');
    expect(sanitizeBody(42)).toBe('');
  });

  it('strips <script> blocks', () => {
    const dirty = 'hello<script>alert(1)</script>world';
    expect(sanitizeBody(dirty)).toBe('helloworld');
  });

  it('strips multiline <script>', () => {
    const dirty = 'hi<script>\nlet x=1;\nalert(x);\n</script>bye';
    expect(sanitizeBody(dirty)).toBe('hibye');
  });

  it('strips <iframe>', () => {
    const dirty = 'before<iframe src="evil"></iframe>after';
    expect(sanitizeBody(dirty)).toBe('beforeafter');
  });

  it('strips <object> and <embed>', () => {
    expect(sanitizeBody('<object data="x"></object>OK')).toBe('OK');
    expect(sanitizeBody('OK<embed src="y" />')).toBe('OK');
  });

  it('strips <style> blocks', () => {
    expect(sanitizeBody('<style>body{}</style>visible')).toBe('visible');
  });

  it('strips event handlers (onclick=)', () => {
    const dirty = '<a href="x" onclick="evil()">link</a>';
    const out = sanitizeBody(dirty);
    expect(out).not.toContain('onclick');
  });

  it('strips event handlers (onerror=)', () => {
    expect(sanitizeBody('<img src="x" onerror=alert(1)>')).not.toContain(
      'onerror',
    );
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeBody('<a href="javascript:alert(1)">x</a>')).not.toContain(
      'javascript:',
    );
  });

  it('strips data:text/html', () => {
    expect(sanitizeBody('<a href="data:text/html,foo">x</a>')).not.toContain(
      'data:text/html',
    );
  });

  it('preserves safe HTML', () => {
    expect(sanitizeBody('<b>bold</b><i>italic</i>')).toBe(
      '<b>bold</b><i>italic</i>',
    );
  });
});

describe('messaging-engine — computeMessageBodyCapForChannel', () => {
  it('returns SMS cap for sms', () => {
    expect(computeMessageBodyCapForChannel('sms')).toBe(1600);
  });

  it('returns SMS cap for whatsapp', () => {
    expect(computeMessageBodyCapForChannel('whatsapp')).toBe(1600);
  });

  it('returns generic cap for email/chat/note', () => {
    expect(computeMessageBodyCapForChannel('email')).toBe(10000);
    expect(computeMessageBodyCapForChannel('chat')).toBe(10000);
    expect(computeMessageBodyCapForChannel('internal_note')).toBe(10000);
  });
});

describe('messaging-engine — validateMessageInput', () => {
  it('accepts minimal valid input', () => {
    const r = validateMessageInput({ channel: 'email', body: 'Hello' });
    expect(r.ok).toBe(true);
    expect(r.channel).toBe('email');
    expect(r.body).toBe('Hello');
    expect(r.direction).toBe('outbound');
  });

  it('rejects unknown channel', () => {
    const r = validateMessageInput({ channel: 'fax', body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.INVALID_CHANNEL);
  });

  it('rejects non-string body', () => {
    const r = validateMessageInput({ channel: 'email', body: 42 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.INVALID_BODY);
  });

  it('rejects empty body after sanitize', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: '<script>alert(1)</script>',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.EMPTY_BODY);
  });

  it('rejects body > cap for SMS', () => {
    const r = validateMessageInput({
      channel: 'sms',
      body: 'a'.repeat(2000),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.BODY_TOO_LONG);
  });

  it('accepts SMS body just under cap', () => {
    const r = validateMessageInput({
      channel: 'sms',
      body: 'a'.repeat(1600),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects body > cap for email', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: 'a'.repeat(11000),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.BODY_TOO_LONG);
  });

  it('accepts optional subject', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: 'hi',
      subject: 'Subject',
    });
    expect(r.ok).toBe(true);
    expect(r.subject).toBe('Subject');
  });

  it('rejects subject too long', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: 'hi',
      subject: 'a'.repeat(600),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.SUBJECT_TOO_LONG);
  });

  it('rejects non-string subject', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: 'hi',
      subject: 42,
    });
    expect(r.ok).toBe(false);
  });

  it('accepts inbound direction', () => {
    const r = validateMessageInput({
      channel: 'sms',
      body: 'hi',
      direction: 'inbound',
    });
    expect(r.ok).toBe(true);
    expect(r.direction).toBe('inbound');
  });

  it('rejects unknown direction', () => {
    const r = validateMessageInput({
      channel: 'sms',
      body: 'hi',
      direction: 'both',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.INVALID_DIRECTION);
  });

  it('sanitizes XSS in body before storing', () => {
    const r = validateMessageInput({
      channel: 'email',
      body: 'hi<script>evil()</script>there',
    });
    expect(r.ok).toBe(true);
    expect(r.body).toBe('hithere');
  });
});

describe('messaging-engine — validateAttachments', () => {
  it('accepts undefined / null (no attachments)', () => {
    expect(validateAttachments(undefined).ok).toBe(true);
    expect(validateAttachments(null).ok).toBe(true);
  });

  it('accepts empty array', () => {
    expect(validateAttachments([]).ok).toBe(true);
    expect(validateAttachments([]).count).toBe(0);
  });

  it('rejects non-array', () => {
    expect(validateAttachments('not-array').ok).toBe(false);
    expect(validateAttachments({}).ok).toBe(false);
  });

  it('accepts valid PNG attachment', () => {
    const r = validateAttachments([
      { mime: 'image/png', size: 1024, filename: 'logo.png' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  it('rejects too many attachments (> 10)', () => {
    const many = Array.from({ length: 11 }, () => ({
      mime: 'image/png',
      size: 100,
    }));
    const r = validateAttachments(many);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.TOO_MANY_ATTACHMENTS);
  });

  it('accepts exactly 10 attachments', () => {
    const ten = Array.from({ length: 10 }, () => ({
      mime: 'image/png',
      size: 100,
    }));
    expect(validateAttachments(ten).ok).toBe(true);
  });

  it('rejects missing mime', () => {
    const r = validateAttachments([{ size: 1024 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.INVALID_ATTACHMENT);
  });

  it('rejects non-whitelisted mime (.exe)', () => {
    const r = validateAttachments([
      { mime: 'application/x-msdownload', size: 1024 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.UNSUPPORTED_MIME);
  });

  it('rejects size > 10 MB', () => {
    const r = validateAttachments([
      { mime: 'image/png', size: 11 * 1024 * 1024 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(MESSAGE_ERROR_CODES.ATTACHMENT_TOO_LARGE);
  });

  it('accepts size exactly 10 MB', () => {
    const r = validateAttachments([
      { mime: 'image/png', size: 10 * 1024 * 1024 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects size 0 or negative', () => {
    expect(
      validateAttachments([{ mime: 'image/png', size: 0 }]).ok,
    ).toBe(false);
    expect(
      validateAttachments([{ mime: 'image/png', size: -5 }]).ok,
    ).toBe(false);
  });

  it('rejects non-finite size', () => {
    expect(
      validateAttachments([{ mime: 'image/png', size: NaN }]).ok,
    ).toBe(false);
    expect(
      validateAttachments([{ mime: 'image/png', size: Infinity }]).ok,
    ).toBe(false);
  });

  it('rejects non-number size', () => {
    expect(
      validateAttachments([{ mime: 'image/png', size: '1024' }]).ok,
    ).toBe(false);
  });

  it('rejects empty filename if provided', () => {
    expect(
      validateAttachments([
        { mime: 'image/png', size: 100, filename: '   ' },
      ]).ok,
    ).toBe(false);
  });

  it('accepts attachment without filename', () => {
    expect(
      validateAttachments([{ mime: 'image/png', size: 100 }]).ok,
    ).toBe(true);
  });

  it('accepts PDF + JPG + WEBP', () => {
    const r = validateAttachments([
      { mime: 'application/pdf', size: 100 },
      { mime: 'image/jpeg', size: 200 },
      { mime: 'image/webp', size: 300 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
  });

  it('rejects null attachment in array', () => {
    expect(validateAttachments([null]).ok).toBe(false);
  });
});
