-- IP1.4 Cost Ledger: runs tablosuna token/maliyet/süre/verifier metrikleri ekle
-- Strateji §6.6: "Step başına metrik: tokens_in, tokens_out, latency_ms, model, cost_usd, verifier_outcome"
-- Strateji §11.1 KPI: maliyet <$0.40 P50, süre <8 dk P50, Verifier FAIL <%15

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS domain_pack TEXT,
  ADD COLUMN IF NOT EXISTS risk_level TEXT CHECK (risk_level IN ('R0','R1','R2','R3')),
  ADD COLUMN IF NOT EXISTS tokens_in INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_out INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS verifier_outcome TEXT CHECK (verifier_outcome IN ('pass','fail','warn'));

CREATE INDEX IF NOT EXISTS idx_runs_cost_usd ON public.runs(owner_user_id, cost_usd);
CREATE INDEX IF NOT EXISTS idx_runs_verifier ON public.runs(owner_user_id, verifier_outcome);
