CREATE TABLE IF NOT EXISTS public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','fail')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  output_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_owner_created_at ON public.runs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_created_at ON public.runs(status, created_at DESC);

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runs_select_own ON public.runs;
CREATE POLICY runs_select_own ON public.runs
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS runs_insert_own ON public.runs;
CREATE POLICY runs_insert_own ON public.runs
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS runs_update_own ON public.runs;
CREATE POLICY runs_update_own ON public.runs
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS runs_delete_own ON public.runs;
CREATE POLICY runs_delete_own ON public.runs
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.runs TO authenticated;


CREATE TABLE IF NOT EXISTS public.bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  run_id UUID,
  name TEXT NOT NULL,
  tags TEXT,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundles_owner_created_at ON public.bundles(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundles_run_id ON public.bundles(run_id);

ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bundles_select_own ON public.bundles;
CREATE POLICY bundles_select_own ON public.bundles
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS bundles_insert_own ON public.bundles;
CREATE POLICY bundles_insert_own ON public.bundles
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS bundles_update_own ON public.bundles;
CREATE POLICY bundles_update_own ON public.bundles
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS bundles_delete_own ON public.bundles;
CREATE POLICY bundles_delete_own ON public.bundles
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bundles TO authenticated;


CREATE TABLE IF NOT EXISTS public.knowledge_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','verified','rejected')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('run','bundle','manual')),
  source_run_id UUID,
  source_bundle_id UUID,
  confidence DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facts_owner_updated_at ON public.knowledge_facts(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_facts_state ON public.knowledge_facts(state);

ALTER TABLE public.knowledge_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facts_select_own ON public.knowledge_facts;
CREATE POLICY facts_select_own ON public.knowledge_facts
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS facts_write_own ON public.knowledge_facts;
CREATE POLICY facts_write_own ON public.knowledge_facts
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS facts_update_own ON public.knowledge_facts;
CREATE POLICY facts_update_own ON public.knowledge_facts
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS facts_delete_own ON public.knowledge_facts;
CREATE POLICY facts_delete_own ON public.knowledge_facts
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_facts TO authenticated;


CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_knowledge_facts_updated_at ON public.knowledge_facts;
CREATE TRIGGER trg_knowledge_facts_updated_at
BEFORE UPDATE ON public.knowledge_facts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

