// ── voicemails-rgpd.test.ts — Sprint 34 Phase C (agent C3) ─────────────────
//
// 6 cas vitest pour les 4 handlers voicemails (A4) :
//   1) listVoicemails → bornage tenant strict (filter client_id)
//   2) listVoicemails → filter unread (SQL inclut listened_at IS NULL)
//   3) markListened   → UPDATE listened_by = auth.userId
//   4) deleteVoicemail → cascade R2 + Twilio + DB soft-delete (3 spies)
//   5) deleteVoicemail → cross-tenant 404, AUCUN side-effect
//   6) deleteVoicemail → capGuard settings.manage → 403, AUCUN side-effect
//
// Mocks :
//   - vi.mock('../lib/twilio-voice', deleteTwilioRecording: vi.fn())
//   - D1 mock chainable (prepare/bind/first/all/run)
//   - R2 mock (env.FILES.delete)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// IMPORTANT : mock AVANT l'import des handlers (hoisted par vitest).
vi.mock('../lib/twilio-voice', () => ({
  deleteTwilioRecording: vi.fn().mockResolvedValue({ success: true, mock: true }),
}));

import {
  handleListVoicemails,
  handleMarkVoicemailListened,
  handleDeleteVoicemail,
} from '../voicemails';
import { deleteTwilioRecording } from '../lib/twilio-voice';
import type { Env } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────

type Auth = {
  userId: string;
  role: string;
  clientId?: string;
  capabilities?: Set<string>;
};

const AUTH_A: Auth = {
  userId: 'usr_A1',
  role: 'broker',
  clientId: 'cli_A',
  capabilities: new Set([
    'leads.read',
    'leads.write',
    'settings.manage',
  ]),
};

const AUTH_A_NO_SETTINGS: Auth = {
  userId: 'usr_A1',
  role: 'broker',
  clientId: 'cli_A',
  capabilities: new Set(['leads.read', 'leads.write']),
};

/**
 * makeDb — D1 mock chainable. Le test injecte les retours via overrides :
 *   { firstResult, allResult, runResult }.
 * Le mock CAPTURE chaque appel prepare(sql) + chaque bind(...args) dans
 * `calls` pour assertion ultérieure (sql / bindings).
 */
function makeDb(overrides: {
  firstResult?: unknown;
  allResult?: unknown;
  runResult?: unknown;
} = {}) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  let pendingSql = '';
  let pendingBinds: unknown[] = [];

  const stmt = {
    bind: vi.fn((...args: unknown[]) => {
      pendingBinds = args;
      return stmt;
    }),
    first: vi.fn(async () => {
      calls.push({ sql: pendingSql, binds: pendingBinds });
      return overrides.firstResult ?? null;
    }),
    all: vi.fn(async () => {
      calls.push({ sql: pendingSql, binds: pendingBinds });
      return overrides.allResult ?? { results: [] };
    }),
    run: vi.fn(async () => {
      calls.push({ sql: pendingSql, binds: pendingBinds });
      return overrides.runResult ?? { success: true, meta: { changes: 1 } };
    }),
  };

  const db = {
    prepare: vi.fn((sql: string) => {
      pendingSql = sql;
      pendingBinds = [];
      return stmt;
    }),
  };

  return { db, calls, stmt };
}

function makeEnv(dbOverrides: Parameters<typeof makeDb>[0] = {}, filesDeleteImpl?: () => Promise<void>) {
  const { db, calls, stmt } = makeDb(dbOverrides);
  const filesDelete = vi.fn(filesDeleteImpl ?? (() => Promise.resolve()));
  const env = {
    DB: db,
    FILES: { delete: filesDelete },
  } as unknown as Env;
  return { env, db, calls, stmt, filesDelete };
}

// ══════════════════════════════════════════════════════════════════════════
// 1) listVoicemails — bornage tenant strict
// ══════════════════════════════════════════════════════════════════════════

