CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS objects_embedding_idx
  ON objects USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
