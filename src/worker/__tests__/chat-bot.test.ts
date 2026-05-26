// ── chat-bot.test.ts — Sprint 51 Agent T42 ─────────────────────────────────
// Tests vitest pour Sprint 42 AI Chat Agent. Couvre ~10 cas :
//
//  Engine (5) :
//   1. searchKnowledge LIKE simple        → 2 rows mockées
//   2. searchKnowledge multi-mot          → OR clauses + dedup
//   3. buildBotPrompt structure           → system + KB + history + user
//   4. runBotInference no AI binding      → flag INACTIF
//   5. shouldEscalateChat keyword match   → true même si confidence haute
//
//  Handlers (5) :
//   6. handleCreateKnowledge body OK      → INSERT + 200
//   7. handleGetConfig auto-create        → INSERT defaults puis return
//   8. handleUpdateConfig upsert UPDATE   → ligne existante → UPDATE
//   9. handleTestBot end-to-end           → response + confidence + flags
//  10. Cap check sans settings.manage     → 403
//
// Mock D1 minimal + AI binding stub. ZÉRO réseau, ZÉRO API key.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';

// ── Mocks AVANT imports SUT ────────────────────────────────────────────────
vi.mock('../helpers', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    audit: vi.fn(async () => undefined),
  };
});

import {
  searchKnowledge,
  buildBotPrompt,
  runBotInference,
  shouldEscalateChat,
  cosineSimilarity,
  mockEmbedding,
  retrieveTopK,
  buildPrompt,
  detectEscalation,
  scrubPii,
  checkChatRateLimit,
  truncateContext,
  EMBEDDING_DIM,
  CHAT_RATE_LIMIT,
  CHAT_BOT_ERROR_CODES,
} from '../lib/chat-bot-engine';
import {
  handleCreateKnowledge,
  handleGetConfig,
  handleUpdateConfig,
  handleTestBot,
  handleListKnowledge,
} from '../chat-bot';

// ── Mock D1 minimal ────────────────────────────────────────────────────────
type AnyRow = Record<string, unknown>;

interface MockDbState {
  /** Rows pour SELECT FROM chat_knowledge_base (search/list). */
  kbRows: AnyRow[];
  /** Row config existante (null = absent → auto-insert). */
  configRow: AnyRow | null;
  /** client_id du user courant (resolveClientId). */
  userClientId: string | null;
  /** modules_json renvoyé par clients. */
  modulesJson: string;
}

interface MockDb {
  prepare: ReturnType<typeof vi.fn>;
  __calls: Array<{ sql: string; args: unknown[] }>;
  __state: MockDbState;
}

function makeDb(initialState: Partial<MockDbState> = {}): MockDb {
  const state: MockDbState = {
    kbRows: initialState.kbRows ?? [],
    configRow: initialState.configRow ?? null,
    userClientId: initialState.userClientId ?? 'client-A',
    modulesJson: initialState.modulesJson ?? '["crm"]',
  };
  const calls: Array<{ sql: string; args: unknown[] }> = [];

  const db: MockDb = {
    __calls: calls,
    __state: state,
    prepare: vi.fn((sql: string) => {
      let boundArgs: unknown[] = [];
      const lower = sql.toLowerCase();
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        first: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.includes('select client_id from users')) {
            return state.userClientId !== null
              ? { client_id: state.userClientId }
              : null;
          }
          if (lower.includes('select modules_json from clients')) {
            return { modules_json: state.modulesJson };
          }
          if (
            lower.includes('from chat_bot_config') &&
            lower.includes('where client_id')
          ) {
            return state.configRow;
          }
          if (
            lower.includes('from chat_knowledge_base') &&
            lower.includes('where id = ?')
          ) {
            const id = String(boundArgs[0] ?? '');
            const found = state.kbRows.find((r) => String(r.id ?? '') === id);
            return found ?? null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.includes('from chat_knowledge_base')) {
            // Filter by client_id (1er bind)
            const clientId = String(boundArgs[0] ?? '');
            const rows = state.kbRows.filter(
              (r) => String(r.client_id ?? '') === clientId,
            );
            return { results: rows };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          // Simule INSERT chat_knowledge_base : ajoute la row au state pour cohérence.
          if (
            lower.startsWith('insert into chat_knowledge_base') ||
            lower.includes('insert into chat_knowledge_base')
          ) {
            // bind ordre : id, clientId, title, content, source, now, now
            state.kbRows.push({
              id: boundArgs[0],
              client_id: boundArgs[1],
              title: boundArgs[2],
              content: boundArgs[3],
              source: boundArgs[4],
              is_active: 1,
              created_at: boundArgs[5],
              updated_at: boundArgs[6],
            });
          }
          if (lower.startsWith('insert into chat_bot_config')) {
            state.configRow = {
              id: boundArgs[0],
              client_id: boundArgs[1],
              widget_id: null,
              system_prompt: boundArgs[2],
              confidence_threshold: boundArgs[3],
              escalation_message: boundArgs[4],
              enabled: boundArgs[5],
              max_messages_per_session: boundArgs[6],
            };
          }
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        }),
      };
      return stmt;
    }),
  };
  return db;
}

