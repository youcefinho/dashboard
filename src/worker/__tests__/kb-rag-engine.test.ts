import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types';
import { chunkText, indexArticleChunks, searchKbRag } from '../lib/kb-rag-engine';

interface MockDbRow {
  id?: string;
  client_id: string;
  text_chunk: string;
  embedding_json: string;
  source_id: string;
  created_at?: string;
}

interface MockDbState {
  embeddings: MockDbRow[];
  articles: Array<{ id: string; title: string; body_md: string; status: 'draft' | 'published'; client_id: string }>;
}

function makeDb(initialState: Partial<MockDbState> = {}) {
  const state: MockDbState = {
    embeddings: initialState.embeddings ?? [],
    articles: initialState.articles ?? [],
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
          return null;
        }),
        all: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.includes('from kb_embeddings') && lower.includes('join kb_articles')) {
            // Simuler la jointure
            const clientId = String(boundArgs[0] ?? '');
            const joined = state.embeddings
              .filter(e => e.client_id === clientId)
              .map(e => {
                const article = state.articles.find(a => a.id === e.source_id);
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
          return { results: [] };
        }),
        run: vi.fn(async () => {
          calls.push({ sql, args: boundArgs });
          if (lower.startsWith('delete from kb_embeddings')) {
            const clientId = String(boundArgs[0] ?? '');
            const sourceId = String(boundArgs[1] ?? '');
            state.embeddings = state.embeddings.filter(
              e => !(e.client_id === clientId && e.source_id === sourceId)
            );
          } else if (lower.startsWith('insert into kb_embeddings')) {
            // INSERT (client_id, text_chunk, embedding_json, source_id)
            state.embeddings.push({
              client_id: String(boundArgs[0] ?? ''),
              text_chunk: String(boundArgs[1] ?? ''),
              embedding_json: String(boundArgs[2] ?? '[]'),
              source_id: String(boundArgs[3] ?? '')
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

function makeEnv(opts: { db?: ReturnType<typeof makeDb>; aiRun?: typeof vi.fn } = {}) {
  const db = opts.db ?? makeDb();
  const env: Record<string, unknown> = { DB: db };
  if (opts.aiRun) {
    env.AI = { run: opts.aiRun };
  }
  return { env: env as unknown as Env, db };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RAG engine — chunkText', () => {
  it('Découpe un texte court sans modification', () => {
    const text = 'Mon petit texte de FAQ.';
    const chunks = chunkText(text, 100);
    expect(chunks).toEqual([text]);
  });

  it('Découpe un texte long par paragraphes ou mots', () => {
    const text = 'Premier paragraphe assez long.\nDeuxième paragraphe également très long.';
    const chunks = chunkText(text, 40, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('Premier paragraphe');
  });

  it('Gère les inputs vides ou invalides', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(null as any)).toEqual([]);
  });
});

describe('RAG engine — indexArticleChunks', () => {
  it('Supprime les anciens chunks pour un article Draft', async () => {
    const db = makeDb({
      embeddings: [
        { client_id: 'client-A', text_chunk: 'ancien chunk', embedding_json: '[]', source_id: 'article-1' }
      ]
    });
    const { env } = makeEnv({ db });

    const res = await indexArticleChunks(
      env,
      'client-A',
      'article-1',
      'Titre',
      'Contenu',
      'draft'
    );

    expect(res.success).toBe(true);
    expect(res.chunksCount).toBe(0);
    expect(db.__state.embeddings.length).toBe(0); // Suppression effective
  });

  it('Génère et insère les chunks pour un article publié', async () => {
    const db = makeDb();
    // Simulation d'un retour d'embedding bidon
    const aiRun = vi.fn(async () => ({
      data: [[0.1, 0.2, 0.3]]
    }));
    const { env } = makeEnv({ db, aiRun });

    const res = await indexArticleChunks(
      env,
      'client-A',
      'article-1',
      'Titre de la FAQ',
      'Ceci est un long contenu de guide pour tester la vectorisation et le RAG.',
      'published'
    );

    expect(res.success).toBe(true);
    expect(res.chunksCount).toBeGreaterThan(0);
    expect(db.__state.embeddings.length).toBeGreaterThan(0);
    expect(db.__state.embeddings[0].text_chunk).toContain('Titre de la FAQ');
  });
});

describe('RAG engine — searchKbRag', () => {
  it('Retourne une liste vide si aucun chunk n\'est présent', async () => {
    const db = makeDb();
    const { env } = makeEnv({ db });

    const hits = await searchKbRag(env, 'client-A', 'horaires', 3);
    expect(hits).toEqual([]);
  });

  it('Retourne les Top-K chunks triés par similarité', async () => {
    // Créer une base de données avec 2 chunks et leurs articles
    const db = makeDb({
      articles: [
        { id: 'art-1', title: 'Horaires', body_md: 'Ouvert 9h-17h', status: 'published', client_id: 'client-A' },
        { id: 'art-2', title: 'Tarifs', body_md: 'Prix abordables', status: 'published', client_id: 'client-A' }
      ],
      embeddings: [
        {
          client_id: 'client-A',
          text_chunk: 'Horaires: Ouvert 9h-17h',
          // embedding mocké proche du query vector pour "horaires"
          embedding_json: JSON.stringify(new Array(1536).fill(0.1)),
          source_id: 'art-1'
        },
        {
          client_id: 'client-A',
          text_chunk: 'Tarifs: Prix abordables',
          // embedding éloigné
          embedding_json: JSON.stringify(new Array(1536).fill(-0.1)),
          source_id: 'art-2'
        }
      ]
    });

    const aiRun = vi.fn(async () => ({
      data: [new Array(1536).fill(0.1)] // Match parfait avec le premier chunk
    }));

    const { env } = makeEnv({ db, aiRun });
    const hits = await searchKbRag(env, 'client-A', 'horaires ouverture', 2);

    expect(hits.length).toBe(2);
    expect(hits[0].source_title).toBe('Horaires');
    expect(hits[0].similarity).toBeGreaterThan(hits[1].similarity); // Tri correct
  });
});
