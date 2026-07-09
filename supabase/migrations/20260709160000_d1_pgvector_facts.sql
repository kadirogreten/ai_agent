-- PR-D1c: pgvector facts — embedding kolonu + anlamsal arama RPC + policy seed.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.facts
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMENT ON COLUMN public.facts.embedding IS
  'OpenAI text-embedding-3-small (1536 dim). NULL = henüz embed edilmedi.';

CREATE INDEX IF NOT EXISTS facts_embedding_hnsw_idx
  ON public.facts USING hnsw (embedding vector_cosine_ops)
  WHERE superseded_by IS NULL AND embedding IS NOT NULL;

-- Anlamsal fact arama — cosine similarity (1 - distance).
CREATE OR REPLACE FUNCTION public.match_facts_by_embedding(
  p_domain_pack TEXT,
  p_embedding   vector(1536),
  p_limit       INT   DEFAULT 8,
  p_threshold   FLOAT DEFAULT 0.75
)
RETURNS TABLE (
  id            TEXT,
  domain_pack   TEXT,
  topic         TEXT,
  claim         TEXT,
  evidence_url  TEXT,
  source_domain TEXT,
  confidence    FLOAT,
  similarity    FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.id,
    f.domain_pack,
    f.topic,
    f.claim,
    f.evidence_url,
    f.source_domain,
    f.confidence,
    1 - (f.embedding <=> p_embedding) AS similarity
  FROM public.facts f
  WHERE f.domain_pack   = p_domain_pack
    AND f.superseded_by IS NULL
    AND f.embedding     IS NOT NULL
    AND (1 - (f.embedding <=> p_embedding)) >= p_threshold
  ORDER BY f.embedding <=> p_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.match_facts_by_embedding IS
  'pgvector cosine benzerliğiyle aktif facts arar. similarity >= p_threshold filtresi uygulanır.';

GRANT EXECUTE ON FUNCTION public.match_facts_by_embedding TO service_role;
GRANT EXECUTE ON FUNCTION public.match_facts_by_embedding TO authenticated;

-- Aktif facts görünümü (superseded zinciri hariç).
CREATE OR REPLACE VIEW public.facts_active_as_of AS
  SELECT *
  FROM public.facts
  WHERE superseded_by IS NULL;

COMMENT ON VIEW public.facts_active_as_of IS
  'superseded_by IS NULL olan güncel facts kayıtları.';

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'memory.embed_model', '"text-embedding-3-small"'::jsonb,
  'Facts embed modeli (OpenAI).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'memory.embed_model' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'memory.vector_threshold', '0.75'::jsonb,
  'Vector arama cosine benzerlik eşiği (0-1).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'memory.vector_threshold' AND owner_user_id IS NULL
);

NOTIFY pgrst, 'reload schema';
