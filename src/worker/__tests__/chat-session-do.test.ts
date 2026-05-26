// ── Sprint 36 — chat-session-do.test.ts — Agent C1 ─────────────────────────
// Tests unitaires des helpers persistSessionStart / markSessionEnd /
// getActiveSessionForConversation (src/worker/lib/chat-session-do.ts).
//
// Couvre :
//   1. persistSessionStart insère conversations + webchat_sessions correctement
//   2. widget introuvable → throw 'widget_not_found'
//   3. markSessionEnd best-effort (rowsAffected=0 ne throw pas)
//   4. getActiveSessionForConversation retourne row ou null
//   5. Loi 25 / RGPD : ip_hash SHA-256 hex 64 chars, JAMAIS l'IP brute en bind
//
// Mock D1 : capture séparée par "famille" de requête (SELECT widget, INSERT
// conversations, INSERT webchat_sessions, UPDATE webchat_sessions, SELECT
// session active, audit_log) — on dispatch via le pattern SQL passé à
// prepare() pour pouvoir asserter le contenu exact des binds.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  persistSessionStart,
  markSessionEnd,
  getActiveSessionForConversation,
} from '../lib/chat-session-do';
import type { Env } from '../types';

// ── Helper : SHA-256 hex de référence (calcule la valeur attendue côté test).
async function refSha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

// ── Capture structurée : { sql, binds, op }[] pour chaque prepare() appelé.
interface DbCall {
  sql: string;
  binds: unknown[];
  op: 'run' | 'first' | 'all' | 'none';
  result: unknown;
}

interface MockDbConfig {
  /** Valeur retournée par first() pour le SELECT widget. */
  widgetRow?: { client_id: string; agency_id: string | null } | null;
  /** Valeur retournée par first() pour le SELECT session active. */
  activeSessionRow?: Record<string, unknown> | null;
  /** Valeur retournée par run() pour UPDATE webchat_sessions (markSessionEnd). */
  updateMeta?: { changes: number };
  /** Throw côté INSERT conversations / INSERT webchat_sessions. */
  throwOnConversationInsert?: boolean;
  throwOnSessionInsert?: boolean;
}

function makeMockEnv(cfg: MockDbConfig = {}): { env: Env; calls: DbCall[] } {
  const calls: DbCall[] = [];

  // Chaque .prepare() retourne un statement avec .bind() puis .first()/.run()/.all().
  function buildStatement(sql: string) {
    const stmt = {
      _binds: [] as unknown[],
      bind(...args: unknown[]) {
        stmt._binds = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        const call: DbCall = { sql, binds: stmt._binds, op: 'first', result: null };
        // Dispatch par pattern SQL.
        if (/FROM webchat_widgets/i.test(sql)) {
          call.result = cfg.widgetRow ?? null;
        } else if (/FROM webchat_sessions/i.test(sql) && /status = 'active'/i.test(sql)) {
          call.result = cfg.activeSessionRow ?? null;
        }
        calls.push(call);
        return call.result as T | null;
      },
      async run(): Promise<D1Result> {
        const call: DbCall = { sql, binds: stmt._binds, op: 'run', result: null };
        // Throw scénarios.
        if (cfg.throwOnConversationInsert && /INSERT INTO conversations/i.test(sql)) {
          calls.push(call);
          throw new Error('FK constraint failed');
        }
        if (cfg.throwOnSessionInsert && /INSERT INTO webchat_sessions/i.test(sql)) {
          calls.push(call);
          throw new Error('UNIQUE constraint failed');
        }
        // Pattern par défaut : changes selon config (markSessionEnd) ou 1.
        const meta = /UPDATE webchat_sessions/i.test(sql)
          ? { changes: cfg.updateMeta?.changes ?? 1 }
          : { changes: 1 };
        const result = { success: true, meta } as unknown as D1Result;
        call.result = result;
        calls.push(call);
        return result;
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        const call: DbCall = { sql, binds: stmt._binds, op: 'all', result: { results: [] } };
        calls.push(call);
        return { results: [] as T[], success: true, meta: {} } as unknown as D1Result<T>;
      },
    };
    return stmt;
  }

  const mockDb = {
    prepare: vi.fn((sql: string) => buildStatement(sql)),
  };

  const env = { DB: mockDb } as unknown as Env;
  return { env, calls };
}

