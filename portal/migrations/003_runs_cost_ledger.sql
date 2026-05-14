-- IP1.4: Cost Ledger — runs tablosuna maliyet ve metrik alanları
-- Strateji §6.6: "Step başına metrik: tokens_in, tokens_out, latency_ms, model, cost_usd, verifier_outcome"

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS tokens_in      INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_out     INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd       NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS latency_ms     INTEGER,
  ADD COLUMN IF NOT EXISTS model          TEXT,
  ADD COLUMN IF NOT EXISTS domain_pack    TEXT,
  ADD COLUMN IF NOT EXISTS risk_level     TEXT CHECK (risk_level IN ('R0','R1','R2','R3')),
  ADD COLUMN IF NOT EXISTS verifier_outcome TEXT CHECK (verifier_outcome IN ('pass','fail','skipped'));

COMMENT ON COLUMN runs.tokens_in       IS 'Toplam giriş token sayısı (tüm adımlar)';
COMMENT ON COLUMN runs.tokens_out      IS 'Toplam çıkış token sayısı (tüm adımlar)';
COMMENT ON COLUMN runs.cost_usd        IS 'Toplam maliyet (USD) — Cost Ledger';
COMMENT ON COLUMN runs.latency_ms      IS 'Toplam süre (ms) — started_at → finished_at';
COMMENT ON COLUMN runs.model           IS 'Kullanılan LLM modeli';
COMMENT ON COLUMN runs.domain_pack     IS 'Domain pack (e-ticaret, hibe, vb.)';
COMMENT ON COLUMN runs.risk_level      IS 'Run risk seviyesi: R0–R3';
COMMENT ON COLUMN runs.verifier_outcome IS 'Denetçi sonucu: pass|fail|skipped';

-- Cost Ledger sorguları için index
CREATE INDEX IF NOT EXISTS idx_runs_owner_created ON runs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_domain_pack   ON runs(domain_pack) WHERE domain_pack IS NOT NULL;