function makeEnv(opts: {
  db?: MockDb;
  ai?: { run: (model: string, args: unknown) => Promise<unknown> } | null;
} = {}): { env: Env; db: MockDb } {
  const db = opts.db ?? makeDb({});
  const env: Record<string, unknown> = { DB: db };
  if (opts.ai !== null && opts.ai !== undefined) {
    env.AI = opts.ai;
  }
  return { env: env as unknown as Env, db };
}

function postReq(body: Record<string, unknown>): Request {
  return new Request('http://x/api/chat-bot/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const adminAuth = {
  userId: 'user-A',
  role: 'admin',
  capabilities: new Set(['settings.manage']),
};

const unprivilegedAuth = {
  userId: 'user-B',
  role: 'viewer',
  capabilities: new Set<string>(['contacts.read']),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// ENGINE — 5 cas
// ──────────────────────────────────────────────────────────────────────────
describe('S42 engine — searchKnowledge', () => {
  it('1. LIKE simple : query 1-token → return 2 rows', async () => {
    const db = makeDb({
      kbRows: [
        {
          id: 'kb-1',
          client_id: 'client-A',
          title: 'Pricing',
          content: 'Our pricing is fair',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
        {
          id: 'kb-2',
          client_id: 'client-A',
          title: 'About',
          content: 'About our pricing model',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-03',
        },
      ],
    });
    const { env } = makeEnv({ db });
    const results = await searchKnowledge(env, 'client-A', 'pricing');

    expect(results.length).toBe(2);
    expect(results.map((r) => r.id).sort()).toEqual(['kb-1', 'kb-2']);
    // Vérifie qu'une seule requête LIKE %query% a été préparée (single token).
    const sqlCalls = db.__calls.filter((c) =>
      c.sql.toLowerCase().includes('from chat_knowledge_base'),
    );
    expect(sqlCalls.length).toBe(1);
    // bind : clientId, like, like (3 args)
    expect(sqlCalls[0].args.length).toBe(3);
    expect(sqlCalls[0].args[1]).toBe('%pricing%');
  });

  it('2. Multi-mot : query "pricing plans" → tokens split → OR clauses dedup', async () => {
    const db = makeDb({
      kbRows: [
        {
          id: 'kb-multi',
          client_id: 'client-A',
          title: 'Pricing plans',
          content: 'Various plans available',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
      ],
    });
    const { env } = makeEnv({ db });
    const results = await searchKnowledge(env, 'client-A', 'pricing plans');

    // 1 seule requête OR multi-token (pas 2)
    const sqlCalls = db.__calls.filter((c) =>
      c.sql.toLowerCase().includes('from chat_knowledge_base'),
    );
    expect(sqlCalls.length).toBe(1);
    // 2 tokens × 2 LIKE binds = 4 + clientId = 5 args
    expect(sqlCalls[0].args.length).toBe(5);
    expect(sqlCalls[0].args[0]).toBe('client-A');
    expect(sqlCalls[0].args).toContain('%pricing%');
    expect(sqlCalls[0].args).toContain('%plans%');
    // OR clauses présents
    expect(sqlCalls[0].sql).toMatch(/OR LOWER\(title\) LIKE/);
    // Dedup : row apparaît 1× même si matche 2 tokens
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('kb-multi');
  });
});

describe('S42 engine — buildBotPrompt', () => {
  it('3. Structure : system_prompt + KB + history + user', () => {
    const config = { system_prompt: 'You are Buteau bot.' };
    const kb = [
      {
        id: 'k1',
        client_id: 'c',
        title: 'Hours',
        content: 'Mon-Fri 9-5',
        source: 'manual' as const,
        is_active: true,
        created_at: '',
      },
      {
        id: 'k2',
        client_id: 'c',
        title: 'Pricing',
        content: 'Variable rates',
        source: 'faq' as const,
        is_active: true,
        created_at: '',
      },
    ];
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'When open?' },
      { role: 'assistant', content: 'Mon-Fri 9-5.' },
    ];
    const prompt = buildBotPrompt(config, kb, history, 'And pricing?');

    expect(prompt).toContain('You are Buteau bot.');
    expect(prompt).toContain('Knowledge base context:');
    expect(prompt).toContain('- Hours: Mon-Fri 9-5');
    expect(prompt).toContain('- Pricing: Variable rates');
    expect(prompt).toContain('Conversation history:');
    expect(prompt).toContain('User: Hi');
    expect(prompt).toContain('Assistant: Hello!');
    expect(prompt).toContain('User: When open?');
    expect(prompt).toContain('Assistant: Mon-Fri 9-5.');
    expect(prompt).toMatch(/User: And pricing\?\nAssistant:$/);
  });
});

describe('S42 engine — runBotInference', () => {
  it('4. No AI binding → flag INACTIF { response: "Le bot n\'est pas configuré.", confidence: 0 }', async () => {
    const { env } = makeEnv({ ai: null });
    const result = await runBotInference(env, 'any prompt');
    expect(result.response).toBe("Le bot n'est pas configuré.");
    expect(result.confidence).toBe(0);
  });
});

describe('S42 engine — shouldEscalateChat', () => {
  it('5. Confidence 0.85 (above threshold) + keyword "real person" → escalade TRUE', () => {
    // Confidence haute = ne déclenche pas. SEUL le keyword force l'escalade.
    const escalated = shouldEscalateChat(
      0.85,
      0.7,
      'I want to talk to a real person',
    );
    expect(escalated).toBe(true);
  });

  it('5b. Confidence haute + message neutre → pas d\'escalade (sanity)', () => {
    const escalated = shouldEscalateChat(0.85, 0.7, 'What are your hours?');
    expect(escalated).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// HANDLERS — 5 cas
// ──────────────────────────────────────────────────────────────────────────
describe('S42 handlers — handleCreateKnowledge', () => {
  it('6. Body { title, content, source: manual } → INSERT + 200', async () => {
    const db = makeDb({ userClientId: 'client-A' });
    const { env } = makeEnv({ db });
    const req = postReq({
      title: 'FAQ entry',
      content: 'Our hours are Mon-Fri.',
      source: 'manual',
    });
    const res = await handleCreateKnowledge(req, env, adminAuth as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { title?: string; source?: string; client_id?: string };
    };
    expect(body.data?.title).toBe('FAQ entry');
    expect(body.data?.source).toBe('manual');
    expect(body.data?.client_id).toBe('client-A');

    // Vérifie qu'un INSERT a été émis
    const insertCall = db.__calls.find((c) =>
      c.sql.toLowerCase().includes('insert into chat_knowledge_base'),
    );
    expect(insertCall).toBeDefined();
    // Bind ordre : id, client_id, title, content, source, now, now
    expect(insertCall?.args[1]).toBe('client-A');
    expect(insertCall?.args[2]).toBe('FAQ entry');
    expect(insertCall?.args[4]).toBe('manual');
  });
});

describe('S42 handlers — handleGetConfig', () => {
  it('7. Pas de config existante → INSERT defaults puis return', async () => {
    const db = makeDb({ userClientId: 'client-A', configRow: null });
    const { env } = makeEnv({ db });
    const res = await handleGetConfig(env, adminAuth as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        client_id?: string;
        system_prompt?: string;
        confidence_threshold?: number;
        enabled?: boolean;
        max_messages_per_session?: number;
      };
    };
    expect(body.data?.client_id).toBe('client-A');
    expect(body.data?.system_prompt).toBe('You are a helpful assistant.');
    expect(body.data?.confidence_threshold).toBe(0.7);
    expect(body.data?.enabled).toBe(false);
    expect(body.data?.max_messages_per_session).toBe(20);

    // Vérifie qu'un INSERT a été émis (auto-create)
    const insertCall = db.__calls.find((c) =>
      c.sql.toLowerCase().includes('insert into chat_bot_config'),
    );
    expect(insertCall).toBeDefined();
  });
});

describe('S42 handlers — handleUpdateConfig', () => {
  it('8. Config exists → UPDATE (pas INSERT)', async () => {
    const db = makeDb({
      userClientId: 'client-A',
      configRow: {
        id: 'cfg-1',
        client_id: 'client-A',
        widget_id: null,
        system_prompt: 'Old prompt',
        confidence_threshold: 0.7,
        escalation_message: 'Old msg',
        enabled: 0,
        max_messages_per_session: 20,
      },
    });
    const { env } = makeEnv({ db });
    const req = new Request('http://x/api/chat-bot/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: 'New prompt',
        confidence_threshold: 0.85,
        enabled: true,
      }),
    });
    const res = await handleUpdateConfig(req, env, adminAuth as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        system_prompt?: string;
        confidence_threshold?: number;
        enabled?: boolean;
      };
    };
    expect(body.data?.system_prompt).toBe('New prompt');
    expect(body.data?.confidence_threshold).toBe(0.85);
    expect(body.data?.enabled).toBe(true);

    // Vérifie UPDATE pas INSERT
    const updateCall = db.__calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update chat_bot_config') &&
        c.sql.toLowerCase().includes('set'),
    );
    expect(updateCall).toBeDefined();
    const insertCall = db.__calls.find((c) =>
      c.sql.toLowerCase().includes('insert into chat_bot_config'),
    );
    expect(insertCall).toBeUndefined();
  });
});

