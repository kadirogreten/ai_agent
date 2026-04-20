CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_code ON public.agents(code);
CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON public.agents(updated_at DESC);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agents_select_all ON public.agents;
CREATE POLICY agents_select_all ON public.agents
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS agents_insert_authenticated ON public.agents;
CREATE POLICY agents_insert_authenticated ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS agents_update_authenticated ON public.agents;
CREATE POLICY agents_update_authenticated ON public.agents
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_agents_updated_at ON public.agents;
CREATE TRIGGER trg_agents_updated_at
BEFORE UPDATE ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON TABLE public.agents TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agents TO authenticated;
