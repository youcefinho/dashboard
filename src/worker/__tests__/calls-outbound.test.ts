// ── calls-outbound.test.ts — Sprint 34 Agent C2 ─────────────────────────────
// Tests vitest des 4 handlers Twilio Voice outbound (calls-outbound.ts) :
//   1. handleInitiateOutboundCall   — mock sans credentials + avec credentials
//                                     + refus consent CRTC + numéro invalide
//   2. handleToggleCallRecording    — start success + stop success
//   3. handleGetRecordingSignedUrl  — IDOR cross-tenant ⇒ 404
//   4. handleDeleteCallRecording    — cascade Twilio + R2 + UPDATE call_logs
//                                     + UPDATE call_recordings_metadata
//
// Tous les helpers réseau de ../lib/twilio-voice sont mockés (vi.mock) —
// AUCUN appel réseau réel. env.FILES.delete + audit + D1.prepare mockés.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';

// ── Mock lib/twilio-voice : helpers réellement importés par calls-outbound.ts ──
vi.mock('../lib/twilio-voice', () => ({
  initiateOutboundCall: vi.fn(),
  startCallRecording: vi.fn(),
  stopCallRecording: vi.fn(),
  getSignedR2Url: vi.fn(),
  deleteTwilioRecording: vi.fn(),
  deleteR2Recording: vi.fn(),
}));

// audit mocké (best-effort, ne doit jamais throw)
vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(true),
  };
});

