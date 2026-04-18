ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_owner_external_id ON public.runs(owner_user_id, external_id);

ALTER TABLE public.bundles
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bundles_owner_external_id ON public.bundles(owner_user_id, external_id);

ALTER TABLE public.knowledge_facts
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_facts_owner_external_id ON public.knowledge_facts(owner_user_id, external_id);

