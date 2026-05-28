-- migration-kb-embeddings-seq165.sql
-- Table pour stocker les chunks textuels et vecteurs d'embeddings pour RAG.

CREATE TABLE IF NOT EXISTS kb_embeddings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  text_chunk TEXT NOT NULL,
  embedding_json TEXT NOT NULL, -- Vecteur JSON stringifié
  source_id TEXT NOT NULL,      -- kb_articles.id
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_embeddings_client_source ON kb_embeddings(client_id, source_id);
