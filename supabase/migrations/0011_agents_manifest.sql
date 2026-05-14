-- IP0.4 + AgentManifest: agents tablosuna manifest kolonları ekle + RLS tenant isolation düzelt
-- Strateji §4.7 "Tenant Isolation Is Sacred": tenant_id = NULL → sistem ajanı (herkese görünür),
--   tenant_id = auth.uid() → tenant'a özel ajan

-- 1. Manifest kolonları
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS role TEXT
    CHECK (role IN ('research','analysis','writing','editing','verification','operation','contrarian','design','code')),
  ADD COLUMN IF NOT EXISTS risk_ceiling TEXT NOT NULL DEFAULT 'R1'
    CHECK (risk_ceiling IN ('R0','R1','R2','R3')),
  ADD COLUMN IF NOT EXISTS cost_class TEXT NOT NULL DEFAULT 'low'
    CHECK (cost_class IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS behaviors JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS tenant_overridable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tenant_id UUID;  -- NULL = sistem ajanı

CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON public.agents(tenant_id);

-- 2. RLS politikalarını kaldır ve doğru tenant isolation ile yeniden oluştur
DROP POLICY IF EXISTS agents_select_all ON public.agents;
DROP POLICY IF EXISTS agents_insert_authenticated ON public.agents;
DROP POLICY IF EXISTS agents_update_authenticated ON public.agents;

-- SELECT: sistem ajanları (tenant_id IS NULL) herkes görebilir;
--         tenant ajanları sadece sahibi görebilir
CREATE POLICY agents_select_own ON public.agents
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = auth.uid());

-- Anonim kullanıcılar sadece sistem ajanlarını görebilir
CREATE POLICY agents_select_anon ON public.agents
  FOR SELECT TO anon
  USING (tenant_id IS NULL);

-- INSERT: sadece kendi tenant'ına ajan ekleyebilir
CREATE POLICY agents_insert_own ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = auth.uid());

-- UPDATE: sadece kendi tenant ajanlarını güncelleyebilir
CREATE POLICY agents_update_own ON public.agents
  FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

-- DELETE: sadece kendi tenant ajanlarını silebilir
CREATE POLICY agents_delete_own ON public.agents
  FOR DELETE TO authenticated
  USING (tenant_id = auth.uid());
