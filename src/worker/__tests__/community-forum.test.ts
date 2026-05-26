// ── Sprint 51 Agent T45 — community-forum.test.ts — Tests Sprint 45 forum ───
//
// Couvre :
//   Engine (4 cas) :
//     1. recordVote up           → INSERT OR IGNORE c45_votes + UPDATE +1
//     2. recordVote duplicate    → 2ème appel changes=0 → pas d'UPDATE +1
//     3. moderateContent spam    → body all caps long → autoHide=true
//     4. bumpThreadActivity      → UPDATE last_activity_at + comments_count+1
//
//   Handlers (6 cas) :
//     5. handleListThreads       → ORDER BY is_pinned DESC, last_activity_at DESC
//     6. handleCreateThread      → moderateContent autoHide=true → INSERT status='hidden'
//     7. handleCreateComment     → thread locked → 423
//     8. handleVote              → sha256Ip + recordVote → 200
//     9. handleModerateTarget    → action='ban' → UPDATE users community_banned_at
//    10. Cap absente             → leads.write absent → 403
//
// Mock D1 via `createMockD1` (helper figé S2/S3) + override `meta.changes` ad-hoc
// pour le cas duplicate vote (INSERT OR IGNORE). Mocks modules + helpers +
// review-moderation. Aucun réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks de modules (AVANT import du SUT — vi.mock est hoisté) ─────────────

vi.mock('../modules', () => ({
  getClientModules: vi.fn(async (_env: any, _userId: string) => ({
    clientId: 'cli_A',
    modules: [],
  })),
}));

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    audit: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../lib/review-moderation', () => ({
  computeSpamScore: vi.fn((body: string, _locale: string) => {
    // Heuristique de test : body very long all caps → score 85.
    if (body && body.length > 20 && body === body.toUpperCase()) {
      return { score: 85, reasons: ['all_caps'] };
    }
    return { score: 0, reasons: [] };
  }),
  containsBadWords: vi.fn(() => false),
}));

// Imports APRÈS les mocks (vi.mock est hoisté, ordre explicite).
import {
  recordVote,
  moderateContent,
  bumpThreadActivity,
  sanitizeBody,
  hashIp,
  validateThreadInput,
  validateCommentInput,
  canModerate,
  canTransitionStatus,
  checkVoteRateLimit,
  COMMUNITY_ERROR_CODES,
} from '../lib/community-engine';
import {
  handleListThreads,
  handleCreateThread,
  handleCreateComment,
  handleVote,
  handleModerateTarget,
} from '../community-forum';
import { getClientModules } from '../modules';

// ── helpers locaux ──────────────────────────────────────────────────────────

function makeAuth(
  overrides: Partial<{ userId: string; capabilities: Set<string> }> = {},
) {
  return {
    userId: 'u_member_1',
    role: 'member',
    clientId: 'cli_A',
    capabilities: new Set(['leads.write']),
    ...overrides,
  } as any;
}

