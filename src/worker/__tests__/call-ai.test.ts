// ── call-ai.test.ts — Tests du compte-rendu d'appel IA & Actions (Sprint 80) ────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { handleSummarizeCall, handleGetCallSummary } from '../telephony';

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

function makeAuth(overrides?: Partial<{ userId: string; role: string; clientId: string; capabilities: Set<string> }>) {
  return {
    userId: 'user_1',
    role: 'agent',
    clientId: 'client_a',
    capabilities: overrides?.capabilities || new Set(['ai.use']),
    ...overrides,
  };
}

function makeEnv(db: MockDb, overrides?: Partial<Env>) {
  return {
    DB: db as unknown as Env['DB'],
    USE_MOCKS: 'true',
    ...overrides,
  } as Env;
}

function reqJson(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Call AI Summaries — Sprint 80', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. POST /api/calls/:id/summarize — capability ai.use
  // ──────────────────────────────────────────────────────────────────────────
  it('Summarize : refuse sans la capability ai.use', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const auth = makeAuth({ capabilities: new Set(['leads.read']) }); // pas de ai.use
    const req = reqJson('http://localhost/api/calls/call_1/summarize', {});

    const res = await handleSummarizeCall(req, env, auth, 'call_1');
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(data.error).toContain('Accès refusé');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. POST /api/calls/:id/summarize — pas de transcription
  // ──────────────────────────────────────────────────────────────────────────
  it('Summarize : erreur si la transcription est vide', async () => {
    const db = makeDb();
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT * FROM call_logs')
            ? { id: 'call_1', client_id: 'client_a', transcription: null }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/call_1/summarize', {});

    const res = await handleSummarizeCall(req, env, auth, 'call_1');
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(data.error).toContain('Aucune transcription disponible');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. POST /api/calls/:id/summarize — succès (mode mock)
  // ──────────────────────────────────────────────────────────────────────────
  it('Summarize : génère et insère le résumé et les tâches', async () => {
    const db = makeDb();
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT * FROM call_logs')
            ? {
                id: 'call_1',
                client_id: 'client_a',
                lead_id: 'lead_123',
                transcription: 'Bonjour, je cherche un condo à Gatineau...',
              }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = reqJson('http://localhost/api/calls/call_1/summarize', {});

    const res = await handleSummarizeCall(req, env, auth, 'call_1');
    const data = (await res.json()) as {
      data?: { id: string; call_id: string; summary: string; tasks: any[] };
    };

    expect(res.status).toBe(200);
    expect(data.data?.call_id).toBe('call_1');
    expect(data.data?.summary).toContain('Gatineau');
    expect(data.data?.tasks.length).toBeGreaterThan(0);

    // Vérifier les requêtes SQLite d'insertion
    const savedSummary = db.prepare.mock.calls.some((c) =>
      String(c[0]).includes('INSERT INTO call_summaries'),
    );
    expect(savedSummary).toBe(true);

    const savedTasks = db.prepare.mock.calls.some((c) =>
      String(c[0]).includes('INSERT INTO tasks'),
    );
    expect(savedTasks).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. GET /api/calls/:id/summary — succès
  // ──────────────────────────────────────────────────────────────────────────
  it('GetCallSummary : retourne le résumé s’il existe', async () => {
    const db = makeDb();
    db.prepare = vi.fn((sql: string) => {
      const stmt: MockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          sql.includes('SELECT cs.* FROM call_summaries')
            ? { id: 'summary_1', call_id: 'call_1', summary: 'Texte résumé' }
            : null,
        ),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      db.__stmts.push(stmt);
      return stmt;
    }) as typeof db.prepare;

    const env = makeEnv(db);
    const auth = makeAuth();

    const res = await handleGetCallSummary(env, auth, 'call_1');
    const data = (await res.json()) as { data?: { id: string; summary: string } };

    expect(res.status).toBe(200);
    expect(data.data?.summary).toBe('Texte résumé');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GET /api/calls/:id/summary — 404
  // ──────────────────────────────────────────────────────────────────────────
  it('GetCallSummary : retourne 404 si introuvable', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const auth = makeAuth();

    const res = await handleGetCallSummary(env, auth, 'call_1');
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toContain('Résumé introuvable');
  });
});
