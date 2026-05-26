// ════════════════════════════════════════════════════════════════════════════
// Sprint P0-2 — booking-engine.ts (helpers PURS)
// ════════════════════════════════════════════════════════════════════════════
//
// Couvre `src/worker/lib/booking-engine.ts` :
//   - validateSlot (start<end, durée bornes 15..480min)
//   - slotsOverlap (touching, partial, identical, disjoint)
//   - parseTimeRange ('09:00-17:00', formats invalides, close<=open)
//   - isWithinBusinessHours (jour ouvert/fermé, plage open/close)
//   - isCancellable (status, fenêtre 24h, RDV passé)
//   - computeReminderSchedule (offsets, ordre, dedup, cap)
//   - applyTimezoneOffset (offsets fixes, Z/UTC, invalides)
//   - validateBookingInput (honeypot, email, phone, name, start_time)
//   - hashBookingToken (déterministe, length, empty)
//   - BOOKING_ERROR_CODES (codes attendus présents)
//
// Helpers 100 % PURS → pas de mock D1 / fetch nécessaire.

import { describe, it, expect } from 'vitest';
import {
  MIN_SLOT_DURATION_MIN,
  MAX_SLOT_DURATION_MIN,
  DEFAULT_CANCEL_WINDOW_HOURS,
  BOOKING_ERROR_CODES,
  validateSlot,
  slotsOverlap,
  parseTimeRange,
  isWithinBusinessHours,
  isCancellable,
  computeReminderSchedule,
  applyTimezoneOffset,
  validateBookingInput,
  hashBookingToken,
} from '../lib/booking-engine';

const ISO = (s: string) => s; // helper lisibilité

// ════════════════════════════════════════════════════════════════════════════
//  BOOKING_ERROR_CODES
// ════════════════════════════════════════════════════════════════════════════