function makeAdminAuth(extraCaps: string[] = []) {
  return {
    userId: 'u_admin_1',
    role: 'admin',
    clientId: 'cli_A',
    capabilities: new Set(['leads.write', 'settings.manage', ...extraCaps]),
  } as any;
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientModules).mockImplementation(async () => ({
    clientId: 'cli_A',
    modules: [] as any,
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// ENGINE — 4 cas
// ════════════════════════════════════════════════════════════════════════════

describe('recordVote — up', () => {
  it('direction=up → INSERT OR IGNORE c45_votes + UPDATE upvotes_count+1', async () => {
    const db = createMockD1();
    db.seed('select upvotes_count', [{ c: 5 }]);
    const env = makeEnv(db);

    const res = await recordVote(env, 'thread', 't_1', 'u_member_1', 'ip_hash', 'up');

    expect(res.ok).toBe(true);
    expect(res.newCount).toBe(5);

    // INSERT OR IGNORE into c45_votes appelé.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert or ignore into c45_votes'),
    );
    expect(insert).toBeDefined();
    expect(insert?.args).toEqual([
      expect.any(String),
      'thread',
      't_1',
      'u_member_1',
      'ip_hash',
    ]);

    // UPDATE upvotes_count+1 appelé sur c45_threads.
    const update = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update c45_threads') &&
        c.sql.toLowerCase().includes('upvotes_count = coalesce(upvotes_count, 0) + 1'),
    );
    expect(update).toBeDefined();
    expect(update?.args).toEqual(['t_1']);
  });
});

describe('recordVote — duplicate', () => {
  it('INSERT OR IGNORE changes=0 → pas d\'UPDATE +1', async () => {
    // Mock D1 custom : INSERT OR IGNORE retourne changes=0 (duplicate).
    const calls: Array<{ sql: string; args: any[] }> = [];
    const db = {
      calls,
      prepare(sql: string) {
        let boundArgs: any[] = [];
        return {
          bind(...args: any[]) {
            boundArgs = args;
            return this;
          },
          all() {
            calls.push({ sql, args: boundArgs });
            return { results: [] };
          },
          first() {
            calls.push({ sql, args: boundArgs });
            if (sql.toLowerCase().includes('select upvotes_count')) {
              return { c: 5 };
            }
            return null;
          },
          run() {
            calls.push({ sql, args: boundArgs });
            const lower = sql.toLowerCase();
            // INSERT OR IGNORE → simule duplicate (changes=0).
            if (lower.includes('insert or ignore')) {
              return { success: true, meta: { changes: 0 } };
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
    const env = { DB: db } as unknown as Env;

    const res = await recordVote(env, 'thread', 't_1', 'u_member_1', 'ip_hash', 'up');

    expect(res.ok).toBe(false);
    expect(res.newCount).toBe(5);

    // INSERT OR IGNORE appelé.
    const insert = calls.find((c) =>
      c.sql.toLowerCase().includes('insert or ignore into c45_votes'),
    );
    expect(insert).toBeDefined();

    // UPDATE upvotes_count+1 PAS appelé (duplicate).
    const update = calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update c45_threads') &&
        c.sql.toLowerCase().includes('+ 1'),
    );
    expect(update).toBeUndefined();
  });
});

describe('moderateContent — spam', () => {
  it('body long all caps → autoHide=true (score >= 70)', () => {
    const env = {} as Env;
    const body = 'BUY NOW CHEAP MEDS CLICK HERE LIMITED OFFER URGENT';
    const result = moderateContent(env, body, 'en-US');

    expect(result.spamScore).toBeGreaterThanOrEqual(70);
    expect(result.autoHide).toBe(true);
    expect(result.badWords).toBe(false);
  });

  it('body normal → autoHide=false', () => {
    const env = {} as Env;
    const body = 'Question raisonnable sur le forum, merci.';
    const result = moderateContent(env, body, 'fr-CA');

    expect(result.spamScore).toBeLessThan(70);
    expect(result.autoHide).toBe(false);
  });
});

describe('bumpThreadActivity', () => {
  it('threadId fourni → UPDATE last_activity_at + comments_count+1', async () => {
    const db = createMockD1();
    const env = makeEnv(db);

    await bumpThreadActivity(env, 't_1');

    const update = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update c45_threads') &&
        c.sql.toLowerCase().includes('last_activity_at') &&
        c.sql.toLowerCase().includes('comments_count = coalesce(comments_count, 0) + 1'),
    );
    expect(update).toBeDefined();
    expect(update?.args).toEqual(['t_1']);
  });

  it('threadId vide → no-op (aucun UPDATE)', async () => {
    const db = createMockD1();
    const env = makeEnv(db);

    await bumpThreadActivity(env, '');

    expect(db.calls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — 6 cas
// ════════════════════════════════════════════════════════════════════════════

describe('handleListThreads', () => {
  it('ORDER BY is_pinned DESC, last_activity_at DESC dans le SQL', async () => {
    const db = createMockD1();
    db.seed('from c45_threads', [
      {
        id: 't_1',
        client_id: 'cli_A',
        author_user_id: 'u_1',
        title: 'Bienvenue',
        body: 'corps',
        category: 'general',
        is_pinned: 1,
        is_locked: 0,
        status: 'open',
        upvotes_count: 3,
        comments_count: 2,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const url = new URL('https://app/api/community/threads');

    const res = await handleListThreads(env, auth, url);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('t_1');
    expect(body.data[0].is_pinned).toBe(true);

    const selectCall = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from c45_threads'),
    );
    expect(selectCall).toBeDefined();
    // ORDER BY is_pinned DESC, last_activity_at DESC.
    const sqlLower = selectCall?.sql.toLowerCase() || '';
    expect(sqlLower).toContain('order by is_pinned desc');
    expect(sqlLower).toContain('last_activity_at desc');
    // Bornage tenant.
    expect(selectCall?.args[0]).toBe('cli_A');
    expect(selectCall?.args[1]).toBe('open');
  });
});

describe('handleCreateThread', () => {
  it('moderateContent autoHide=true → INSERT status=hidden', async () => {
    const db = createMockD1();
    // Seed la SELECT post-INSERT (fetchThread).
    db.seed('from c45_threads', [
      {
        id: 'inserted_id',
        client_id: 'cli_A',
        author_user_id: 'u_member_1',
        title: 'TITRE SPAM',
        body: 'BUY NOW CHEAP MEDS CLICK HERE LIMITED OFFER URGENT',
        category: 'general',
        is_pinned: 0,
        is_locked: 0,
        status: 'hidden',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T10:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);
    // SELECT community_banned_at → null (pas banni).
    db.seed('select community_banned_at', [{ community_banned_at: null }]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/community/threads', {
      method: 'POST',
      headers: { 'Accept-Language': 'en-US' },
      body: JSON.stringify({
        title: 'TITRE SPAM',
        body: 'BUY NOW CHEAP MEDS CLICK HERE LIMITED OFFER URGENT',
        category: 'general',
      }),
    });

    const res = await handleCreateThread(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('hidden');

    // INSERT c45_threads avec status='hidden' (7e bind param).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_threads'),
    );
    expect(insert).toBeDefined();
    expect(insert?.args[6]).toBe('hidden');
    // client_id (2e bind).
    expect(insert?.args[1]).toBe('cli_A');
    // author_user_id (3e bind).
    expect(insert?.args[2]).toBe('u_member_1');
  });
});

describe('handleCreateComment — thread locked', () => {
  it('thread is_locked=1 → 423', async () => {
    const db = createMockD1();
    // SELECT community_banned_at → null + thread locked.
    db.seed('select community_banned_at', [{ community_banned_at: null }]);
    db.seed('from c45_threads', [
      {
        id: 't_locked',
        client_id: 'cli_A',
        author_user_id: 'u_other',
        title: 'thread',
        body: 'body',
        category: 'general',
        is_pinned: 0,
        is_locked: 1,
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/community/threads/t_locked/comments', {
      method: 'POST',
      body: JSON.stringify({ body: 'mon commentaire' }),
    });

    const res = await handleCreateComment(req, env, auth, 't_locked');
    expect(res.status).toBe(423);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/verrouill/i);

    // INSERT comment NE DOIT PAS être appelé.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_comments'),
    );
    expect(insert).toBeUndefined();
  });
});

describe('handleVote', () => {
  it('target_type=thread + direction=up → sha256Ip + recordVote → 200', async () => {
    const db = createMockD1();
    db.seed('select community_banned_at', [{ community_banned_at: null }]);
    db.seed('from c45_threads', [
      {
        id: 't_1',
        client_id: 'cli_A',
        author_user_id: 'u_other',
        title: 'thread',
        body: 'body',
        category: 'general',
        is_pinned: 0,
        is_locked: 0,
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);
    db.seed('select upvotes_count', [{ c: 1 }]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/community/vote', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_1',
        direction: 'up',
      }),
    });

    const res = await handleVote(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.target_type).toBe('thread');
    expect(body.data.target_id).toBe('t_1');
    expect(body.data.direction).toBe('up');
    expect(body.data.ok).toBe(true);
    expect(typeof body.data.newCount).toBe('number');

    // recordVote → INSERT OR IGNORE c45_votes.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert or ignore into c45_votes'),
    );
    expect(insert).toBeDefined();
    // voter_ip_hash bind (5e arg) doit être un hash sha256 32 hex chars.
    const ipHash = insert?.args[4];
    expect(typeof ipHash).toBe('string');
    expect(ipHash).toMatch(/^[0-9a-f]{32}$/);
    // PAS l'IP brute.
    expect(ipHash).not.toBe('1.2.3.4');
  });
});

describe('handleModerateTarget — ban', () => {
  it('action=ban sur thread → UPDATE users SET community_banned_at', async () => {
    const db = createMockD1();
    db.seed('from c45_threads', [
      {
        id: 't_1',
        client_id: 'cli_A',
        author_user_id: 'u_culprit',
        title: 'thread',
        body: 'body',
        category: 'general',
        is_pinned: 0,
        is_locked: 0,
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAdminAuth();
    const req = new Request('https://app/api/community/moderation', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_1',
        action: 'ban',
        reason: 'spam',
      }),
    });

    const res = await handleModerateTarget(req, env, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.action).toBe('ban');
    expect(body.data.authorUserId).toBe('u_culprit');

    // INSERT c45_moderation_actions appelé.
    const insertMod = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_moderation_actions'),
    );
    expect(insertMod).toBeDefined();
    // action enum (4e bind).
    expect(insertMod?.args[3]).toBe('ban');

    // UPDATE users SET community_banned_at.
    const updateUsers = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update users') &&
        c.sql.toLowerCase().includes('community_banned_at = datetime'),
    );
    expect(updateUsers).toBeDefined();
    expect(updateUsers?.args).toEqual(['u_culprit']);
  });
});

describe('Cap check — leads.write / settings.manage absent', () => {
  it('handleListThreads sans leads.write → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth({ capabilities: new Set() });
    const url = new URL('https://app/api/community/threads');

    const res = await handleListThreads(env, auth, url);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun SELECT c45_threads (cap court-circuite).
    const selectCall = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from c45_threads'),
    );
    expect(selectCall).toBeUndefined();
  });

  it('handleModerateTarget sans settings.manage → 403', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Membre standard : leads.write OK mais PAS settings.manage.
    const auth = makeAuth();
    const req = new Request('https://app/api/community/moderation', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_1',
        action: 'ban',
      }),
    });

    const res = await handleModerateTarget(req, env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/refus/i);

    // Aucun INSERT moderation_actions.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_moderation_actions'),
    );
    expect(insert).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RENFORCEMENT Phase B+ (2026-05-25)
// ════════════════════════════════════════════════════════════════════════════

describe('sanitizeBody — XSS strip', () => {
  it('strip <script> block + contenu', () => {
    const input = 'Hello <script>alert(1)</script> world';
    const out = sanitizeBody(input);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('strip <iframe> + contenu', () => {
    const input = 'Pre <iframe src="https://evil.com">x</iframe> Post';
    const out = sanitizeBody(input);
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.com');
    expect(out).toContain('Pre');
    expect(out).toContain('Post');
  });

  it('strip on*= handlers (onclick, onerror, onload)', () => {
    const input = '<img src="x" onerror="alert(1)" onclick=\'bad()\'>';
    const out = sanitizeBody(input);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('bad()');
  });

  it('strip javascript: dans href', () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const out = sanitizeBody(input);
    // Le href est neutralisé (remplacé par #) ET le mot-clé "javascript:"
    // est lui-même strip dans le pass orphelin (defense-in-depth).
    expect(out).not.toMatch(/javascript\s*:/i);
    expect(out).toContain('click');
  });

  it('valid markdown + liens https:// préservés', () => {
    const input =
      '# Titre\n\nParagraphe avec [lien](https://example.com) et **gras**.';
    const out = sanitizeBody(input);
    expect(out).toContain('# Titre');
    expect(out).toContain('[lien]');
    expect(out).toContain('https://example.com');
    expect(out).toContain('**gras**');
  });

  it('input non-string → string vide (no throw)', () => {
    expect(sanitizeBody(undefined as unknown as string)).toBe('');
    expect(sanitizeBody(null as unknown as string)).toBe('');
    expect(sanitizeBody(123 as unknown as string)).toBe('');
  });
});

describe('hashIp — déterministe + salt-sensitive', () => {
  it('même IP + même salt → même hash 32 hex', async () => {
    const h1 = await hashIp('1.2.3.4', 'salt-a');
    const h2 = await hashIp('1.2.3.4', 'salt-a');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('même IP + salts différents → hashes différents', async () => {
    const h1 = await hashIp('1.2.3.4', 'salt-a');
    const h2 = await hashIp('1.2.3.4', 'salt-b');
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(h2).toMatch(/^[0-9a-f]{32}$/);
  });

  it('IP vide → string vide', async () => {
    const h = await hashIp('', 'salt');
    expect(h).toBe('');
  });

  it('jamais IP brute en clair dans le hash (Loi 25)', async () => {
    const h = await hashIp('192.168.1.100', 'whatever');
    expect(h).not.toContain('192.168');
    expect(h).not.toContain('1.100');
  });
});

describe('validateThreadInput', () => {
  it('valide → ok=true + data', () => {
    const res = validateThreadInput({
      title: 'Bonjour forum',
      body: 'Mon premier post',
      category: 'question',
    });
    expect(res.ok).toBe(true);
    expect(res.data?.title).toBe('Bonjour forum');
    expect(res.data?.body).toBe('Mon premier post');
    expect(res.data?.category).toBe('question');
  });

  it('title vide → INVALID_INPUT field=title', () => {
    const res = validateThreadInput({ title: '', body: 'corps' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(COMMUNITY_ERROR_CODES.INVALID_INPUT);
    expect(res.field).toBe('title');
  });

  it('body vide → INVALID_INPUT field=body', () => {
    const res = validateThreadInput({ title: 'titre', body: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(COMMUNITY_ERROR_CODES.INVALID_INPUT);
    expect(res.field).toBe('body');
  });

  it('body > 10000 chars → tronqué (pas erreur, slice ok)', () => {
    const longBody = 'x'.repeat(15000);
    const res = validateThreadInput({ title: 'titre', body: longBody });
    expect(res.ok).toBe(true);
    expect(res.data?.body.length).toBe(10000);
  });

  it('category inconnue → fallback general', () => {
    const res = validateThreadInput({
      title: 'titre',
      body: 'corps',
      category: 'inexistante',
    });
    expect(res.ok).toBe(true);
    expect(res.data?.category).toBe('general');
  });

  it('body avec <script> → sanitisé (script strip)', () => {
    const res = validateThreadInput({
      title: 'titre',
      body: 'Hello <script>alert(1)</script> world',
    });
    expect(res.ok).toBe(true);
    expect(res.data?.body).not.toContain('<script');
    expect(res.data?.body).not.toContain('alert(1)');
  });

  it('input null → INVALID_INPUT', () => {
    const res = validateThreadInput(null);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(COMMUNITY_ERROR_CODES.INVALID_INPUT);
  });
});

describe('validateCommentInput', () => {
  it('body valide + pas de parent → ok', () => {
    const res = validateCommentInput({ body: 'mon comment' }, 't_1');
    expect(res.ok).toBe(true);
    expect(res.data?.body).toBe('mon comment');
    expect(res.data?.parentCommentId).toBeNull();
  });

  it('body vide → INVALID_INPUT', () => {
    const res = validateCommentInput({ body: '' }, 't_1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(COMMUNITY_ERROR_CODES.INVALID_INPUT);
  });

  it('threadId vide → INVALID_INPUT field=thread_id', () => {
    const res = validateCommentInput({ body: 'ok' }, '');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(COMMUNITY_ERROR_CODES.INVALID_INPUT);
    expect(res.field).toBe('thread_id');
  });

  it('parent_comment_id slice à 64 chars', () => {
    const longId = 'p'.repeat(200);
    const res = validateCommentInput(
      { body: 'reply', parent_comment_id: longId },
      't_1',
    );
    expect(res.ok).toBe(true);
    expect(res.data?.parentCommentId?.length).toBe(64);
  });
});

describe('canModerate', () => {
  it('cap settings.manage → true', () => {
    expect(canModerate({ capabilities: new Set(['settings.manage']) })).toBe(
      true,
    );
  });

  it('role=admin sans cap → true', () => {
    expect(canModerate({ role: 'admin' })).toBe(true);
  });

  it('membre standard → false', () => {
    expect(
      canModerate({ capabilities: new Set(['leads.write']), role: 'member' }),
    ).toBe(false);
  });

  it('auth vide → false', () => {
    expect(canModerate({} as { capabilities?: Set<string>; role?: string })).toBe(
      false,
    );
  });
});

describe('canTransitionStatus — whitelist threads/comments', () => {
  it('thread open → hidden OK', () => {
    expect(canTransitionStatus('thread', 'open', 'hidden')).toBe(true);
  });

  it('thread hidden → open OK (unhide)', () => {
    expect(canTransitionStatus('thread', 'hidden', 'open')).toBe(true);
  });

  it('thread deleted → open REFUS (terminal)', () => {
    expect(canTransitionStatus('thread', 'deleted', 'open')).toBe(false);
  });

  it('comment visible → deleted OK', () => {
    expect(canTransitionStatus('comment', 'visible', 'deleted')).toBe(true);
  });

  it('comment deleted → visible REFUS (terminal)', () => {
    expect(canTransitionStatus('comment', 'deleted', 'visible')).toBe(false);
  });

  it('from inconnu → false', () => {
    expect(canTransitionStatus('thread', 'unknown_status', 'open')).toBe(false);
  });
});

describe('checkVoteRateLimit — KV sliding window', () => {
  function makeKV(state: Map<string, string>) {
    return {
      get: vi.fn(async (k: string) => state.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => {
        state.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        state.delete(k);
      }),
    };
  }

  it('aucun KV configuré → ok=true (best-effort)', async () => {
    const env = { DB: createMockD1() } as unknown as Env;
    const res = await checkVoteRateLimit(env, 'u_1', 'ip_h');
    expect(res.ok).toBe(true);
  });

  it('5 votes OK, 6e → RATE_LIMITED', async () => {
    const state = new Map<string, string>();
    const kv = makeKV(state);
    const env = {
      DB: createMockD1(),
      RATE_LIMITER: kv as unknown as KVNamespace,
    } as unknown as Env;

    for (let i = 0; i < 5; i++) {
      const r = await checkVoteRateLimit(env, 'u_1', null);
      expect(r.ok).toBe(true);
    }
    // 6e tentative → bloque.
    const r6 = await checkVoteRateLimit(env, 'u_1', null);
    expect(r6.ok).toBe(false);
    expect(r6.retryAfter).toBeGreaterThan(0);
  });

  it('panne KV .get → ok=true (degradation gracieuse)', async () => {
    const kv = {
      get: vi.fn(async () => {
        throw new Error('KV down');
      }),
      put: vi.fn(),
    };
    const env = {
      DB: createMockD1(),
      RATE_LIMITER: kv as unknown as KVNamespace,
    } as unknown as Env;

    const r = await checkVoteRateLimit(env, 'u_1', 'h');
    expect(r.ok).toBe(true);
  });
});

describe('Cross-tenant isolation — handleModerateTarget', () => {
  it('mod tenant A ne trouve PAS thread tenant B → 404 (pas 500)', async () => {
    const db = createMockD1();
    // Pas de seed `from c45_threads` → la query retournera []
    // (fetchThread → null car bornage `WHERE client_id = ?` filtre tout).
    // Donc même si l'admin envoie un target_id appartenant à un autre tenant,
    // la sélection avec clientId='cli_A' renvoie null → 404.
    const env = makeEnv(db);
    const auth = makeAdminAuth(); // clientId résolu = cli_A (mock getClientModules).
    const req = new Request('https://app/api/community/moderation', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_BELONGS_TO_OTHER_TENANT',
        action: 'hide',
      }),
    });

    const res = await handleModerateTarget(req, env, auth);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/introuvable/i);

    // Le SELECT a bien le bind client_id='cli_A' (defense-in-depth).
    const selectCall = db.calls.find((c) =>
      c.sql.toLowerCase().includes('from c45_threads'),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall?.args).toContain('cli_A');
    expect(selectCall?.args).toContain('t_BELONGS_TO_OTHER_TENANT');

    // Aucune mutation status n'a eu lieu sur c45_threads (UPDATE ... SET status).
    const updateCall = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update c45_threads') &&
        c.sql.toLowerCase().includes('set status'),
    );
    expect(updateCall).toBeUndefined();
  });
});

describe('Locked thread → comment refusé (deja couvert mais re-affirme code 423)', () => {
  it('thread locked → response status 423 + INSERT bloqué + error msg', async () => {
    const db = createMockD1();
    db.seed('select community_banned_at', [{ community_banned_at: null }]);
    db.seed('from c45_threads', [
      {
        id: 't_locked2',
        client_id: 'cli_A',
        author_user_id: 'u_other',
        title: 'locked',
        body: 'b',
        category: 'general',
        is_pinned: 0,
        is_locked: 1, // verrou actif
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request(
      'https://app/api/community/threads/t_locked2/comments',
      {
        method: 'POST',
        body: JSON.stringify({ body: 'reply' }),
      },
    );
    const res = await handleCreateComment(req, env, auth, 't_locked2');
    expect(res.status).toBe(423);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/verrouill/i);

    // Aucun INSERT comment.
    const insertComment = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_comments'),
    );
    expect(insertComment).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTÉGRATION HANDLER ↔ ENGINE (Phase B+ wire-up, 2026-05-25) — 5 cas
// ════════════════════════════════════════════════════════════════════════════

describe('handleCreateThread — XSS sanitized via engine', () => {
  it('body avec <script> → INSERT body sans <script> (defense-in-depth)', async () => {
    const db = createMockD1();
    db.seed('select community_banned_at', [{ community_banned_at: null }]);
    db.seed('from c45_threads', [
      {
        id: 'inserted_id',
        client_id: 'cli_A',
        author_user_id: 'u_member_1',
        title: 'Titre OK',
        body: 'Hello  world',
        category: 'general',
        is_pinned: 0,
        is_locked: 0,
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T10:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/community/threads', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Titre OK',
        body: 'Hello <script>alert(1)</script> world',
        category: 'general',
      }),
    });

    const res = await handleCreateThread(req, env, auth);
    expect(res.status).toBe(200);

    // INSERT bound 5e param (body) doit être sanitisé.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_threads'),
    );
    expect(insert).toBeDefined();
    const insertedBody = String(insert?.args[4] ?? '');
    expect(insertedBody).not.toContain('<script');
    expect(insertedBody).not.toContain('alert(1)');
    expect(insertedBody).toContain('Hello');
    expect(insertedBody).toContain('world');
  });
});

describe('handleCreateThread — title vide via engine validation', () => {
  it('title vide → 400 (INVALID_INPUT via engine) + pas d\'INSERT', async () => {
    const db = createMockD1();
    db.seed('select community_banned_at', [{ community_banned_at: null }]);

    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/community/threads', {
      method: 'POST',
      body: JSON.stringify({
        title: '   ', // trim() → vide
        body: 'corps valide',
        category: 'general',
      }),
    });

    const res = await handleCreateThread(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();

    // Aucun INSERT c45_threads (engine validation court-circuite).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_threads'),
    );
    expect(insert).toBeUndefined();
  });
});

describe('handleVote — 6e vote/min → RATE_LIMITED via engine', () => {
  it('checkVoteRateLimit retourne ok=false → 429 + pas d\'INSERT vote', async () => {
    // KV state pre-rempli avec 5 votes pour l'user (saturation).
    const state = new Map<string, string>();
    state.set('c45_vote:u:u_member_1', '5');

    const kv = {
      get: vi.fn(async (k: string) => state.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => {
        state.set(k, v);
      }),
    };

    const db = createMockD1();
    db.seed('select community_banned_at', [{ community_banned_at: null }]);
    db.seed('from c45_threads', [
      {
        id: 't_1',
        client_id: 'cli_A',
        author_user_id: 'u_other',
        title: 't',
        body: 'b',
        category: 'general',
        is_pinned: 0,
        is_locked: 0,
        status: 'open',
        upvotes_count: 0,
        comments_count: 0,
        last_activity_at: '2026-05-25T10:00:00Z',
        created_at: '2026-05-25T09:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]);

    const env = {
      DB: db,
      RATE_LIMITER: kv as unknown as KVNamespace,
      COMMUNITY_SALT: 'test-salt',
    } as unknown as Env;
    const auth = makeAuth();
    const req = new Request('https://app/api/community/vote', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_1',
        direction: 'up',
      }),
    });

    const res = await handleVote(req, env, auth);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trop|r[ée]essayez/i);

    // Pas d'INSERT OR IGNORE c45_votes (rate-limit court-circuite recordVote).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert or ignore into c45_votes'),
    );
    expect(insert).toBeUndefined();
  });
});

describe('handleModerateTarget — canModerate via engine', () => {
  it('auth sans cap settings.manage NI role=admin → 403 (MODERATOR_REQUIRED)', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    // Auth membre standard (leads.write seul) — modCapGuard court-circuite.
    // canModerate engine confirme (defense-in-depth).
    const auth = makeAuth({ capabilities: new Set(['leads.write']) });
    const req = new Request('https://app/api/community/moderation', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'thread',
        target_id: 't_1',
        action: 'hide',
      }),
    });

    const res = await handleModerateTarget(req, env, auth);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/refus/i);

    // Aucun INSERT moderation_actions.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_moderation_actions'),
    );
    expect(insert).toBeUndefined();
  });
});