describe('S42 handlers — handleTestBot end-to-end', () => {
  it('9. Load config + searchKnowledge + buildBotPrompt + runBotInference', async () => {
    const db = makeDb({
      userClientId: 'client-A',
      configRow: {
        id: 'cfg-1',
        client_id: 'client-A',
        widget_id: null,
        system_prompt: 'Custom prompt',
        confidence_threshold: 0.7,
        escalation_message: 'Escalating...',
        enabled: 1,
        max_messages_per_session: 20,
      },
      kbRows: [
        {
          id: 'kb-h',
          client_id: 'client-A',
          title: 'Hours',
          content: 'Mon-Fri 9-5',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
      ],
    });

    // AI stub : retourne réponse haute confidence
    const aiRun = vi.fn(async () => ({
      response: 'Our hours are Mon-Fri 9-5.',
    }));
    const { env } = makeEnv({ db, ai: { run: aiRun } });

    const req = postReq({ message: 'What are your hours?' });
    const res = await handleTestBot(req, env, adminAuth as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        response?: string;
        confidence?: number;
        would_escalate?: boolean;
        kb_matched?: number;
      };
    };
    expect(body.data?.response).toBe('Our hours are Mon-Fri 9-5.');
    expect(body.data?.confidence).toBe(0.85);
    expect(body.data?.would_escalate).toBe(false);
    expect(body.data?.kb_matched).toBe(1);

    // Vérifie que AI.run a été appelé avec le prompt incluant le system_prompt custom
    expect(aiRun).toHaveBeenCalledTimes(1);
    const aiArgs = aiRun.mock.calls[0][1] as {
      messages: Array<{ content: string }>;
    };
    expect(aiArgs.messages[0].content).toContain('Custom prompt');
    expect(aiArgs.messages[0].content).toContain('Hours');
    expect(aiArgs.messages[0].content).toContain('Mon-Fri 9-5');
    expect(aiArgs.messages[0].content).toContain('User: What are your hours?');
  });
});

