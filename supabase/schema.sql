-- cait-sith - Supabase schema (RAG support)
-- Only needed if you enable RAG in config.yaml

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Tracks indexed files
CREATE TABLE IF NOT EXISTS files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  mime_type     TEXT,
  extension     TEXT,
  modified_at   TIMESTAMPTZ,
  extracted     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Document chunks with embeddings
CREATE TABLE IF NOT EXISTS chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       UUID REFERENCES files(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,
  chunk_index   INT,
  embedding     VECTOR(768)  -- nomic-embed-text via Ollama
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops);

-- Semantic search
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding VECTOR(768),
  max_results INT DEFAULT 5
)
RETURNS TABLE(
  chunk_id UUID,
  content TEXT,
  source TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.source,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  ORDER BY c.embedding <=> query_embedding
  LIMIT max_results;
END;
$$;