describe('BOOKING_ERROR_CODES', () => {
  it('exposes the canonical 10+ error codes referenced by handlers', () => {
    expect(BOOKING_ERROR_CODES.SLOT_INVALID).toBe('SLOT_INVALID');
    expect(BOOKING_ERROR_CODES.SLOT_CONFLICT).toBe('SLOT_CONFLICT');
    expect(BOOKING_ERROR_CODES.OUTSIDE_HOURS).toBe('OUTSIDE_HOURS');
    expect(BOOKING_ERROR_CODES.BOOKING_NOT_FOUND).toBe('BOOKING_NOT_FOUND');
    expect(BOOKING_ERROR_CODES.ALREADY_CANCELLED).toBe('ALREADY_CANCELLED');
    expect(BOOKING_ERROR_CODES.BOOKING_EXPIRED).toBe('BOOKING_EXPIRED');
    expect(BOOKING_ERROR_CODES.CANCEL_WINDOW_PASSED).toBe('CANCEL_WINDOW_PASSED');
    expect(BOOKING_ERROR_CODES.HONEYPOT_TRIPPED).toBe('HONEYPOT_TRIPPED');
    expect(BOOKING_ERROR_CODES.EMAIL_INVALID).toBe('EMAIL_INVALID');
    expect(BOOKING_ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
  });

  it('exposes MIN/MAX/DEFAULT constants', () => {
    expect(MIN_SLOT_DURATION_MIN).toBe(15);
    expect(MAX_SLOT_DURATION_MIN).toBe(480);
    expect(DEFAULT_CANCEL_WINDOW_HOURS).toBe(24);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  validateSlot
// ════════════════════════════════════════════════════════════════════════════

describe('validateSlot', () => {
  it('rejects start == end (zero-duration)', () => {
    const t = '2026-06-01T10:00:00.000Z';
    const r = validateSlot({ startAt: t, endAt: t });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_INVALID);
  });

  it('rejects end < start (inverted)', () => {
    const r = validateSlot({
      startAt: '2026-06-01T11:00:00.000Z',
      endAt: '2026-06-01T10:00:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_INVALID);
  });

  it('rejects 5min slot (below MIN 15min)', () => {
    const r = validateSlot({
      startAt: '2026-06-01T10:00:00.000Z',
      endAt: '2026-06-01T10:05:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_TOO_SHORT);
  });

  it('rejects slot just above MAX (8h + 1min)', () => {
    const start = Date.UTC(2026, 5, 1, 9, 0, 0);
    const end = start + (480 + 1) * 60_000;
    const r = validateSlot({ startAt: start, endAt: end });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_TOO_LONG);
  });

  it('accepts 30min slot (typical)', () => {
    const r = validateSlot({
      startAt: '2026-06-01T10:00:00.000Z',
      endAt: '2026-06-01T10:30:00.000Z',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts exact MIN duration (15min)', () => {
    const r = validateSlot({
      startAt: '2026-06-01T10:00:00.000Z',
      endAt: '2026-06-01T10:15:00.000Z',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts exact MAX duration (8h)', () => {
    const start = Date.UTC(2026, 5, 1, 9, 0, 0);
    const end = start + 480 * 60_000;
    const r = validateSlot({ startAt: start, endAt: end });
    expect(r.ok).toBe(true);
  });

  it('rejects unparseable ISO strings', () => {
    const r = validateSlot({ startAt: 'not-a-date', endAt: '2026-06-01T10:00:00.000Z' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_INVALID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  slotsOverlap
// ════════════════════════════════════════════════════════════════════════════

describe('slotsOverlap', () => {
  it('detects same-start collision', () => {
    expect(slotsOverlap(
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:30:00.000Z') },
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:15:00.000Z') },
    )).toBe(true);
  });

  it('does NOT overlap when touching (a.end == b.start)', () => {
    expect(slotsOverlap(
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:30:00.000Z') },
      { startAt: ISO('2026-06-01T10:30:00.000Z'), endAt: ISO('2026-06-01T11:00:00.000Z') },
    )).toBe(false);
  });

  it('detects partial overlap', () => {
    expect(slotsOverlap(
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:45:00.000Z') },
      { startAt: ISO('2026-06-01T10:30:00.000Z'), endAt: ISO('2026-06-01T11:00:00.000Z') },
    )).toBe(true);
  });

  it('returns false for disjoint slots', () => {
    expect(slotsOverlap(
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:30:00.000Z') },
      { startAt: ISO('2026-06-01T11:00:00.000Z'), endAt: ISO('2026-06-01T11:30:00.000Z') },
    )).toBe(false);
  });

  it('detects fully-contained overlap', () => {
    expect(slotsOverlap(
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T12:00:00.000Z') },
      { startAt: ISO('2026-06-01T10:30:00.000Z'), endAt: ISO('2026-06-01T11:00:00.000Z') },
    )).toBe(true);
  });

  it('returns false when either slot is unparseable', () => {
    expect(slotsOverlap(
      { startAt: 'bad', endAt: 'also-bad' },
      { startAt: ISO('2026-06-01T10:00:00.000Z'), endAt: ISO('2026-06-01T10:30:00.000Z') },
    )).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  parseTimeRange
// ════════════════════════════════════════════════════════════════════════════

describe('parseTimeRange', () => {
  it('parses "09:00-17:00" → { open: 540, close: 1020 }', () => {
    expect(parseTimeRange('09:00-17:00')).toEqual({ open: 540, close: 1020 });
  });

  it('parses "00:00-23:59"', () => {
    expect(parseTimeRange('00:00-23:59')).toEqual({ open: 0, close: 23 * 60 + 59 });
  });

  it('rejects loose format "9-17" (no HH:MM)', () => {
    expect(parseTimeRange('9-17')).toBeNull();
  });

  it('rejects out-of-range hours "25:00-26:00"', () => {
    expect(parseTimeRange('25:00-26:00')).toBeNull();
  });

  it('rejects close <= open ("17:00-09:00", "10:00-10:00")', () => {
    expect(parseTimeRange('17:00-09:00')).toBeNull();
    expect(parseTimeRange('10:00-10:00')).toBeNull();
  });

  it('rejects non-string inputs', () => {
    expect(parseTimeRange(null as unknown as string)).toBeNull();
    expect(parseTimeRange(123 as unknown as string)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  isWithinBusinessHours
// ════════════════════════════════════════════════════════════════════════════

describe('isWithinBusinessHours', () => {
  // 2026-06-02 = Tuesday (UTC). 2026-06-07 = Sunday (UTC).
  const tueWorkdays: Record<string, string> = {
    mon: '09:00-17:00',
    tue: '09:00-17:00',
    wed: '09:00-17:00',
    thu: '09:00-17:00',
    fri: '09:00-17:00',
  };

  it('accepts Tuesday 10:00-10:30 inside {tue: 09:00-17:00}', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T10:00:00.000Z', endAt: '2026-06-02T10:30:00.000Z' },
      tueWorkdays,
    )).toBe(true);
  });

  it('rejects Sunday 10:00 (jour fermé, clé absente)', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-07T10:00:00.000Z', endAt: '2026-06-07T10:30:00.000Z' },
      tueWorkdays,
    )).toBe(false);
  });

  it('rejects slot ending at 17:01 (1 min après close)', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T16:30:00.000Z', endAt: '2026-06-02T17:01:00.000Z' },
      tueWorkdays,
    )).toBe(false);
  });

  it('accepts slot starting exactly at 09:00 open', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T09:00:00.000Z', endAt: '2026-06-02T09:30:00.000Z' },
      tueWorkdays,
    )).toBe(true);
  });

  it('rejects slot starting at 08:59 (1 min avant open)', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T08:59:00.000Z', endAt: '2026-06-02T09:29:00.000Z' },
      tueWorkdays,
    )).toBe(false);
  });

  it('rejects when businessHours is empty / null', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T10:00:00.000Z', endAt: '2026-06-02T10:30:00.000Z' },
      {} as Record<string, string>,
    )).toBe(false);
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T10:00:00.000Z', endAt: '2026-06-02T10:30:00.000Z' },
      null as unknown as Record<string, string>,
    )).toBe(false);
  });

  it('rejects when day key has invalid range value', () => {
    expect(isWithinBusinessHours(
      { startAt: '2026-06-02T10:00:00.000Z', endAt: '2026-06-02T10:30:00.000Z' },
      { tue: 'garbage' },
    )).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  isCancellable
// ════════════════════════════════════════════════════════════════════════════

describe('isCancellable', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');

  it('accepts confirmed booking with 25h before start (>24h window)', () => {
    const r = isCancellable(
      { status: 'confirmed', startAt: '2026-06-02T11:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects confirmed booking with 23h before start (<24h window)', () => {
    const r = isCancellable(
      { status: 'confirmed', startAt: '2026-06-02T09:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.CANCEL_WINDOW_PASSED);
  });

  it('rejects already-cancelled booking', () => {
    const r = isCancellable(
      { status: 'cancelled', startAt: '2026-06-03T10:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.ALREADY_CANCELLED);
  });

  it('rejects past booking (startAt < now)', () => {
    const r = isCancellable(
      { status: 'confirmed', startAt: '2026-05-31T10:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.BOOKING_EXPIRED);
  });

  it('returns BOOKING_NOT_FOUND when booking is null', () => {
    const r = isCancellable(null, now);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.BOOKING_NOT_FOUND);
  });

  it('respects custom cancelWindowHours=2', () => {
    const r = isCancellable(
      { status: 'confirmed', startAt: '2026-06-01T13:00:00.000Z' },
      now,
      2,
    );
    expect(r.ok).toBe(true); // 3h before, window 2h → OK
  });

  it('accepts start_time legacy field (not startAt)', () => {
    const r = isCancellable(
      { status: 'confirmed', start_time: '2026-06-02T11:00:00.000Z' } as unknown as { status: string; start_time: string },
      now,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects completed bookings as already-closed', () => {
    const r = isCancellable(
      { status: 'completed', startAt: '2026-06-02T11:00:00.000Z' },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.ALREADY_COMPLETED);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  computeReminderSchedule
// ════════════════════════════════════════════════════════════════════════════

describe('computeReminderSchedule', () => {
  const startAt = '2026-06-02T10:00:00.000Z';
  const startMs = Date.parse(startAt);

  it('produces 2 dates for [24*60, 2*60] (T-24h, T-2h)', () => {
    const dates = computeReminderSchedule(startAt, [24 * 60, 2 * 60]);
    expect(dates.length).toBe(2);
    // Sorted ascending (earliest first)
    expect(dates[0].getTime()).toBe(startMs - 24 * 3600_000);
    expect(dates[1].getTime()).toBe(startMs - 2 * 3600_000);
  });

  it('returns empty array for empty offsets', () => {
    expect(computeReminderSchedule(startAt, [])).toEqual([]);
  });

  it('skips zero / negative offsets', () => {
    const dates = computeReminderSchedule(startAt, [-60, 0, 30]);
    expect(dates.length).toBe(1);
    expect(dates[0].getTime()).toBe(startMs - 30 * 60_000);
  });

  it('dedupes identical offsets', () => {
    const dates = computeReminderSchedule(startAt, [60, 60, 60]);
    expect(dates.length).toBe(1);
  });

  it('caps at MAX_REMINDERS_PER_BOOKING (5)', () => {
    const dates = computeReminderSchedule(startAt, [10, 20, 30, 40, 50, 60, 70, 80]);
    expect(dates.length).toBe(5);
  });

  it('returns empty for unparseable startAt', () => {
    expect(computeReminderSchedule('not-a-date', [60])).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  applyTimezoneOffset
// ════════════════════════════════════════════════════════════════════════════

describe('applyTimezoneOffset', () => {
  const d = new Date('2026-06-01T10:00:00.000Z');

  it('shifts +05:30 (India)', () => {
    const shifted = applyTimezoneOffset(d, '+05:30');
    expect(shifted.getTime()).toBe(d.getTime() + (5 * 60 + 30) * 60_000);
  });

  it('shifts -04:00 (EDT)', () => {
    const shifted = applyTimezoneOffset(d, '-04:00');
    expect(shifted.getTime()).toBe(d.getTime() - 4 * 3600_000);
  });

  it('returns same instant for Z / UTC / +00:00', () => {
    expect(applyTimezoneOffset(d, 'Z').getTime()).toBe(d.getTime());
    expect(applyTimezoneOffset(d, 'UTC').getTime()).toBe(d.getTime());
    expect(applyTimezoneOffset(d, '+00:00').getTime()).toBe(d.getTime());
  });

  it('returns same instant for invalid offset string', () => {
    expect(applyTimezoneOffset(d, 'garbage').getTime()).toBe(d.getTime());
  });

  it('returns Invalid Date when input date is invalid', () => {
    const bad = applyTimezoneOffset(new Date('xxx'), '+05:30');
    expect(Number.isNaN(bad.getTime())).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  validateBookingInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateBookingInput', () => {
  const validBase = {
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    start_time: '2026-06-02T10:00:00.000Z',
  };

  it('accepts a minimal valid payload', () => {
    expect(validateBookingInput(validBase).ok).toBe(true);
  });

  it('rejects when honeypot is filled (bot signal)', () => {
    const r = validateBookingInput({ ...validBase, honeypot: 'http://spam.example' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.HONEYPOT_TRIPPED);
  });

  it('rejects empty / missing guest_name', () => {
    const r = validateBookingInput({ ...validBase, guest_name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.NAME_REQUIRED);
  });

  it('rejects malformed email', () => {
    const r = validateBookingInput({ ...validBase, guest_email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.EMAIL_INVALID);
  });

  it('rejects malformed phone when provided', () => {
    const r = validateBookingInput({ ...validBase, guest_phone: 'abc!!' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.PHONE_INVALID);
  });

  it('accepts E.164-ish phone "+1 (514) 555-1212"', () => {
    const r = validateBookingInput({ ...validBase, guest_phone: '+1 (514) 555-1212' });
    expect(r.ok).toBe(true);
  });

  it('rejects unparseable start_time', () => {
    const r = validateBookingInput({ ...validBase, start_time: 'not-iso' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(BOOKING_ERROR_CODES.SLOT_INVALID);
  });

  it('rejects null / non-object input', () => {
    expect(validateBookingInput(null).ok).toBe(false);
    expect(validateBookingInput(undefined).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  hashBookingToken
// ════════════════════════════════════════════════════════════════════════════

describe('hashBookingToken', () => {
  it('returns a non-empty 7..8 char string for a UUID', () => {
    const h = hashBookingToken('b7e7d1a8-1234-4abc-9def-1234567890ab');
    expect(h.length).toBeGreaterThanOrEqual(7);
    expect(h.length).toBeLessThanOrEqual(8);
  });

  it('is deterministic (same input → same output)', () => {
    const a = hashBookingToken('booking-id-42');
    const b = hashBookingToken('booking-id-42');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs (DJB2 basic sanity)', () => {
    expect(hashBookingToken('a')).not.toBe(hashBookingToken('b'));
    expect(hashBookingToken('booking-1')).not.toBe(hashBookingToken('booking-2'));
  });

  it('returns empty string for empty / non-string', () => {
    expect(hashBookingToken('')).toBe('');
    expect(hashBookingToken(null as unknown as string)).toBe('');
  });
});
