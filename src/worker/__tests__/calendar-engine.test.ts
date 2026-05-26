// ════════════════════════════════════════════════════════════
// Sprint 33 — calendar-engine.ts (helpers PURS)
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/calendar-engine.ts` :
//   - ANTI_LOOP_WINDOW_MS + shouldSkipAntiLoop (5s ago → true, 31s → false)
//   - applyLwwResolution (external newer / local newer / égalité)
//   - detectConflict (both > lastSync → conflict ; no prior sync → false)
//   - validateEventPayload (ISO dates, end > start, title empty, attendees cap)
//   - normalizeAttendees (lowercase + dedupe + cap MAX_ATTENDEES + objets emailAddress)
//   - buildIcsEventLine (structure VEVENT + escape RFC5545)
//   - parseIcsRecurrence (FREQ requis + INTERVAL défaut + UNTIL + COUNT + RRULE: prefix)
//   - CALENDAR_ERROR_CODES (codes attendus présents)
//
// Pas de mock D1 / fetch nécessaire : helpers 100 % purs.

import { describe, it, expect } from 'vitest';
import {
  ANTI_LOOP_WINDOW_MS,
  MAX_ATTENDEES,
  CALENDAR_ERROR_CODES,
  shouldSkipAntiLoop,
  applyLwwResolution,
  detectConflict,
  validateEventPayload,
  normalizeAttendees,
  buildIcsEventLine,
  parseIcsRecurrence,
} from '../lib/calendar-engine';

// ════════════════════════════════════════════════════════════
//  shouldSkipAntiLoop
// ════════════════════════════════════════════════════════════

describe('shouldSkipAntiLoop', () => {
  const NOW = 1_700_000_000_000;

  it('returns true when lastSyncedAt is 5s ago (within 30s window)', () => {
    const lastSync = new Date(NOW - 5_000).toISOString();
    expect(shouldSkipAntiLoop(lastSync, NOW)).toBe(true);
  });

  it('returns false when lastSyncedAt is 31s ago (outside window)', () => {
    const lastSync = new Date(NOW - 31_000).toISOString();
    expect(shouldSkipAntiLoop(lastSync, NOW)).toBe(false);
  });

  it('returns false when lastSyncedAt is null', () => {
    expect(shouldSkipAntiLoop(null, NOW)).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(shouldSkipAntiLoop('not-a-date', NOW)).toBe(false);
  });

  it('exposes ANTI_LOOP_WINDOW_MS = 30_000', () => {
    expect(ANTI_LOOP_WINDOW_MS).toBe(30_000);
  });
});

// ════════════════════════════════════════════════════════════
//  applyLwwResolution
// ════════════════════════════════════════════════════════════

describe('applyLwwResolution', () => {
  it("returns winner='external', action='pull' when external is strictly newer", () => {
    const res = applyLwwResolution(
      { updatedAt: '2026-05-26T10:00:00Z' },
      { updatedAt: '2026-05-26T11:00:00Z' },
    );
    expect(res).toEqual({ winner: 'external', action: 'pull' });
  });

  it("returns winner='local', action='push' when local is strictly newer", () => {
    const res = applyLwwResolution(
      { updatedAt: '2026-05-26T12:00:00Z' },
      { updatedAt: '2026-05-26T11:00:00Z' },
    );
    expect(res).toEqual({ winner: 'local', action: 'push' });
  });

  it("returns winner='local', action='noop' on exact equality (CRM = authority)", () => {
    const sameTs = '2026-05-26T10:00:00Z';
    const res = applyLwwResolution({ updatedAt: sameTs }, { updatedAt: sameTs });
    expect(res.winner).toBe('local');
    expect(res.action).toBe('noop');
  });

  it('returns local/push when external updatedAt is missing', () => {
    const res = applyLwwResolution(
      { updatedAt: '2026-05-26T10:00:00Z' },
      { updatedAt: null },
    );
    expect(res).toEqual({ winner: 'local', action: 'push' });
  });
});

// ════════════════════════════════════════════════════════════
//  detectConflict
// ════════════════════════════════════════════════════════════

describe('detectConflict', () => {
  it('detects conflict when both local and external were modified after lastSyncedAt', () => {
    const res = detectConflict({
      localUpdatedAt: '2026-05-26T12:00:00Z',
      externalUpdatedAt: '2026-05-26T12:30:00Z',
      lastSyncedAt: '2026-05-26T10:00:00Z',
    });
    expect(res.conflict).toBe(true);
    expect(res.reason).toBe('both_modified_after_last_sync');
  });

  it('returns no conflict when only local was modified after lastSyncedAt', () => {
    const res = detectConflict({
      localUpdatedAt: '2026-05-26T12:00:00Z',
      externalUpdatedAt: '2026-05-26T09:00:00Z',
      lastSyncedAt: '2026-05-26T10:00:00Z',
    });
    expect(res.conflict).toBe(false);
  });

  it('returns no conflict (no_prior_sync) when lastSyncedAt is null', () => {
    const res = detectConflict({
      localUpdatedAt: '2026-05-26T12:00:00Z',
      externalUpdatedAt: '2026-05-26T13:00:00Z',
      lastSyncedAt: null,
    });
    expect(res.conflict).toBe(false);
    expect(res.reason).toBe('no_prior_sync');
  });
});

// ════════════════════════════════════════════════════════════
//  validateEventPayload
// ════════════════════════════════════════════════════════════

describe('validateEventPayload', () => {
  it('accepts a valid payload', () => {
    const res = validateEventPayload({
      title: 'Meeting',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
    });
    expect(res.ok).toBe(true);
  });

  it('rejects when end < start (INVALID_RANGE)', () => {
    const res = validateEventPayload({
      title: 'Bad',
      start: '2026-05-26T11:00:00Z',
      end: '2026-05-26T10:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(CALENDAR_ERROR_CODES.INVALID_RANGE);
  });

  it('rejects when end === start (INVALID_RANGE — strict >)', () => {
    const ts = '2026-05-26T10:00:00Z';
    const res = validateEventPayload({ title: 'Bad', start: ts, end: ts });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(CALENDAR_ERROR_CODES.INVALID_RANGE);
  });

  it('rejects empty title (MISSING_TITLE)', () => {
    const res = validateEventPayload({
      title: '   ',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(CALENDAR_ERROR_CODES.MISSING_TITLE);
  });

  it('rejects malformed ISO date (INVALID_DATE)', () => {
    const res = validateEventPayload({
      title: 'Meeting',
      start: 'not-an-iso',
      end: '2026-05-26T11:00:00Z',
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(CALENDAR_ERROR_CODES.INVALID_DATE);
  });

  it('rejects when attendees exceeds MAX_ATTENDEES cap', () => {
    const tooMany = Array.from({ length: MAX_ATTENDEES + 1 }, (_, i) => `u${i}@x.com`);
    const res = validateEventPayload({
      title: 'Meeting',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
      attendees: tooMany,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(CALENDAR_ERROR_CODES.INVALID_EVENT);
  });
});

// ════════════════════════════════════════════════════════════
//  normalizeAttendees
// ════════════════════════════════════════════════════════════

describe('normalizeAttendees', () => {
  it('lowercases + dedupes string emails', () => {
    const res = normalizeAttendees(['Alice@Foo.com', 'alice@foo.com', 'BOB@bar.com']);
    expect(res).toEqual(['alice@foo.com', 'bob@bar.com']);
  });

  it('caps at MAX_ATTENDEES', () => {
    const big = Array.from({ length: MAX_ATTENDEES + 25 }, (_, i) => `u${i}@x.com`);
    const res = normalizeAttendees(big);
    expect(res.length).toBe(MAX_ATTENDEES);
  });

  it('accepts objects with .email or .emailAddress.address (Outlook format)', () => {
    const res = normalizeAttendees([
      { email: 'a@x.com' },
      { emailAddress: { address: 'B@x.com' } },
      'c@x.com',
    ]);
    expect(res).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('filters out invalid email strings', () => {
    const res = normalizeAttendees(['not-an-email', '', null, 'ok@x.com']);
    expect(res).toEqual(['ok@x.com']);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeAttendees(null)).toEqual([]);
    expect(normalizeAttendees(undefined)).toEqual([]);
    expect(normalizeAttendees('not-array' as any)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
//  buildIcsEventLine
// ════════════════════════════════════════════════════════════

describe('buildIcsEventLine', () => {
  it('produces a well-formed VEVENT block', () => {
    const ics = buildIcsEventLine({
      uid: 'evt-123',
      title: 'Meeting',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('UID:evt-123');
    expect(ics).toContain('DTSTART:20260526T100000Z');
    expect(ics).toContain('DTEND:20260526T110000Z');
    expect(ics).toContain('SUMMARY:Meeting');
    expect(ics.split('\r\n').length).toBeGreaterThan(4);
  });

  it('escapes commas, semicolons, and newlines per RFC5545', () => {
    const ics = buildIcsEventLine({
      uid: 'evt-1',
      title: 'A, B; C\nD',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
      description: 'has, semis; and\nbreaks',
    });
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD');
    expect(ics).toContain('DESCRIPTION:has\\, semis\\; and\\nbreaks');
  });

  it('includes optional LOCATION + ORGANIZER when provided', () => {
    const ics = buildIcsEventLine({
      uid: 'evt-2',
      title: 'M',
      start: '2026-05-26T10:00:00Z',
      end: '2026-05-26T11:00:00Z',
      location: 'Zoom',
      organizer: 'host@x.com',
    });
    expect(ics).toContain('LOCATION:Zoom');
    expect(ics).toContain('ORGANIZER:mailto:host@x.com');
  });
});

// ════════════════════════════════════════════════════════════
//  parseIcsRecurrence
// ════════════════════════════════════════════════════════════

describe('parseIcsRecurrence', () => {
  it('parses FREQ=DAILY;INTERVAL=2', () => {
    const res = parseIcsRecurrence('FREQ=DAILY;INTERVAL=2');
    expect(res).toEqual({ freq: 'DAILY', interval: 2 });
  });

  it('defaults INTERVAL to 1 when absent', () => {
    const res = parseIcsRecurrence('FREQ=WEEKLY');
    expect(res).toEqual({ freq: 'WEEKLY', interval: 1 });
  });

  it('tolerates RRULE: prefix and parses UNTIL', () => {
    const res = parseIcsRecurrence('RRULE:FREQ=MONTHLY;UNTIL=20260601T000000Z');
    expect(res).toEqual({
      freq: 'MONTHLY',
      interval: 1,
      until: '20260601T000000Z',
    });
  });

  it('parses COUNT', () => {
    const res = parseIcsRecurrence('FREQ=WEEKLY;COUNT=10');
    expect(res).toEqual({ freq: 'WEEKLY', interval: 1, count: 10 });
  });

  it('returns null for unknown FREQ', () => {
    expect(parseIcsRecurrence('FREQ=ZAP;INTERVAL=2')).toBeNull();
  });

  it('returns null for empty / invalid input', () => {
    expect(parseIcsRecurrence('')).toBeNull();
    expect(parseIcsRecurrence('garbage-no-equal')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
//  CALENDAR_ERROR_CODES — codes stables exposés
// ════════════════════════════════════════════════════════════

describe('CALENDAR_ERROR_CODES', () => {
  it('exposes at least 8 stable codes', () => {
    const keys = Object.keys(CALENDAR_ERROR_CODES);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(CALENDAR_ERROR_CODES.TOKEN_INVALID).toBe('token_invalid');
    expect(CALENDAR_ERROR_CODES.CONFLICT).toBe('conflict');
    expect(CALENDAR_ERROR_CODES.INVALID_EVENT).toBe('invalid_event');
    expect(CALENDAR_ERROR_CODES.WEBHOOK_TOKEN_MISMATCH).toBe('webhook_token_mismatch');
  });
});
