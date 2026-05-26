// ── voicemails-engine.test.ts — Tests RENFORCEMENT voicemails-engine.ts ──────
//
// Couvre R2 key build/parse, rétention 90j RGPD, validation metadata, export
// CSV/JSON RGPD-right-to-portability.
//
// Aucun mock — module pur.

import { describe, it, expect } from 'vitest';
import {
  VOICEMAILS_ERROR_CODES,
  RETENTION_DAYS,
  RETENTION_MS,
  VOICEMAIL_MAX_DURATION_SEC,
  TRANSCRIPTION_MAX_LEN,
  VALID_TRANSCRIPTION_STATUSES,
  buildR2VoicemailKey,
  parseR2VoicemailKey,
  isWithinRetention,
  validateVoicemailMetadata,
  formatVoicemailExport,
} from '../lib/voicemails-engine';

describe('voicemails-engine — constants', () => {
  it('retention is 90 days', () => {
    expect(RETENTION_DAYS).toBe(90);
    expect(RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('exposes transcription status whitelist', () => {
    expect(VALID_TRANSCRIPTION_STATUSES).toContain('pending');
    expect(VALID_TRANSCRIPTION_STATUSES).toContain('completed');
    expect(VALID_TRANSCRIPTION_STATUSES).toContain('failed');
    expect(VALID_TRANSCRIPTION_STATUSES).toContain('skipped');
  });

  it('exposes caps', () => {
    expect(VOICEMAIL_MAX_DURATION_SEC).toBe(600);
    expect(TRANSCRIPTION_MAX_LEN).toBe(20_000);
  });

  it('exposes stable error codes', () => {
    expect(VOICEMAILS_ERROR_CODES.INVALID_R2_KEY).toBe('invalid_r2_key');
    expect(VOICEMAILS_ERROR_CODES.RETENTION_EXPIRED).toBe('retention_expired');
  });
});

describe('voicemails-engine — buildR2VoicemailKey / parseR2VoicemailKey', () => {
  it('builds deterministic key with day prefix', () => {
    const ts = Date.UTC(2026, 4, 26, 14, 30, 0); // 2026-05-26
    const key = buildR2VoicemailKey({ clientId: 'tenantA', callSid: 'CA12345', ts });
    expect(key).toBe(`voicemails/tenantA/2026-05-26/CA12345-${ts}.mp3`);
  });

  it('respects custom ext when alphanum', () => {
    const ts = Date.UTC(2026, 4, 26);
    const key = buildR2VoicemailKey({ clientId: 'a', callSid: 'b', ts, ext: 'wav' });
    expect(key.endsWith('.wav')).toBe(true);
  });

  it('falls back to mp3 for invalid ext', () => {
    const ts = Date.UTC(2026, 4, 26);
    const key = buildR2VoicemailKey({ clientId: 'a', callSid: 'b', ts, ext: 'bad/ext' });
    expect(key.endsWith('.mp3')).toBe(true);
  });

  it('throws on invalid clientId', () => {
    expect(() => buildR2VoicemailKey({ clientId: 'bad/id', callSid: 'CA', ts: 1 })).toThrow();
    expect(() => buildR2VoicemailKey({ clientId: '', callSid: 'CA', ts: 1 })).toThrow();
  });

  it('throws on invalid callSid', () => {
    expect(() => buildR2VoicemailKey({ clientId: 'a', callSid: '', ts: 1 })).toThrow();
    expect(() => buildR2VoicemailKey({ clientId: 'a', callSid: 'bad/sid', ts: 1 })).toThrow();
  });

  it('throws on invalid ts', () => {
    expect(() => buildR2VoicemailKey({ clientId: 'a', callSid: 'b', ts: 0 })).toThrow();
    expect(() => buildR2VoicemailKey({ clientId: 'a', callSid: 'b', ts: -1 })).toThrow();
    expect(() => buildR2VoicemailKey({ clientId: 'a', callSid: 'b', ts: NaN })).toThrow();
  });

  it('parses a built key (round-trip)', () => {
    const ts = Date.UTC(2026, 4, 26, 14, 30, 0);
    const key = buildR2VoicemailKey({ clientId: 'tenantA', callSid: 'CA12345', ts });
    const parsed = parseR2VoicemailKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.clientId).toBe('tenantA');
    expect(parsed?.callSid).toBe('CA12345');
    expect(parsed?.ts).toBe(ts);
    expect(parsed?.day).toBe('2026-05-26');
    expect(parsed?.ext).toBe('mp3');
  });

  it('returns null on malformed key', () => {
    expect(parseR2VoicemailKey('not-a-vm-key')).toBeNull();
    expect(parseR2VoicemailKey('voicemails/tenant/badday/CA-1.mp3')).toBeNull();
    expect(parseR2VoicemailKey(null)).toBeNull();
    expect(parseR2VoicemailKey('')).toBeNull();
  });
});

describe('voicemails-engine — isWithinRetention', () => {
  const NOW = Date.UTC(2026, 4, 26); // 2026-05-26

  it('accepts now (just created)', () => {
    expect(isWithinRetention(NOW, NOW)).toBe(true);
  });

  it('accepts 89 days ago', () => {
    const ts = NOW - 89 * 24 * 60 * 60 * 1000;
    expect(isWithinRetention(ts, NOW)).toBe(true);
  });

  it('rejects 91 days ago', () => {
    const ts = NOW - 91 * 24 * 60 * 60 * 1000;
    expect(isWithinRetention(ts, NOW)).toBe(false);
  });

  it('accepts ISO string within window', () => {
    expect(isWithinRetention('2026-05-20T10:00:00Z', NOW)).toBe(true);
  });

  it('rejects ISO string outside window', () => {
    expect(isWithinRetention('2025-01-01T10:00:00Z', NOW)).toBe(false);
  });

  it('rejects null/undefined/invalid', () => {
    expect(isWithinRetention(null, NOW)).toBe(false);
    expect(isWithinRetention(undefined, NOW)).toBe(false);
    expect(isWithinRetention('not-a-date', NOW)).toBe(false);
    expect(isWithinRetention(0, NOW)).toBe(false);
    expect(isWithinRetention(-1, NOW)).toBe(false);
  });

  it('rejects future timestamps (sanity)', () => {
    const future = NOW + 24 * 60 * 60 * 1000;
    expect(isWithinRetention(future, NOW)).toBe(false);
  });
});

describe('voicemails-engine — validateVoicemailMetadata', () => {
  it('accepts empty metadata', () => {
    expect(validateVoicemailMetadata({}).ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateVoicemailMetadata(null).ok).toBe(false);
    expect(validateVoicemailMetadata(undefined).ok).toBe(false);
  });

  it('accepts valid duration', () => {
    expect(validateVoicemailMetadata({ durationSec: 30 }).ok).toBe(true);
    expect(validateVoicemailMetadata({ durationSec: 0 }).ok).toBe(true);
    expect(validateVoicemailMetadata({ durationSec: VOICEMAIL_MAX_DURATION_SEC }).ok).toBe(true);
  });

  it('rejects out-of-range duration', () => {
    expect(validateVoicemailMetadata({ durationSec: -1 }).ok).toBe(false);
    expect(validateVoicemailMetadata({ durationSec: 9999 }).ok).toBe(false);
    expect(validateVoicemailMetadata({ durationSec: 'abc' }).ok).toBe(false);
  });

  it('accepts transcription within cap', () => {
    expect(validateVoicemailMetadata({ transcription: 'Hello world' }).ok).toBe(true);
  });

  it('rejects transcription too long', () => {
    const r = validateVoicemailMetadata({ transcription: 'x'.repeat(TRANSCRIPTION_MAX_LEN + 1) });
    expect(r.ok).toBe(false);
  });

  it('rejects non-string transcription', () => {
    const r = validateVoicemailMetadata({ transcription: 123 as unknown as string });
    expect(r.ok).toBe(false);
  });

  it('accepts valid transcription status', () => {
    expect(validateVoicemailMetadata({ transcriptionStatus: 'pending' }).ok).toBe(true);
    expect(validateVoicemailMetadata({ transcriptionStatus: 'completed' }).ok).toBe(true);
  });

  it('rejects unknown transcription status', () => {
    const r = validateVoicemailMetadata({ transcriptionStatus: 'weird' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(VOICEMAILS_ERROR_CODES.INVALID_TRANSCRIPTION_STATUS);
  });

  it('accepts valid transcription lang', () => {
    expect(validateVoicemailMetadata({ transcriptionLang: 'fr-CA' }).ok).toBe(true);
    expect(validateVoicemailMetadata({ transcriptionLang: 'en-US' }).ok).toBe(true);
  });

  it('rejects unknown transcription lang', () => {
    expect(validateVoicemailMetadata({ transcriptionLang: 'klingon' }).ok).toBe(false);
  });
});

describe('voicemails-engine — formatVoicemailExport', () => {
  it('produces CSV header + rows', () => {
    const r = formatVoicemailExport([
      {
        id: 'vm1',
        client_id: 'tenantA',
        from_number: '+14165551234',
        duration_sec: 30,
        created_at: '2026-05-26T10:00:00Z',
      },
    ]);
    expect(r.csv).toContain('id,client_id,call_log_id,lead_id,from_number,to_number,duration_sec');
    expect(r.csv).toContain('vm1,tenantA,,,+14165551234,,30,,,2026-05-26T10:00:00Z,,');
    expect(r.rowCount).toBe(1);
  });

  it('produces empty CSV with header only on empty', () => {
    const r = formatVoicemailExport([]);
    expect(r.csv.split('\r\n').length).toBe(1);
    expect(r.rowCount).toBe(0);
  });

  it('escapes CSV cells with comma/quote/newline', () => {
    const r = formatVoicemailExport([
      {
        id: 'vm1',
        transcription: 'Hello, "world"\nNext line',
      },
    ]);
    expect(r.csv).toContain('"Hello, ""world""\nNext line"');
  });

  it('produces parseable JSON', () => {
    const r = formatVoicemailExport([
      { id: 'a', client_id: 'tenantA', duration_sec: 12 },
      { id: 'b', client_id: 'tenantA', duration_sec: 34 },
    ]);
    const parsed = JSON.parse(r.json);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].id).toBe('a');
  });

  it('treats null/undefined as empty', () => {
    const r = formatVoicemailExport([{ id: 'vm1' } as unknown as { id: string }]);
    expect(r.csv).toContain('vm1,,,,,,,,,,,');
  });

  it('handles missing rows array', () => {
    const r = formatVoicemailExport(null as unknown as []);
    expect(r.rowCount).toBe(0);
  });
});
