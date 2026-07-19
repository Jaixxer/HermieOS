-- Add a generated tsvector column for full-text search on objects.
-- We search title, summary, and a text-cast of body.
ALTER TABLE objects
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body::text, '')), 'C')
  ) STORED;

CREATE INDEX objects_search_vector_idx
  ON objects USING GIN (search_vector);