describe('chat-session-do — persistSessionStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('insère conversations + webchat_sessions correctement (happy path)', async () => {
    const { env, calls } = makeMockEnv({
      widgetRow: { client_id: 'cli_A', agency_id: 'ag_A' },
    });

    const result = await persistSessionStart(env, 'w1', {
      clientId: 'cli_A',
      ip: '1.2.3.4',
      userAgent: 'Mozilla',
      pageUrl: 'https://example.com',
      referrer: '',
      visitorName: 'Test',
      visitorEmail: 'test@ex.com',
    });

    // Résultat non-null.
    expect(result).toBeDefined();
    expect(result.sessionId).toBeTruthy();
    expect(result.conversationId).toBeTruthy();
    expect(typeof result.sessionId).toBe('string');
    expect(typeof result.conversationId).toBe('string');

    // INSERT conversations appelé une fois.
    const convInserts = calls.filter(c => /INSERT INTO conversations/i.test(c.sql));
    expect(convInserts).toHaveLength(1);
    expect(convInserts[0]?.op).toBe('run');
    // bind(conversationId, clientId, externalId) — 3 binds.
    expect(convInserts[0]?.binds).toHaveLength(3);
    expect(convInserts[0]?.binds[0]).toBe(result.conversationId);
    expect(convInserts[0]?.binds[1]).toBe('cli_A');
    expect(String(convInserts[0]?.binds[2])).toMatch(/^webchat_/);

    // INSERT webchat_sessions appelé une fois.
    const sessInserts = calls.filter(c => /INSERT INTO webchat_sessions/i.test(c.sql));
    expect(sessInserts).toHaveLength(1);
    expect(sessInserts[0]?.op).toBe('run');
    // 9 binds : sessionId, widgetId, conversationId, visitorName, visitorEmail,
    //           pageUrl, referrer, userAgent, ipHash.
    expect(sessInserts[0]?.binds).toHaveLength(9);
    expect(sessInserts[0]?.binds[0]).toBe(result.sessionId);
    expect(sessInserts[0]?.binds[1]).toBe('w1');
    expect(sessInserts[0]?.binds[2]).toBe(result.conversationId);
    expect(sessInserts[0]?.binds[3]).toBe('Test');
    expect(sessInserts[0]?.binds[4]).toBe('test@ex.com');
    expect(sessInserts[0]?.binds[5]).toBe('https://example.com');

    // ip_hash (9e bind, index 8) = SHA-256('1.2.3.4') — hex 64 chars.
    const ipHash = sessInserts[0]?.binds[8] as string;
    const expectedHash = await refSha256Hex('1.2.3.4');
    expect(ipHash).toBe(expectedHash);
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws "widget_not_found" si lookup widget retourne null', async () => {
    const { env } = makeMockEnv({ widgetRow: null });

    await expect(
      persistSessionStart(env, 'unknown_widget', {
        clientId: 'cli_A',
        ip: '1.2.3.4',
        userAgent: 'Mozilla',
        pageUrl: 'https://example.com',
        referrer: '',
        visitorName: 'Test',
        visitorEmail: 'test@ex.com',
      }),
    ).rejects.toThrow(/widget_not_found/);
  });

  it('Loi 25 / RGPD : aucun bind ne contient l\'IP brute, ip_hash est SHA-256 hex 64 chars', async () => {
    const { env, calls } = makeMockEnv({
      widgetRow: { client_id: 'cli_A', agency_id: 'ag_A' },
    });

    const RAW_IP = '1.2.3.4';
    await persistSessionStart(env, 'w1', {
      clientId: 'cli_A',
      ip: RAW_IP,
      userAgent: 'Mozilla',
      pageUrl: 'https://example.com',
      referrer: '',
      visitorName: 'Test',
      visitorEmail: 'test@ex.com',
    });

    // Spy sur les binds de l'INSERT webchat_sessions.
    const sessInserts = calls.filter(c => /INSERT INTO webchat_sessions/i.test(c.sql));
    expect(sessInserts).toHaveLength(1);
    const binds = sessInserts[0]?.binds ?? [];

    // AUCUN bind ne doit contenir la string '1.2.3.4' (Loi 25 — pas d'IP brute).
    for (const b of binds) {
      if (typeof b === 'string') {
        expect(b).not.toContain(RAW_IP);
      }
    }

    // Au moins un bind contient un hash hex 64 chars (l'ip_hash).
    const hexBinds = binds.filter(
      (b): b is string => typeof b === 'string' && /^[0-9a-f]{64}$/.test(b),
    );
    expect(hexBinds.length).toBeGreaterThanOrEqual(1);

    // Bonus paranoïa : aucun autre bind (conversations + audit) ne doit contenir l'IP brute.
    for (const call of calls) {
      for (const b of call.binds) {
        if (typeof b === 'string') {
          expect(b).not.toContain(RAW_IP);
        }
      }
    }
  });
});

describe('chat-session-do — markSessionEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('best-effort : rowsAffected=0 ne throw pas, retourne void', async () => {
    const { env, calls } = makeMockEnv({ updateMeta: { changes: 0 } });

    // Doit résoudre sans throw.
    await expect(markSessionEnd(env, 'sess_inexistante')).resolves.toBeUndefined();

    // Vérifie qu'UPDATE webchat_sessions a bien été tenté.
    const updates = calls.filter(c => /UPDATE webchat_sessions/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.binds).toEqual(['sess_inexistante']);
  });

  it('best-effort : ne throw même si le DB throw en interne', async () => {
    // Construit un env qui throw sur n'importe quel .run().
    const throwingEnv = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockRejectedValue(new Error('DB unreachable')),
        })),
      },
    } as unknown as Env;

    await expect(markSessionEnd(throwingEnv, 'sess_X')).resolves.toBeUndefined();
  });
});

describe('chat-session-do — getActiveSessionForConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retourne le row complet quand first() renvoie une session active', async () => {
    const fakeRow = {
      id: 'sess_1',
      widget_id: 'w1',
      conversation_id: 'conv_1',
      visitor_name: 'Alice',
      visitor_email: 'alice@ex.com',
      page_url: 'https://example.com',
      referrer: '',
      user_agent: 'Mozilla',
      ip_hash: 'a'.repeat(64),
      started_at: '2026-05-24T10:00:00Z',
      ended_at: null,
      last_seen_at: '2026-05-24T10:05:00Z',
      status: 'active',
      unread_agent_count: 0,
      agent_user_id: null,
    };

    const { env, calls } = makeMockEnv({ activeSessionRow: fakeRow });

    const result = await getActiveSessionForConversation(env, 'conv_1');

    expect(result).toEqual(fakeRow);

    // Vérifie le bind du convId.
    const selects = calls.filter(
      c => /FROM webchat_sessions/i.test(c.sql) && /status = 'active'/i.test(c.sql),
    );
    expect(selects).toHaveLength(1);
    expect(selects[0]?.binds).toEqual(['conv_1']);
  });

  it('retourne null quand first() ne trouve aucune session active', async () => {
    const { env } = makeMockEnv({ activeSessionRow: null });

    const result = await getActiveSessionForConversation(env, 'conv_inexistant');

    expect(result).toBeNull();
  });
});
