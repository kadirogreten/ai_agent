-- PR-D1b: Eval run etiketleme — runs.meta JSONB + eval KPI izolasyonu indeksi.

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.runs.meta IS
  'Run metadata. eval=true etiketli kayıtlar maliyet KPI sorgularından dışlanır.';

CREATE INDEX IF NOT EXISTS idx_runs_meta_eval
  ON public.runs ((meta->>'eval'))
  WHERE (meta->>'eval') = 'true';

NOTIFY pgrst, 'reload schema';
