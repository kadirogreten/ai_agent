-- 0025_empirical_check_results.sql
-- Empirical Check (empiricalCheck.ts) sonuçları için kalıcı kayıt tablosu.
-- Her tick'te 4 check sonucu insert edilir; portal'da son sonuçlar gösterilir.

CREATE TABLE IF NOT EXISTS public.empirical_check_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id      TEXT NOT NULL,                -- "1" "2" "3" "4"
  check_name    TEXT NOT NULL,                -- "facts_injection" "persona_overlay" "risk_gate" "behaviors_heuristic"
  status        TEXT NOT NULL                 -- "pass" "warn" "fail" "skip"
                  CHECK (status IN ('pass','warn','fail','skip')),
  summary       TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  metrics       JSONB NOT NULL DEFAULT '{}',  -- {tokens_saved_pct, fact_count, ...}
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecr_check_id_run ON public.empirical_check_results(check_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecr_run_at       ON public.empirical_check_results(run_at DESC);

ALTER TABLE public.empirical_check_results ENABLE ROW LEVEL SECURITY;

-- Authenticated kullanıcılar tümünü okuyabilir (cross-tenant ölçüm aracı, sistem geneli)
CREATE POLICY ecr_select ON public.empirical_check_results
  FOR SELECT TO authenticated USING (true);

-- Sadece service_role yazabilir (script bunun üzerinden çalışır)
CREATE POLICY ecr_service ON public.empirical_check_results
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON TABLE public.empirical_check_results TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.empirical_check_results TO service_role;