describe('S42 handlers — capability check', () => {
  it('10. Sans settings.manage → 403 sur chaque handler', async () => {
    const { env } = makeEnv({});

    // handleListKnowledge
    const res1 = await handleListKnowledge(env, unprivilegedAuth as never);
    expect(res1.status).toBe(403);

    // handleCreateKnowledge
    const res2 = await handleCreateKnowledge(
      postReq({ title: 't', content: 'c' }),
      env,
      unprivilegedAuth as never,
    );
    expect(res2.status).toBe(403);

    // handleGetConfig
    const res3 = await handleGetConfig(env, unprivilegedAuth as never);
    expect(res3.status).toBe(403);

    // handleUpdateConfig
    const res4 = await handleUpdateConfig(
      postReq({ system_prompt: 'x' }),
      env,
      unprivilegedAuth as never,
    );
    expect(res4.status).toBe(403);

    // handleTestBot
    const res5 = await handleTestBot(
      postReq({ message: 'hi' }),
      env,
      unprivilegedAuth as never,
    );
    expect(res5.status).toBe(403);

    // Vérifie body { error }
    const body1 = (await res1.json()) as { error?: string };
    expect(body1.error).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// ENGINE RENFORCEMENT — RAG / safety / rate-limit (additif)
// ──────────────────────────────────────────────────────────────────────────

describe('S42 engine — cosineSimilarity', () => {
  it('11. Identical vectors → 1', () => {
    const a = [1, 2, 3];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it('12. Orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('13. Opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6);
  });

  it('14. Length mismatch → 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('15. Empty / zero-norm / non-finite → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([NaN, 1], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, Infinity], [1, 2])).toBe(0);
  });

  it('15b. Clamp défensif [-1, 1] sur flottants', () => {
    const sim = cosineSimilarity([0.5, 0.5], [0.5, 0.5]);
    expect(sim).toBeLessThanOrEqual(1);
    expect(sim).toBeGreaterThanOrEqual(-1);
  });
});

describe('S42 engine — mockEmbedding', () => {
  it('16. Déterministe : même texte → même vecteur', () => {
    const v1 = mockEmbedding('horaires ouverture');
    const v2 = mockEmbedding('horaires ouverture');
    expect(v1).toEqual(v2);
  });

  it('17. Longueur = EMBEDDING_DIM (1536)', () => {
    const v = mockEmbedding('quelconque texte');
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(1536);
  });

  it('18. Valeurs bornées [-1, 1]', () => {
    const v = mockEmbedding('Lorem ipsum dolor sit amet consectetur adipiscing');
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(1);
      expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('19. Texte vide → vecteur zeros (longueur préservée)', () => {
    const v = mockEmbedding('');
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('19b. Textes différents → vecteurs différents (sanity collision)', () => {
    const v1 = mockEmbedding('horaires');
    const v2 = mockEmbedding('tarification');
    expect(v1).not.toEqual(v2);
  });
});

describe('S42 engine — retrieveTopK', () => {
  const baseKb = [
    {
      id: 'a',
      client_id: 'c',
      title: 'Horaires',
      content: 'Mon-Fri 9-5',
      source: 'manual' as const,
      is_active: true,
      created_at: '',
    },
    {
      id: 'b',
      client_id: 'c',
      title: 'Tarifs',
      content: 'Plans variés',
      source: 'manual' as const,
      is_active: true,
      created_at: '',
    },
    {
      id: 'c',
      client_id: 'c',
      title: 'Contact',
      content: 'Email support',
      source: 'manual' as const,
      is_active: true,
      created_at: '',
    },
    {
      id: 'd',
      client_id: 'c',
      title: 'À propos',
      content: 'Notre histoire',
      source: 'manual' as const,
      is_active: true,
      created_at: '',
    },
    {
      id: 'e',
      client_id: 'c',
      title: 'FAQ',
      content: 'Questions fréquentes',
      source: 'faq' as const,
      is_active: true,
      created_at: '',
    },
  ];

  it('20. 5 articles, k=3 → 3 résultats triés DESC', async () => {
    const { env } = makeEnv({ ai: null });
    const hits = await retrieveTopK(env, 'horaires ouverture', baseKb, 3);
    expect(hits.length).toBe(3);
    // Tri DESC : similarity[0] >= similarity[1] >= similarity[2]
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].similarity).toBeGreaterThanOrEqual(hits[i].similarity);
    }
    // Chaque hit a la structure {article, similarity}
    for (const h of hits) {
      expect(h.article).toBeDefined();
      expect(typeof h.similarity).toBe('number');
    }
  });

  it('21. KB vide → []', async () => {
    const { env } = makeEnv({ ai: null });
    const hits = await retrieveTopK(env, 'query', [], 3);
    expect(hits).toEqual([]);
  });

  it('21b. k <= 0 → []', async () => {
    const { env } = makeEnv({ ai: null });
    expect(await retrieveTopK(env, 'q', baseKb, 0)).toEqual([]);
    expect(await retrieveTopK(env, 'q', baseKb, -1)).toEqual([]);
  });

  it('21c. Query vide → []', async () => {
    const { env } = makeEnv({ ai: null });
    expect(await retrieveTopK(env, '', baseKb, 3)).toEqual([]);
    expect(await retrieveTopK(env, '   ', baseKb, 3)).toEqual([]);
  });
});

describe('S42 engine — buildPrompt (generic)', () => {
  it('22. Context vide → fallback explicite', () => {
    const p = buildPrompt('You are bot.', '', 'Hi?');
    expect(p).toContain('You are bot.');
    expect(p).toContain('(no relevant knowledge base entries)');
    expect(p).toContain('User: Hi?');
    expect(p).toMatch(/Assistant:$/);
  });

  it('23. Context normal → assemblage system + ctx + user', () => {
    const p = buildPrompt('You are bot.', '- Hours: 9-5', 'When open?');
    expect(p).toContain('You are bot.');
    expect(p).toContain('- Hours: 9-5');
    expect(p).toContain('User: When open?');
  });

  it('23b. System vide → fallback "You are a helpful assistant."', () => {
    const p = buildPrompt('', '- info', 'q');
    expect(p).toContain('You are a helpful assistant.');
  });
});

describe('S42 engine — detectEscalation', () => {
  it('24. Keyword "parler à quelqu\'un" → escalate true + reason keyword', () => {
    const r = detectEscalation("Je veux parler à quelqu'un", 0.9);
    expect(r.escalate).toBe(true);
    expect(r.reason).toMatch(/^keyword:/);
  });

  it('25. Confidence 0.3 (< MIN_CONFIDENCE 0.5) → escalate true reason low_confidence', () => {
    const r = detectEscalation('Question normale', 0.3);
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe('low_confidence');
  });

  it('26. Confidence 0.8 + message neutre → escalate false (pas de reason)', () => {
    const r = detectEscalation('Quels sont vos horaires?', 0.8);
    expect(r.escalate).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('26b. Message vide → escalate true reason empty_message', () => {
    const r = detectEscalation('', 0.9);
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe('empty_message');
  });

  it('26c. Keyword en EN ("real person") → escalate true', () => {
    const r = detectEscalation('I want a real person please', 0.9);
    expect(r.escalate).toBe(true);
    expect(r.reason).toMatch(/^keyword:/);
  });
});

describe('S42 engine — scrubPii', () => {
  it('27. Email scrubé', () => {
    const out = scrubPii('Contact me at john.doe@example.com please');
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).not.toContain('john.doe@example.com');
  });

  it('28. Phone scrubé (formats variés)', () => {
    expect(scrubPii('Call +1-514-555-1234')).toContain('[REDACTED_PHONE]');
    expect(scrubPii('Mon tel: 514 555 1234')).toContain('[REDACTED_PHONE]');
    expect(scrubPii('Tel (514) 555-1234')).toContain('[REDACTED_PHONE]');
  });

  it('29. CC scrubé', () => {
    expect(scrubPii('Card 4111-1111-1111-1111')).toContain('[REDACTED_CC]');
    expect(scrubPii('Card 4111 1111 1111 1111')).toContain('[REDACTED_CC]');
    expect(scrubPii('Card 4111111111111111')).toContain('[REDACTED_CC]');
  });

  it('30. Texte normal préservé', () => {
    const t = 'Bonjour, je veux connaître vos horaires svp.';
    expect(scrubPii(t)).toBe(t);
  });

  it('30b. Texte mixte : email + phone + CC tous scrubés', () => {
    const out = scrubPii(
      'Email a@b.co tel +1 514 555 1234 cc 4111-1111-1111-1111',
    );
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).toContain('[REDACTED_PHONE]');
    expect(out).toContain('[REDACTED_CC]');
    expect(out).not.toContain('a@b.co');
    expect(out).not.toContain('4111');
  });

  it('30c. Empty / non-string → ""', () => {
    expect(scrubPii('')).toBe('');
    expect(scrubPii(null as unknown as string)).toBe('');
    expect(scrubPii(undefined as unknown as string)).toBe('');
  });
});

describe('S42 engine — checkChatRateLimit', () => {
  /** Mock KV namespace sliding-window. */
  function makeKV() {
    const store = new Map<string, string>();
    const kv = {
      __store: store,
      get: vi.fn(async (key: string, fmt?: string) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        if (fmt === 'json') {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
        return raw;
      }),
      put: vi.fn(
        async (
          key: string,
          value: string,
          _opts?: { expirationTtl?: number },
        ) => {
          store.set(key, value);
        },
      ),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };
    return kv;
  }

  it('31. 30 requêtes consécutives → toutes ok', async () => {
    const kv = makeKV();
    const env = { RATE_LIMITER: kv } as unknown as Env;
    for (let i = 0; i < CHAT_RATE_LIMIT; i++) {
      const r = await checkChatRateLimit(env, 'sess-X');
      expect(r.ok).toBe(true);
    }
  });

  it('32. 31e requête → RATE_LIMITED (ok=false, retryAfter défini)', async () => {
    const kv = makeKV();
    const env = { RATE_LIMITER: kv } as unknown as Env;
    for (let i = 0; i < CHAT_RATE_LIMIT; i++) {
      await checkChatRateLimit(env, 'sess-Y');
    }
    const r = await checkChatRateLimit(env, 'sess-Y');
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });

  it('32b. Pas de KV binding → ok=true (fail-open)', async () => {
    const env = {} as unknown as Env;
    const r = await checkChatRateLimit(env, 'sess-Z');
    expect(r.ok).toBe(true);
  });

  it('32c. Session vide → ok=true (defensive)', async () => {
    const kv = makeKV();
    const env = { RATE_LIMITER: kv } as unknown as Env;
    const r = await checkChatRateLimit(env, '');
    expect(r.ok).toBe(true);
  });

  it('32d. KV get/put en erreur → fail-open ok=true', async () => {
    const kv = {
      get: vi.fn(async () => {
        throw new Error('KV down');
      }),
      put: vi.fn(async () => undefined),
    } as unknown as KVNamespace;
    const env = { RATE_LIMITER: kv } as unknown as Env;
    const r = await checkChatRateLimit(env, 'sess-err');
    expect(r.ok).toBe(true);
  });
});

describe('S42 engine — truncateContext', () => {
  it('33. Long text → coupé à max chars (~4 chars/token)', () => {
    const long = 'a'.repeat(5000);
    const out = truncateContext(long, 100); // 100 tokens ≈ 400 chars
    expect(out.length).toBe(400);
    expect(out.startsWith('aaaa')).toBe(true);
  });

  it('33b. Texte court → préservé tel quel', () => {
    expect(truncateContext('short', 1000)).toBe('short');
  });

  it('33c. maxTokens <= 0 ou non-fini → ""', () => {
    expect(truncateContext('hello', 0)).toBe('');
    expect(truncateContext('hello', -1)).toBe('');
    expect(truncateContext('hello', NaN)).toBe('');
  });

  it('33d. Texte vide → ""', () => {
    expect(truncateContext('', 100)).toBe('');
  });
});

describe('S42 engine — CHAT_BOT_ERROR_CODES const', () => {
  it('34. Codes erreur exposés (informatifs interne)', () => {
    expect(CHAT_BOT_ERROR_CODES.KB_EMPTY).toBe('KB_EMPTY');
    expect(CHAT_BOT_ERROR_CODES.AI_NOT_CONFIGURED).toBe('AI_NOT_CONFIGURED');
    expect(CHAT_BOT_ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(CHAT_BOT_ERROR_CODES.CONTEXT_TOO_LONG).toBe('CONTEXT_TOO_LONG');
    expect(CHAT_BOT_ERROR_CODES.ESCALATION_REQUIRED).toBe('ESCALATION_REQUIRED');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// WIRE-UP — chat-bot.ts handlers ↔ chat-bot-engine.ts renforcement (5 cas)
// ──────────────────────────────────────────────────────────────────────────

describe('S42 wire-up — handleTestBot scrubs PII before LLM call', () => {
  it('35. message avec email → prompt envoyé à AI.run sans email brut', async () => {
    const db = makeDb({
      userClientId: 'client-A',
      configRow: {
        id: 'cfg-1',
        client_id: 'client-A',
        widget_id: null,
        system_prompt: 'You help.',
        confidence_threshold: 0.7,
        escalation_message: 'esc',
        enabled: 1,
        max_messages_per_session: 20,
      },
    });
    const aiRun = vi.fn(async () => ({ response: 'Sure.' }));
    const { env } = makeEnv({ db, ai: { run: aiRun } });

    const req = postReq({
      message: 'My email is john.doe@example.com please reply',
      session_id: 'sess-scrub-35',
    });
    const res = await handleTestBot(req, env, adminAuth as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { pii_scrubbed?: boolean };
    };
    expect(body.data?.pii_scrubbed).toBe(true);

    // Vérifie que le prompt envoyé à AI.run ne contient PAS l'email brut.
    expect(aiRun).toHaveBeenCalledTimes(1);
    const aiArgs = aiRun.mock.calls[0][1] as {
      messages: Array<{ content: string }>;
    };
    expect(aiArgs.messages[0].content).not.toContain('john.doe@example.com');
    expect(aiArgs.messages[0].content).toContain('[REDACTED_EMAIL]');
  });
});

describe('S42 wire-up — handleTestBot rate-limited', () => {
  it('36. 31e requête sur la même session → 429 RATE_LIMITED', async () => {
    // Mock KV in-memory pour simuler sliding window.
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string, fmt?: string) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        if (fmt === 'json') {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
        return raw;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async () => undefined),
    };

    const db = makeDb({ userClientId: 'client-A' });
    const env = {
      DB: db,
      RATE_LIMITER: kv,
      AI: { run: vi.fn(async () => ({ response: 'ok' })) },
    } as unknown as Env;

    const sessionId = 'sess-rl-36';
    // Pré-remplit 30 timestamps récents pour saturer la fenêtre.
    const now = Date.now();
    const ts = Array.from({ length: CHAT_RATE_LIMIT }, (_, i) => now - i * 100);
    store.set(`chat-rl:${sessionId}`, JSON.stringify(ts));

    const req = postReq({ message: 'hello', session_id: sessionId });
    const res = await handleTestBot(req, env, adminAuth as never);
    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      error?: string;
      code?: string;
      retryAfter?: number;
    };
    expect(body.code).toBe(CHAT_BOT_ERROR_CODES.RATE_LIMITED);
    expect(body.retryAfter).toBeGreaterThan(0);
  });
});

describe('S42 wire-up — handleTestBot keyword escalation', () => {
  it('37. message "humain" → escalation_required: true + reason keyword', async () => {
    const db = makeDb({
      userClientId: 'client-A',
      configRow: {
        id: 'cfg-1',
        client_id: 'client-A',
        widget_id: null,
        system_prompt: 'You help.',
        confidence_threshold: 0.7,
        escalation_message: 'Un agent va répondre.',
        enabled: 1,
        max_messages_per_session: 20,
      },
    });
    const aiRun = vi.fn(async () => ({ response: 'Voici votre réponse.' }));
    const { env } = makeEnv({ db, ai: { run: aiRun } });

    const req = postReq({
      message: 'Je veux parler à un humain svp',
      session_id: 'sess-esc-37',
    });
    const res = await handleTestBot(req, env, adminAuth as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        escalation_required?: boolean;
        escalation_reason?: string;
        would_escalate?: boolean;
      };
    };
    expect(body.data?.escalation_required).toBe(true);
    expect(body.data?.escalation_reason).toMatch(/^keyword:/);
    // would_escalate (threshold tenant) doit aussi être true (keyword force escalade).
    expect(body.data?.would_escalate).toBe(true);
  });
});

describe('S42 wire-up — handleCreateKnowledge stocke embedding', () => {
  it('38. INSERT chat_knowledge_base inclut embedding_json (JSON array)', async () => {
    const db = makeDb({ userClientId: 'client-A' });
    const { env } = makeEnv({ db, ai: null }); // FLAG INACTIF → mockEmbedding
    const req = postReq({
      title: 'Horaires',
      content: 'Lundi-Vendredi 9h-17h',
      source: 'manual',
    });
    const res = await handleCreateKnowledge(req, env, adminAuth as never);
    expect(res.status).toBe(200);

    // Vérifie que l'INSERT bindings contient embedding_json en dernière position.
    const insertCall = db.__calls.find((c) =>
      c.sql.toLowerCase().includes('insert into chat_knowledge_base'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.sql).toContain('embedding_json');
    // Bind ordre : id, client_id, title, content, source, now, now, embedding_json
    expect(insertCall?.args.length).toBe(8);
    const embeddingJson = insertCall?.args[7];
    expect(typeof embeddingJson).toBe('string');
    const parsed = JSON.parse(String(embeddingJson));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(EMBEDDING_DIM);
  });
});

describe('S42 wire-up — handleTestBot retrieveTopK ordering', () => {
  it('39. KB avec embeddings stockés → retrieveTopK re-rank par similarity', async () => {
    // KB rows avec embeddings pré-calculés (mockEmbedding sur 2 contenus
    // très différents → vecteurs distincts → cosine distingue).
    const queryVec = mockEmbedding('horaires ouverture');
    const closeVec = mockEmbedding('horaires ouverture lundi vendredi');
    const farVec = mockEmbedding('plomberie urgence eau chaude réparation');

    const db = makeDb({
      userClientId: 'client-A',
      configRow: {
        id: 'cfg-1',
        client_id: 'client-A',
        widget_id: null,
        system_prompt: 'You help.',
        confidence_threshold: 0.7,
        escalation_message: 'esc',
        enabled: 1,
        max_messages_per_session: 20,
      },
      kbRows: [
        {
          id: 'kb-far',
          client_id: 'client-A',
          title: 'Horaires plomberie', // matche LIKE %horaires%
          content: 'Plomberie urgence eau chaude réparation',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
          embedding_json: JSON.stringify(farVec),
        },
        {
          id: 'kb-close',
          client_id: 'client-A',
          title: 'Horaires bureau',
          content: 'Horaires ouverture lundi vendredi',
          source: 'manual',
          is_active: 1,
          created_at: '2026-01-01',
          updated_at: '2026-01-03',
          embedding_json: JSON.stringify(closeVec),
        },
      ],
    });

    const aiRun = vi.fn(async () => ({ response: 'Lun-Ven 9h-17h.' }));
    const { env } = makeEnv({ db, ai: { run: aiRun } });

    const req = postReq({ message: 'horaires ouverture', session_id: 'sess-rank-39' });
    const res = await handleTestBot(req, env, adminAuth as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { kb_matched?: number; kb_retrieved?: number };
    };
    // LIKE matche les 2 entries (toutes ont "horaires").
    expect(body.data?.kb_matched).toBeGreaterThanOrEqual(2);
    // retrieveTopK actif (embeddings présents) → kb_retrieved > 0 et bornée à 3.
    expect(body.data?.kb_retrieved).toBeGreaterThan(0);
    expect(body.data?.kb_retrieved).toBeLessThanOrEqual(3);

    // Vérifie que le prompt contient "kb-close" content (le plus proche
    // sémantiquement) ; valide que le re-ranking a bien injecté l'ordre cosine.
    // Sanity : queryVec.cosine(closeVec) > queryVec.cosine(farVec).
    expect(cosineSimilarity(queryVec, closeVec)).toBeGreaterThan(
      cosineSimilarity(queryVec, farVec),
    );
    // AI binding utilisé 2 fois : 1) embedText(query) via bge-large,
    // 2) runBotInference via Haiku. On cherche le call avec `messages`.
    expect(aiRun.mock.calls.length).toBeGreaterThanOrEqual(1);
    const completionCall = aiRun.mock.calls.find((c) => {
      const args = c[1] as { messages?: Array<{ content: string }> };
      return Array.isArray(args?.messages) && args.messages.length > 0;
    });
    expect(completionCall).toBeDefined();
    const aiArgs = completionCall![1] as {
      messages: Array<{ content: string }>;
    };
    // "Horaires bureau" doit apparaître AVANT "Horaires plomberie" dans le prompt.
    const promptContent = aiArgs.messages[0].content;
    const idxClose = promptContent.indexOf('Horaires bureau');
    const idxFar = promptContent.indexOf('Horaires plomberie');
    expect(idxClose).toBeGreaterThan(-1);
    expect(idxFar).toBeGreaterThan(-1);
    expect(idxClose).toBeLessThan(idxFar);
  });
});
