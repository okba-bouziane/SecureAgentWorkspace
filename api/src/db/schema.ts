export const EMBEDDING_DIM = 384;

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  source       text,
  content_hash text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','processing','ready','failed')),
  error        text,
  chunk_count  integer NOT NULL DEFAULT 0,
  suspicious   boolean NOT NULL DEFAULT false,
  uploaded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  content     text NOT NULL,
  suspicious  boolean NOT NULL DEFAULT false,
  embedding   vector(${EMBEDDING_DIM}) NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS threads (
  id         uuid PRIMARY KEY,
  user_sub   text NOT NULL,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS threads_user_idx ON threads (user_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS traces (
  id          text PRIMARY KEY,
  user_sub    text NOT NULL,
  username    text,
  thread_id   text,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'ok',
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  duration_ms double precision
);
CREATE INDEX IF NOT EXISTS traces_user_idx ON traces (user_sub, started_at DESC);

CREATE TABLE IF NOT EXISTS spans (
  id            text PRIMARY KEY,
  trace_id      text NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  parent_id     text,
  name          text NOT NULL,
  kind          text NOT NULL,
  status        text NOT NULL DEFAULT 'ok',
  started_at    timestamptz NOT NULL,
  duration_ms   double precision NOT NULL,
  attributes    jsonb NOT NULL DEFAULT '{}',
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd      double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS spans_trace_idx ON spans (trace_id);
`;
