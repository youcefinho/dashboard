// ── conversation-engine.test.ts — Tests RENFORCEMENT conversation-engine.ts ──
//
// Couvre les helpers PURS extraits de conversations.ts : validation
// statut + transition, snooze (futur + cap 1 an), unread count, pagination
// cursor (parse + next), thread key, preview clamp.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_ERROR_CODES,
  CONVERSATION_VALID_STATUSES,
  CONVERSATION_VALID_CHANNELS,
  CONVERSATION_PAGINATION_MAX,
  CONVERSATION_PAGINATION_DEFAULT,
  CONVERSATION_PREVIEW_MAX_LEN,
  isValidStatus,
  isValidChannel,
  validateThreadStatus,
  validateSnoozeUntil,
  computeUnreadCount,
  getNextCursor,
  parseCursor,
  clampLimit,
  computeThreadKey,
  clampPreview,
} from '../lib/conversation-engine';

describe('conversation-engine — constants & guards', () => {
  it('exposes 3 valid statuses (open/closed/snoozed)', () => {
    expect(CONVERSATION_VALID_STATUSES).toEqual([
      'open',
      'closed',
      'snoozed',
    ]);
  });

  it('exposes the 9 valid channels', () => {
    expect(CONVERSATION_VALID_CHANNELS).toContain('email');
    expect(CONVERSATION_VALID_CHANNELS).toContain('sms');
    expect(CONVERSATION_VALID_CHANNELS).toContain('webchat');
    expect(CONVERSATION_VALID_CHANNELS).toContain('whatsapp');
    expect(CONVERSATION_VALID_CHANNELS).toContain('internal_note');
  });

  it('isValidStatus rejects unknown statuses', () => {
    expect(isValidStatus('open')).toBe(true);
    expect(isValidStatus('foo')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(42)).toBe(false);
  });

  it('isValidChannel rejects unknown channels', () => {
    expect(isValidChannel('email')).toBe(true);
    expect(isValidChannel('phone')).toBe(false);
    expect(isValidChannel('')).toBe(false);
  });

  it('caps are exposed', () => {
    expect(CONVERSATION_PAGINATION_MAX).toBe(200);
    expect(CONVERSATION_PAGINATION_DEFAULT).toBe(50);
    expect(CONVERSATION_PREVIEW_MAX_LEN).toBe(120);
  });
});

describe('conversation-engine — validateThreadStatus', () => {
  it('accepts valid target without current', () => {
    expect(validateThreadStatus('open').ok).toBe(true);
    expect(validateThreadStatus('closed').ok).toBe(true);
    expect(validateThreadStatus('snoozed').ok).toBe(true);
  });

  it('rejects unknown status', () => {
    const r = validateThreadStatus('archived');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_STATUS);
  });

  it('rejects transition closed → snoozed', () => {
    const r = validateThreadStatus('snoozed', 'closed');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_TRANSITION);
  });

  it('allows closed → open (reopen)', () => {
    expect(validateThreadStatus('open', 'closed').ok).toBe(true);
  });

  it('allows open → closed and open → snoozed', () => {
    expect(validateThreadStatus('closed', 'open').ok).toBe(true);
    expect(validateThreadStatus('snoozed', 'open').ok).toBe(true);
  });

  it('rejects when current invalid', () => {
    const r = validateThreadStatus('open', 'foo');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_STATUS);
  });
});

describe('conversation-engine — validateSnoozeUntil', () => {
  const now = Date.parse('2026-01-15T10:00:00Z');

  it('accepts future ISO date', () => {
    expect(
      validateSnoozeUntil('2026-01-16T10:00:00Z', now).ok,
    ).toBe(true);
  });

  it('rejects non-string', () => {
    expect(validateSnoozeUntil(null, now).ok).toBe(false);
    expect(validateSnoozeUntil(42, now).ok).toBe(false);
  });

  it('rejects unparseable date', () => {
    const r = validateSnoozeUntil('not-a-date', now);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_SNOOZE);
  });

  it('rejects past date', () => {
    expect(
      validateSnoozeUntil('2025-01-01T00:00:00Z', now).ok,
    ).toBe(false);
  });

  it('rejects equal to now', () => {
    expect(validateSnoozeUntil('2026-01-15T10:00:00Z', now).ok).toBe(
      false,
    );
  });

  it('rejects > 1 year future', () => {
    expect(
      validateSnoozeUntil('2030-01-15T10:00:00Z', now).ok,
    ).toBe(false);
  });
});

