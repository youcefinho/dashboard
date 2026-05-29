import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { processBotReply } from '../lib/chat-bot-bridge';

// Structure des mocks DB
interface MockDbState {
  chat_bot_config: any[];
  webchat_sessions: any[];
  messages: any[];
  chatbot_sessions: any[];
  kb_embeddings: any[];
  kb_articles: any[];
  users: any[];
  notifications: any[];
}

function makeDb(initialState: Partial<MockDbState> = {}) {
  const state: MockDbState = {
    chat_bot_config: initialState.chat_bot_config ?? [],
    webchat_sessions: initialState.webchat_sessions ?? [],
    messages: initialState.messages ?? [],
    chatbot_sessions: initialState.chatbot_sessions ?? [],
    kb_embeddings: initialState.kb_embeddings ?? [],
    kb_articles: initialState.kb_articles ?? [],
    users: initialState.users ?? [],
    notifications: initialState.notifications ?? [],
  };
  const calls: Array<{ sql: string; args: unknown[] }> = [];

  const db = {
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
          
          if (lower.includes('from chat_bot_config')) {
            const clientId = boundArgs[0];
            return state.chat_bot_config.find(c => c.client_id === clientId) || null;
          }
          if (lower.includes('from webchat_sessions')) {
            const sessionId = boundArgs[0];
            return state.webchat_sessions.find(s => s.id === sessionId) || null;
          }
          if (lower.includes('from chatbot_sessions')) {
            const sessionId = boundArgs[0];
            return state.chatbot_sessions.find(s => s.session_token === sessionId) || null;
          }
          if (lower.includes('from leads')) {
            return { id: 'lead-1', client_id: 'client-A' };
          }
          return null;
        }),
        all: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.includes('from messages')) {
            const convId = boundArgs[0];
            const limit = boundArgs[1] as number;
            const msgs = state.messages
              .filter(m => m.conversation_id === convId)
              .slice(-limit);
            return { results: msgs };
          }
          if (lower.includes('from kb_embeddings') && lower.includes('join kb_articles')) {
            const clientId = boundArgs[0];
            const joined = state.kb_embeddings
              .filter(e => e.client_id === clientId)
              .map(e => {
                const article = state.kb_articles.find(a => a.id === e.source_id);
                return {
                  text_chunk: e.text_chunk,
                  source_title: article ? article.title : '',
                  embedding_json: e.embedding_json,
                  source_id: e.source_id,
                  status: article ? article.status : 'draft'
                };
              })
              .filter(item => item.status === 'published');
            return { results: joined };
          }
          if (lower.includes('from users')) {
            return { results: state.users };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.startsWith('insert into messages')) {
            state.messages.push({
              id: boundArgs[0],
              lead_id: boundArgs[1],
              client_id: boundArgs[2],
              conversation_id: boundArgs[3],
              direction: boundArgs[4],
              channel: boundArgs[5],
              body: boundArgs[6],
              status: boundArgs[7],
              sent_by: boundArgs[8],
              created_at: new Date().toISOString()
            });
          } else if (lower.startsWith('update webchat_sessions')) {
            const sessionId = boundArgs[0];
            const session = state.webchat_sessions.find(s => s.id === sessionId);
            if (session) {
              if (lower.includes('bot_handled = 0')) {
                session.bot_handled = 0;
              } else if (lower.includes('bot_handled = 1')) {
                session.bot_handled = 1;
              }
              if (lower.includes('bot_messages_count = bot_messages_count + 1')) {
                session.bot_messages_count = (session.bot_messages_count || 0) + 1;
              }
            }
          } else if (lower.startsWith('insert into chatbot_sessions')) {
            state.chatbot_sessions.push({
              id: 'new-cb-id',
              session_token: boundArgs[0],
              is_active: boundArgs[1],
              confidence_avg: boundArgs[2],
              client_id: boundArgs[3],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          } else if (lower.startsWith('update chatbot_sessions')) {
            const id = boundArgs[2];
            const session = state.chatbot_sessions.find(s => s.id === id);
            if (session) {
              session.is_active = boundArgs[0];
              session.confidence_avg = boundArgs[1];
              session.updated_at = new Date().toISOString();
            }
          } else if (lower.startsWith('insert into notifications')) {
            state.notifications.push({
              id: boundArgs[0],
              user_id: boundArgs[1],
              title: boundArgs[2],
              body: boundArgs[3],
              icon: boundArgs[4],
              link: boundArgs[5],
              client_id: boundArgs[6],
              created_at: new Date().toISOString()
            });
          }
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return stmt;
    }),
  };
  return db;
}

