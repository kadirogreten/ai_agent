-- PR-D3b: tools.embedding + match_tools_by_embedding (D1 facts deseni).

ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMENT ON COLUMN public.tools.embedding IS
  'OpenAI text-embedding-3-small (1536 dim). NULL = henüz embed edilmedi.';

CREATE INDEX IF NOT EXISTS tools_embedding_hnsw_idx
  ON public.tools USING hnsw (embedding vector_cosine_ops)
  WHERE enabled = true AND embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION public.match_tools_by_embedding(
  p_embedding vector(1536),
  p_limit       INT   DEFAULT 8,
  p_threshold   FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  slug        TEXT,
  name        TEXT,
  description TEXT,
  side_effect TEXT,
  min_risk    TEXT,
  compensation TEXT,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.slug,
    t.name,
    t.description,
    t.side_effect,
    t.min_risk,
    t.compensation,
    1 - (t.embedding <=> p_embedding) AS similarity
  FROM public.tools t
  WHERE t.enabled = true
    AND t.embedding IS NOT NULL
    AND (1 - (t.embedding <=> p_embedding)) >= p_threshold
  ORDER BY t.embedding <=> p_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.match_tools_by_embedding IS
  'pgvector cosine benzerliğiyle araç arar. Compensation muafiyeti CLI ToolRanker''da uygulanır.';

GRANT EXECUTE ON FUNCTION public.match_tools_by_embedding TO service_role;
GRANT EXECUTE ON FUNCTION public.match_tools_by_embedding TO authenticated;

NOTIFY pgrst, 'reload schema';