describe('handleCreateComment — parent nested → DEPTH_EXCEEDED via engine', () => {
  it('parent_comment_id avec parent.parent_comment_id != NULL → 400 + pas d\'INSERT', async () => {
    // Mock D1 custom : SELECT parent comment retourne pcid='p_grandparent'
    // (= parent EST déjà une réponse → depth 2 refusée).
    const calls: Array<{ sql: string; args: any[] }> = [];
    const db = {
      calls,
      prepare(sql: string) {
        let boundArgs: any[] = [];
        return {
          bind(...args: any[]) {
            boundArgs = args;
            return this;
          },
          all() {
            calls.push({ sql, args: boundArgs });
            return { results: [] };
          },
          first() {
            calls.push({ sql, args: boundArgs });
            const lower = sql.toLowerCase();
            if (lower.includes('select community_banned_at')) {
              return { community_banned_at: null };
            }
            if (lower.includes('from c45_threads')) {
              return {
                id: 't_1',
                client_id: 'cli_A',
                author_user_id: 'u_other',
                title: 't',
                body: 'b',
                category: 'general',
                is_pinned: 0,
                is_locked: 0,
                status: 'open',
                upvotes_count: 0,
                comments_count: 0,
                last_activity_at: '2026-05-25T10:00:00Z',
                created_at: '2026-05-25T09:00:00Z',
                updated_at: '2026-05-25T10:00:00Z',
              };
            }
            if (lower.includes('select parent_comment_id as pcid')) {
              // Parent IS déjà une réponse (pcid pointe vers grand-parent).
              return { pcid: 'p_grandparent' };
            }
            return null;
          },
          run() {
            calls.push({ sql, args: boundArgs });
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
    const env = { DB: db } as unknown as Env;
    const auth = makeAuth();
    const req = new Request(
      'https://app/api/community/threads/t_1/comments',
      {
        method: 'POST',
        body: JSON.stringify({
          body: 'ma reponse niveau 2',
          parent_comment_id: 'p_parent',
        }),
      },
    );

    const res = await handleCreateComment(req, env, auth, 't_1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/profondeur|d[ée]pass/i);

    // Aucun INSERT c45_comments (depth check court-circuite).
    const insert = calls.find((c) =>
      c.sql.toLowerCase().includes('insert into c45_comments'),
    );
    expect(insert).toBeUndefined();
  });
});