describe('conversation-engine — computeUnreadCount', () => {
  it('returns 0 on empty array', () => {
    expect(computeUnreadCount([])).toBe(0);
  });

  it('counts inbound after lastReadAt', () => {
    const msgs = [
      { direction: 'inbound', created_at: '2026-01-10T10:00:00Z' },
      { direction: 'inbound', created_at: '2026-01-10T11:00:00Z' },
      { direction: 'outbound', created_at: '2026-01-10T12:00:00Z' },
    ];
    expect(computeUnreadCount(msgs, '2026-01-10T09:00:00Z')).toBe(2);
  });

  it('ignores outbound messages', () => {
    const msgs = [
      { direction: 'outbound', created_at: '2026-01-10T11:00:00Z' },
      { direction: 'outbound', created_at: '2026-01-10T12:00:00Z' },
    ];
    expect(computeUnreadCount(msgs, '2026-01-10T09:00:00Z')).toBe(0);
  });

  it('counts all inbound when no lastReadAt', () => {
    const msgs = [
      { direction: 'inbound', created_at: '2026-01-10T10:00:00Z' },
      { direction: 'inbound', created_at: '2026-01-10T11:00:00Z' },
    ];
    expect(computeUnreadCount(msgs)).toBe(2);
  });

  it('skips messages with unparseable created_at', () => {
    const msgs = [
      { direction: 'inbound', created_at: 'invalid' },
      { direction: 'inbound', created_at: '2026-01-10T11:00:00Z' },
    ];
    expect(computeUnreadCount(msgs, '2026-01-10T09:00:00Z')).toBe(1);
  });
});

describe('conversation-engine — pagination cursor', () => {
  it('getNextCursor returns undefined on empty batch', () => {
    expect(getNextCursor([], 50).cursor).toBeUndefined();
  });

  it('getNextCursor returns undefined when batch < limit (end)', () => {
    const batch = [{ created_at: '2026-01-01T10:00:00Z' }];
    expect(getNextCursor(batch, 50).cursor).toBeUndefined();
  });

  it('getNextCursor returns last created_at when full page', () => {
    const batch = [
      { created_at: '2026-01-01T12:00:00Z' },
      { created_at: '2026-01-01T11:00:00Z' },
      { created_at: '2026-01-01T10:00:00Z' },
    ];
    expect(getNextCursor(batch, 3).cursor).toBe(
      '2026-01-01T10:00:00Z',
    );
  });

  it('parseCursor accepts empty input (= start)', () => {
    expect(parseCursor('').ok).toBe(true);
    expect(parseCursor(null).ok).toBe(true);
    expect(parseCursor(undefined).ok).toBe(true);
  });

  it('parseCursor accepts valid ISO', () => {
    const r = parseCursor('2026-01-01T10:00:00Z');
    expect(r.ok).toBe(true);
    expect(r.cursor).toBe('2026-01-01T10:00:00Z');
  });

  it('parseCursor rejects unparseable', () => {
    const r = parseCursor('xxx');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_CURSOR);
  });

  it('parseCursor rejects non-string', () => {
    const r = parseCursor(42);
    expect(r.ok).toBe(false);
  });
});

describe('conversation-engine — clampLimit', () => {
  it('defaults to 50 on missing input', () => {
    expect(clampLimit(undefined).limit).toBe(50);
    expect(clampLimit('').limit).toBe(50);
  });

  it('caps to 200', () => {
    expect(clampLimit(500).limit).toBe(200);
    expect(clampLimit('300').limit).toBe(200);
  });

  it('rejects zero and negative', () => {
    expect(clampLimit(0).ok).toBe(false);
    expect(clampLimit(-5).ok).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(clampLimit('abc').ok).toBe(false);
  });

  it('floors decimals', () => {
    expect(clampLimit(25.7).limit).toBe(25);
  });
});

describe('conversation-engine — computeThreadKey', () => {
  it('produces canonical lead|channel key', () => {
    const r = computeThreadKey('lead-123', 'email');
    expect(r.ok).toBe(true);
    expect(r.key).toBe('lead-123|email');
  });

  it('rejects empty lead id', () => {
    expect(computeThreadKey('', 'email').ok).toBe(false);
    expect(computeThreadKey('   ', 'email').ok).toBe(false);
  });

  it('rejects invalid channel', () => {
    const r = computeThreadKey('lead-123', 'fax');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(CONVERSATION_ERROR_CODES.INVALID_CHANNEL);
  });

  it('lowercases channel in key', () => {
    // 'email' is already lowercase — verify trim path
    const r = computeThreadKey('  lead-123  ', 'email');
    expect(r.key).toBe('lead-123|email');
  });
});

describe('conversation-engine — clampPreview', () => {
  it('returns empty string on non-string', () => {
    expect(clampPreview(null)).toBe('');
    expect(clampPreview(undefined)).toBe('');
    expect(clampPreview(42)).toBe('');
  });

  it('truncates to maxLen', () => {
    const long = 'a'.repeat(500);
    expect(clampPreview(long).length).toBe(120);
  });

  it('collapses newlines and whitespace', () => {
    expect(clampPreview('hello\n\nworld\t\ttest')).toBe(
      'hello world test',
    );
  });

  it('trims output', () => {
    expect(clampPreview('   hi   ')).toBe('hi');
  });

  it('respects custom maxLen', () => {
    expect(clampPreview('abcdefg', 3)).toBe('abc');
  });
});