// Imports APRÈS les mocks.
import {
  handleInitiateOutboundCall,
  handleToggleCallRecording,
  handleGetRecordingSignedUrl,
  handleDeleteCallRecording,
} from '../calls-outbound';
import {
  initiateOutboundCall,
  startCallRecording,
  stopCallRecording,
  getSignedR2Url,
  deleteTwilioRecording,
  deleteR2Recording,
} from '../lib/twilio-voice';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockStmt {
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

interface MockDb {
  prepare: ReturnType<typeof vi.fn>;
  __stmts: MockStmt[];
}

function makeDb(): MockDb {
  const stmts: MockStmt[] = [];
  const db = {
    prepare: vi.fn((_sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      stmts.push(stmt);
      return stmt;
    }),
    __stmts: stmts,
  } as MockDb;
  return db;
}

function makeAuth(overrides?: Partial<{ userId: string; role: string; clientId: string }>) {
  return {
    userId: 'user_1',
    role: 'agent',
    clientId: 'client_a',
    capabilities: new Set(['leads.write', 'settings.manage']),
    ...overrides,
  };
}

function makeEnv(db: MockDb, opts?: Partial<Env> & { withTwilio?: boolean; filesDelete?: ReturnType<typeof vi.fn> }) {
  const env: Partial<Env> = {
    DB: db as unknown as Env['DB'],
    FILES: {
      delete: opts?.filesDelete || vi.fn().mockResolvedValue(undefined),
    } as unknown as Env['FILES'],
  };
  if (opts?.withTwilio) {
    env.TWILIO_ACCOUNT_SID = 'AC_test';
    env.TWILIO_AUTH_TOKEN = 'token_test';
    env.TWILIO_PHONE_NUMBER = '+15145550000';
  }
  return env as Env;
}

function reqJson(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calls-outbound — Sprint 34 Twilio Voice (Agent C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. initiateOutboundCall — mock sans credentials
  // ──────────────────────────────────────────────────────────────────────────
  it('initiateOutboundCall : mock sans credentials → status mock + INSERT call_logs', async () => {
    vi.mocked(initiateOutboundCall).mockResolvedValueOnce({
      success: false,
      mock: true,
    });

    const db = makeDb();
    const env = makeEnv(db); // PAS de credentials Twilio
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/outbound', {
      to: '+15145551234',
      record: false,
    });

    const res = await handleInitiateOutboundCall(req, env, auth);
    const data = (await res.json()) as { data?: { status?: string; mock?: boolean; recording_enabled?: boolean } };

    expect(res.status).toBe(200);
    expect(data.data?.status).toBe('mock');
    expect(data.data?.mock).toBe(true);
    expect(data.data?.recording_enabled).toBe(false);

    // INSERT call_logs vérifié via D1 spy (prepare appelé avec INSERT call_logs).
    const inserted = db.prepare.mock.calls.some((c) =>
      String(c[0]).includes('INSERT INTO call_logs'),
    );
    expect(inserted).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. initiateOutboundCall avec credentials
  // ──────────────────────────────────────────────────────────────────────────
  it('initiateOutboundCall : credentials + Twilio renvoie SID → status initiated + UPDATE twilio_sid', async () => {
    vi.mocked(initiateOutboundCall).mockResolvedValueOnce({
      success: true,
      sid: 'CA123',
      data: { callSid: 'CA123', status: 'queued' },
    });

    const db = makeDb();
    const env = makeEnv(db, { withTwilio: true });
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/outbound', {
      to: '+15145551234',
      record: false,
    });

    const res = await handleInitiateOutboundCall(req, env, auth);
    const data = (await res.json()) as { data?: { status?: string; mock?: boolean } };

    expect(res.status).toBe(200);
    expect(data.data?.status).toBe('initiated');
    expect(data.data?.mock).toBe(false);

    // UPDATE call_logs SET status=?, twilio_sid=? appelé avec 'CA123'.
    const updateStmt = db.prepare.mock.calls.findIndex((c) =>
      String(c[0]).includes('UPDATE call_logs SET status'),
    );
    expect(updateStmt).toBeGreaterThanOrEqual(0);
    const updStmt = db.__stmts[updateStmt]!;
    expect(updStmt.bind).toHaveBeenCalledWith('initiated', 'CA123', expect.any(String));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. consent_obtained=false + record=true → 400 CRTC
  // ──────────────────────────────────────────────────────────────────────────
  it('initiateOutboundCall : record=true + consent_obtained=false → 400 "Consentement"', async () => {
    const db = makeDb();
    const env = makeEnv(db, { withTwilio: true });
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/outbound', {
      to: '+15145551234',
      record: true,
      consent_obtained: false,
    });

    const res = await handleInitiateOutboundCall(req, env, auth);
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toBeTruthy();
    expect(data.error!.toLowerCase()).toContain('consentement');
    // Twilio jamais appelé.
    expect(vi.mocked(initiateOutboundCall)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. to invalide (non E.164) → 400 "Numéro invalide"
  // ──────────────────────────────────────────────────────────────────────────
  it('initiateOutboundCall : to non E.164 → 400 "Numéro invalide"', async () => {
    const db = makeDb();
    const env = makeEnv(db, { withTwilio: true });
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/outbound', { to: 'abc' });

    const res = await handleInitiateOutboundCall(req, env, auth);
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain('Numéro invalide');
    expect(vi.mocked(initiateOutboundCall)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. toggleRecording start → success
  // ──────────────────────────────────────────────────────────────────────────
  it('toggleRecording start : startCallRecording success → 200 success + recording_sid', async () => {
    vi.mocked(startCallRecording).mockResolvedValueOnce({
      success: true,
      sid: 'REabc',
      data: { recordingSid: 'REabc' },
    });

    const db = makeDb();
    // SELECT call_log : retourne row borné tenant correct
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT twilio_sid, client_id, recording_sid FROM call_logs')
            ? { twilio_sid: 'CA999', client_id: 'client_a', recording_sid: null }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db, { withTwilio: true });
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/call_1/record', { enable: true });

    const res = await handleToggleCallRecording(req, env, auth, 'call_1');
    const data = (await res.json()) as { data?: { success?: boolean; recording_sid?: string } };

    expect(res.status).toBe(200);
    expect(data.data?.success).toBe(true);
    expect(data.data?.recording_sid).toBe('REabc');
    expect(vi.mocked(startCallRecording)).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. toggleRecording stop → success
  // ──────────────────────────────────────────────────────────────────────────
  it('toggleRecording stop : stopCallRecording success → 200 success', async () => {
    vi.mocked(stopCallRecording).mockResolvedValueOnce({
      success: true,
      sid: 'REabc',
    });

    const db = makeDb();
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT twilio_sid, client_id, recording_sid FROM call_logs')
            ? { twilio_sid: 'CA999', client_id: 'client_a', recording_sid: 'REabc' }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db, { withTwilio: true });
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/call_1/record', { enable: false });

    const res = await handleToggleCallRecording(req, env, auth, 'call_1');
    const data = (await res.json()) as { data?: { success?: boolean } };

    expect(res.status).toBe(200);
    expect(data.data?.success).toBe(true);
    expect(vi.mocked(stopCallRecording)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startCallRecording)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. getRecordingSignedUrl cross-tenant → 404
  // ──────────────────────────────────────────────────────────────────────────
  it('getRecordingSignedUrl : call_log appartient à un autre client → 404 IDOR-safe', async () => {
    const db = makeDb();
    // SELECT borné AND client_id = ? : avec un clientId 'client_a' qui ne match
    // PAS 'client_other' → first() retourne null, donc 404.
    db.prepare = vi.fn((_sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null), // cross-tenant ⇒ rien remonté
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db);
    const auth = makeAuth({ clientId: 'client_a' });

    const res = await handleGetRecordingSignedUrl(env, auth, 'call_xyz_belongs_to_client_other');
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toBeTruthy();
    // getSignedR2Url JAMAIS appelé (defense-in-depth IDOR).
    expect(vi.mocked(getSignedR2Url)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. deleteCallRecording cascade : Twilio + R2 + UPDATE call_logs + UPDATE metadata
  // ──────────────────────────────────────────────────────────────────────────
  it('deleteCallRecording : cascade Twilio + R2 + reset call_logs + soft-delete metadata', async () => {
    vi.mocked(deleteTwilioRecording).mockResolvedValueOnce({ success: true, sid: 'REabc' });
    vi.mocked(deleteR2Recording).mockResolvedValueOnce({ success: true });

    const filesDelete = vi.fn().mockResolvedValue(undefined);
    const db = makeDb();
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT recording_sid, recording_r2_key, client_id FROM call_logs')
            ? {
                recording_sid: 'REabc',
                recording_r2_key: 'voice/client_a/call_1/REabc.mp3',
                client_id: 'client_a',
              }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db, { withTwilio: true, filesDelete });
    const auth = makeAuth();

    const res = await handleDeleteCallRecording(env, auth, 'call_1');
    const data = (await res.json()) as { data?: { success?: boolean } };

    expect(res.status).toBe(200);
    expect(data.data?.success).toBe(true);

    // Cascade : 3 effets attendus.
    // (1) deleteTwilioRecording appelé avec le recording_sid.
    expect(vi.mocked(deleteTwilioRecording)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteTwilioRecording)).toHaveBeenCalledWith(env, 'REabc');

    // (2) deleteR2Recording appelé avec la r2_key. (env.FILES.delete sert de
    //     filet supplémentaire si la lib échoue ; vérifié appelé aussi.)
    expect(vi.mocked(deleteR2Recording)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteR2Recording)).toHaveBeenCalledWith(
      env,
      'voice/client_a/call_1/REabc.mp3',
    );
    expect(filesDelete).toHaveBeenCalledWith('voice/client_a/call_1/REabc.mp3');

    // (3) UPDATE call_logs SET recording_url=NULL, recording_sid=NULL, ... appelé.
    const resetLogsCalled = db.prepare.mock.calls.some((c) => {
      const s = String(c[0]);
      return (
        s.includes('UPDATE call_logs') &&
        s.includes('recording_url = NULL') &&
        s.includes('recording_sid = NULL')
      );
    });
    expect(resetLogsCalled).toBe(true);

    // (4) UPDATE call_recordings_metadata SET deleted_at = ... appelé.
    const metadataCalled = db.prepare.mock.calls.some((c) => {
      const s = String(c[0]);
      return (
        s.includes('UPDATE call_recordings_metadata') &&
        s.includes('deleted_at')
      );
    });
    expect(metadataCalled).toBe(true);
  });
});