function makeEnv(opts: { db?: ReturnType<typeof makeDb>; aiRun?: any } = {}) {
  const db = opts.db ?? makeDb();
  const env: Record<string, unknown> = { DB: db };
  if (opts.aiRun) {
    env.AI = { run: opts.aiRun };
  } else {
    // Mock basique de l'IA (Haiku)
    env.AI = {
      run: vi.fn(async (model: string, input: any) => {
        if (model.includes('llama') || model.includes('haiku') || model.includes('mistral')) {
          return {
            response: 'Voici la réponse de l\'IA.',
            confidence: 0.85
          };
        }
        if (model.includes('embed')) {
          return {
            data: [new Array(1536).fill(0.1)]
          };
        }
        return {};
      })
    };
  }
  return { env: env as unknown as Env, db };
}

describe('Chatbot Bridge — processBotReply', () => {
  let db: ReturnType<typeof makeDb>;
  let env: Env;
  let sentMessages: any[] = [];

  const sendMessageCallback = (msg: any) => {
    sentMessages.push(msg);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sentMessages = [];
    db = makeDb({
      chat_bot_config: [
        {
          client_id: 'client-A',
          enabled: 1,
          system_prompt: 'Tu es un bot d\'aide.',
          confidence_threshold: 0.6,
          escalation_message: 'Transfert vers conseiller.',
          max_messages_per_session: 10
        }
      ],
      webchat_sessions: [
        {
          id: 'sess-1',
          conversation_id: 'conv-1',
          bot_handled: 1,
          bot_messages_count: 0
        }
      ],
      users: [
        { id: 'admin-1', role: 'admin', is_active: 1 }
      ]
    });
    const setup = makeEnv({ db });
    env = setup.env;
  });

  it('Happy Path — le bot répond avec succès et met à jour les sessions', async () => {
    await processBotReply(env, 'client-A', 'sess-1', 'Bonjour', sendMessageCallback);

    // Vérifier la réponse dans la DB
    const botMessages = db.__state.messages.filter(m => m.sent_by === 'Chatbot');
    expect(botMessages.length).toBe(1);
    expect(botMessages[0].body).toBe('Voici la réponse de l\'IA.');

    // Compteur de messages incrémenté
    const session = db.__state.webchat_sessions.find(s => s.id === 'sess-1');
    expect(session.bot_messages_count).toBe(1);
    expect(session.bot_handled).toBe(1);

    // Session chatbot créée
    expect(db.__state.chatbot_sessions.length).toBe(1);
    expect(db.__state.chatbot_sessions[0].session_token).toBe('sess-1');
    expect(db.__state.chatbot_sessions[0].is_active).toBe(1);
    expect(db.__state.chatbot_sessions[0].confidence_avg).toBe(0.85);

    // Message envoyé par websocket
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].name).toBe('Chatbot');
  });

  it('Bypass — le bot est désactivé', async () => {
    db.__state.chat_bot_config[0].enabled = 0;

    await processBotReply(env, 'client-A', 'sess-1', 'Bonjour', sendMessageCallback);

    expect(db.__state.messages.length).toBe(0);
    expect(db.__state.chatbot_sessions.length).toBe(0);
  });

  it('Escalade — Mot-clé d\'escalade force la transition humaine', async () => {
    await processBotReply(env, 'client-A', 'sess-1', 'Je veux parler à un humain', sendMessageCallback);

    // Vérifier que la session a été escaladée
    const session = db.__state.webchat_sessions.find(s => s.id === 'sess-1');
    expect(session.bot_handled).toBe(0);

    // Message d'escalade inséré
    const escMessages = db.__state.messages.filter(m => m.sent_by === 'Système');
    expect(escMessages.length).toBe(1);
    expect(escMessages[0].body).toBe('Transfert vers conseiller.');

    // Notification admin générée
    expect(db.__state.notifications.length).toBe(1);
    expect(db.__state.notifications[0].user_id).toBe('admin-1');

    // Session chatbot marquée inactive
    expect(db.__state.chatbot_sessions.length).toBe(1);
    expect(db.__state.chatbot_sessions[0].is_active).toBe(0);
  });

  it('Escalade — Confiance insuffisante déclenche l\'escalade', async () => {
    // IA renvoie un faible score de confiance
    const aiRun = vi.fn(async (model: string) => {
      if (model.includes('embed')) {
        return { data: [new Array(1536).fill(0.1)] };
      }
      return {
        response: 'Je ne sais pas.',
        confidence: 0.4
      };
    });
    const setup = makeEnv({ db, aiRun });
    env = setup.env;

    await processBotReply(env, 'client-A', 'sess-1', 'Horaires ?', sendMessageCallback);

    const session = db.__state.webchat_sessions.find(s => s.id === 'sess-1');
    expect(session.bot_handled).toBe(0);
    expect(db.__state.chatbot_sessions[0].is_active).toBe(0);
  });

  it('Rate limit — Dépassement du cap de messages max par session', async () => {
    const session = db.__state.webchat_sessions.find(s => s.id === 'sess-1');
    session.bot_messages_count = 10; // Déjà atteint le max configuré

    await processBotReply(env, 'client-A', 'sess-1', 'Autre question', sendMessageCallback);

    expect(session.bot_handled).toBe(0);
    expect(db.__state.chatbot_sessions[0].is_active).toBe(0);
  });
});
