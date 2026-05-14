-- AgentArmy: Agent Manifest alanları (Faz 0)
-- Strateji dokümanı 01-strateji-mimari.docx §6.1.1 → Manifest Şeması
-- Supabase SQL Editor'da çalıştır.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IN ('research','analysis','writing','editing','verification','operation','contrarian','design','code')),
  ADD COLUMN IF NOT EXISTS risk_ceiling TEXT NOT NULL DEFAULT 'R1'
    CHECK (risk_ceiling IN ('R0','R1','R2','R3')),
  ADD COLUMN IF NOT EXISTS cost_class TEXT NOT NULL DEFAULT 'medium'
    CHECK (cost_class IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS behaviors JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS tenant_overridable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN agents.role IS 'Fonksiyonel rol: research|analysis|writing|editing|verification|operation|contrarian|design|code';
COMMENT ON COLUMN agents.risk_ceiling IS 'Ajanın çalışabileceği maksimum risk seviyesi: R0–R3';
COMMENT ON COLUMN agents.cost_class IS 'Beklenen token aralığı: low|medium|high';
COMMENT ON COLUMN agents.behaviors IS 'Davranış bayrakları: {"requires_web_search":true,"writes_to_facts":true,...}';
COMMENT ON COLUMN agents.system_prompt IS 'Model için sistem mesajı (boşsa description+capabilities''ten otomatik üretilir)';
COMMENT ON COLUMN agents.tenant_overridable IS 'Tenant bu ajanı kendi prompt''uyla özelleştirebilir mi';