describe('voicemails RGPD — Sprint 34 C3', () => {
  beforeEach(() => {
    vi.mocked(deleteTwilioRecording).mockClear();
  });

  it('1) listVoicemails borne le tenant (cli_A ne voit pas cli_B)', async () => {
    // Le HANDLER passe clientId='cli_A' en bind → on simule que D1 ne retourne
    // QUE les rows correspondantes (le filtre WHERE client_id = ? fait le job).
    const rowsTenantA = [
      { id: 'vm_1', client_id: 'cli_A', from_number: '+15145551111' },
      { id: 'vm_2', client_id: 'cli_A', from_number: '+15145552222' },
    ];
    const { env, calls } = makeEnv({ allResult: { results: rowsTenantA } });

    const url = new URL('http://x/api/voicemails');
    const res = await handleListVoicemails(env, AUTH_A, url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; client_id: string }> };

    // Le handler renvoie 2 items (les 2 du tenant A) — pas 3 (cli_B exclu).
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r) => r.client_id === 'cli_A')).toBe(true);

    // Le SQL DOIT contenir le filtre client_id = ? + le bind 'cli_A'.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('AND client_id = ?');
    expect(calls[0]!.binds).toContain('cli_A');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2) listVoicemails — filter unread
  // ══════════════════════════════════════════════════════════════════════════

  it("2) listVoicemails ?unread=true ajoute 'AND listened_at IS NULL'", async () => {
    const { env, calls } = makeEnv({ allResult: { results: [] } });

    const url = new URL('http://x/api/voicemails');
    url.searchParams.set('unread', 'true');
    const res = await handleListVoicemails(env, AUTH_A, url);
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('AND listened_at IS NULL');
    // Garde aussi le bornage tenant.
    expect(calls[0]!.sql).toContain('AND client_id = ?');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3) markListened — UPDATE listened_by = auth.userId
  // ══════════════════════════════════════════════════════════════════════════

  it('3) markVoicemailListened persiste listened_by = auth.userId', async () => {
    const { env, calls } = makeEnv({
      runResult: { success: true, meta: { changes: 1 } },
    });

    const res = await handleMarkVoicemailListened(env, AUTH_A, 'vm_42');
    expect(res.status).toBe(200);

    // Premier call = UPDATE voicemails. (Le 2e éventuel = audit best-effort.)
    const updateCall = calls.find((c) => /^UPDATE voicemails SET/i.test(c.sql));
    expect(updateCall).toBeDefined();
    expect(updateCall!.sql).toContain('listened_at = COALESCE(listened_at');
    expect(updateCall!.sql).toContain("datetime('now')");
    expect(updateCall!.sql).toContain('listened_by = COALESCE(listened_by, ?)');
    expect(updateCall!.sql).toContain('AND client_id = ?');

    // Order des binds : [userId, vmId, clientId].
    expect(updateCall!.binds[0]).toBe('usr_A1');
    expect(updateCall!.binds[1]).toBe('vm_42');
    expect(updateCall!.binds[2]).toBe('cli_A');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4) deleteVoicemail — cascade R2 + Twilio + DB soft-delete
  // ══════════════════════════════════════════════════════════════════════════

  it('4) deleteVoicemail cascade R2 + Twilio + DB soft-delete (3 spies)', async () => {
    // Le SELECT initial retourne une row APPARTENANT au tenant A avec recording_sid + r2_key.
    const row = {
      id: 'vm_99',
      recording_sid: 'REabcdef1234567890abcdef12345678',
      recording_r2_key: 'voice/cli_A/call_1/REabcdef1234567890abcdef12345678.mp3',
    };
    const { env, calls, filesDelete } = makeEnv({
      firstResult: row,
      runResult: { success: true, meta: { changes: 1 } },
    });

    const res = await handleDeleteVoicemail(env, AUTH_A, 'vm_99');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { success: boolean } };
    expect(body.data.success).toBe(true);

    // ① Twilio cascade : 1 appel avec le recording_sid.
    expect(deleteTwilioRecording).toHaveBeenCalledTimes(1);
    expect(deleteTwilioRecording).toHaveBeenCalledWith(env, row.recording_sid);

    // ② R2 cascade : 1 appel avec la r2_key.
    expect(filesDelete).toHaveBeenCalledTimes(1);
    expect(filesDelete).toHaveBeenCalledWith(row.recording_r2_key);

    // ③ DB soft-delete : UPDATE avec deleted_at + scrub URL/SID/key.
    const updateCall = calls.find((c) => /^UPDATE voicemails SET deleted_at/i.test(c.sql));
    expect(updateCall).toBeDefined();
    expect(updateCall!.sql).toContain("deleted_at = datetime('now')");
    expect(updateCall!.sql).toContain('recording_url = NULL');
    expect(updateCall!.sql).toContain('recording_sid = NULL');
    expect(updateCall!.sql).toContain('recording_r2_key = NULL');
    expect(updateCall!.sql).toContain('AND client_id = ?');
    expect(updateCall!.binds).toContain('vm_99');
    expect(updateCall!.binds).toContain('cli_A');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5) cross-tenant delete → 404, AUCUN side-effect
  // ══════════════════════════════════════════════════════════════════════════

  it('5) deleteVoicemail cross-tenant (cli_A → vm de cli_B) renvoie 404 sans cascade', async () => {
    // Le SELECT borné tenant renvoie null (la row de cli_B n'est PAS visible
    // pour cli_A car WHERE client_id = 'cli_A' la filtre).
    const { env, filesDelete } = makeEnv({ firstResult: null });

    const res = await handleDeleteVoicemail(env, AUTH_A, 'vm_belongs_to_B');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('voicemail_not_found');

    // AUCUN side-effect : ni Twilio, ni R2.
    expect(deleteTwilioRecording).not.toHaveBeenCalled();
    expect(filesDelete).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6) capGuard settings.manage → 403, AUCUN side-effect
  // ══════════════════════════════════════════════════════════════════════════

  it('6) deleteVoicemail sans capability settings.manage → 403 sans cascade', async () => {
    const { env, filesDelete } = makeEnv({
      firstResult: {
        id: 'vm_99',
        recording_sid: 'REabc',
        recording_r2_key: 'voice/cli_A/c/REabc.mp3',
      },
    });

    const res = await handleDeleteVoicemail(env, AUTH_A_NO_SETTINGS, 'vm_99');
    expect(res.status).toBe(403);

    // CapGuard rejette AVANT tout side-effect.
    expect(deleteTwilioRecording).not.toHaveBeenCalled();
    expect(filesDelete).not.toHaveBeenCalled();
  });
});
