-- IP1.1: Tool Registry v1
-- Strateji §5.3: "Tool Registry — sistemin kullanabileceği araç kataloğu"
-- Her araç; slug, kategori, auth tipi (none/api_key/oauth2) ve config şeması içerir.
-- agent_tools: hangi ajanın hangi araca erişimi olduğunu tanımlar.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. tools tablosu
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tools (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT    NOT NULL UNIQUE,       -- "web_search", "email_send", vb.
  name        TEXT    NOT NULL,
  description TEXT,
  category    TEXT    NOT NULL DEFAULT 'utility'
    CHECK (category IN ('search','communication','calendar','storage','code','data','utility')),
  auth_type   TEXT    NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none','api_key','oauth2')),
  -- JSON Schema (draft-07) — araçın gerektirdiği config alanlarını tanımlar
  config_schema JSONB NOT NULL DEFAULT '{}',
  -- Hangi tenant bu aracı aktif etmiş; NULL = platform varsayılanı (herkes görebilir)
  tenant_id   UUID,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tools_category    ON public.tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_tenant_id   ON public.tools(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tools_enabled     ON public.tools(enabled) WHERE enabled = true;

DROP TRIGGER IF EXISTS trg_tools_updated_at ON public.tools;
CREATE TRIGGER trg_tools_updated_at
  BEFORE UPDATE ON public.tools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

-- Herkes platform araçlarını (tenant_id IS NULL) görebilir; kendi araçlarını da görebilir
CREATE POLICY tools_select ON public.tools
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = auth.uid());

CREATE POLICY tools_select_anon ON public.tools
  FOR SELECT TO anon
  USING (tenant_id IS NULL);

-- Kullanıcı kendi kiracı araçlarını veya platform araçlarını yönetebilir
CREATE POLICY tools_insert ON public.tools
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = auth.uid());

CREATE POLICY tools_update ON public.tools
  FOR UPDATE TO authenticated
  USING  (tenant_id IS NULL OR tenant_id = auth.uid())
  WITH CHECK (tenant_id IS NULL OR tenant_id = auth.uid());

CREATE POLICY tools_delete ON public.tools
  FOR DELETE TO authenticated
  USING (tenant_id IS NULL OR tenant_id = auth.uid());

GRANT SELECT ON TABLE public.tools TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tools TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. agent_tools bağlantı tablosu
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_tools (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
  tool_id    UUID NOT NULL REFERENCES public.tools(id)   ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  -- Araç başına tenant override config (API key, endpoint, vb.)
  config     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON public.agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_tool  ON public.agent_tools(tool_id);

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_tools_select ON public.agent_tools
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_tools.agent_id
        AND (a.tenant_id IS NULL OR a.tenant_id = auth.uid())
    )
  );

CREATE POLICY agent_tools_insert ON public.agent_tools
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_tools.agent_id
        AND (a.tenant_id IS NULL OR a.tenant_id = auth.uid())
    )
  );

CREATE POLICY agent_tools_update ON public.agent_tools
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_tools.agent_id
        AND (a.tenant_id IS NULL OR a.tenant_id = auth.uid())
    )
  );

CREATE POLICY agent_tools_delete ON public.agent_tools
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_tools.agent_id
        AND (a.tenant_id IS NULL OR a.tenant_id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_tools TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Platform araçları — seed (8 temel araç)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO public.tools (slug, name, description, category, auth_type, config_schema) VALUES
  ('web_search',
   'Web Arama',
   'İnternet araması yapar; güncel haber, makale ve kaynak bulur.',
   'search', 'none',
   '{"type":"object","properties":{"max_results":{"type":"integer","default":10}}}'
  ),
  ('web_scrape',
   'Web İçerik Çekme',
   'Verilen URL''den sayfa içeriğini okur ve Markdown olarak döner.',
   'search', 'none',
   '{"type":"object","properties":{"timeout_seconds":{"type":"integer","default":15}}}'
  ),
  ('email_send',
   'E-posta Gönder',
   'Belirtilen alıcıya konu + gövde ile e-posta gönderir.',
   'communication', 'oauth2',
   '{"type":"object","required":["smtp_host","smtp_port"],"properties":{"smtp_host":{"type":"string"},"smtp_port":{"type":"integer","default":587},"from_name":{"type":"string"}}}'
  ),
  ('calendar_read',
   'Takvim Oku',
   'Google / Outlook takviminden etkinlikleri listeler.',
   'calendar', 'oauth2',
   '{"type":"object","properties":{"calendar_id":{"type":"string","default":"primary"},"lookahead_days":{"type":"integer","default":7}}}'
  ),
  ('calendar_write',
   'Takvim Yaz',
   'Takvimine etkinlik ekler veya günceller.',
   'calendar', 'oauth2',
   '{"type":"object","properties":{"calendar_id":{"type":"string","default":"primary"}}}'
  ),
  ('code_exec',
   'Kod Çalıştır',
   'Python veya JavaScript kod parçacığını sandbox''ta çalıştırır.',
   'code', 'none',
   '{"type":"object","properties":{"language":{"type":"string","enum":["python","javascript"],"default":"python"},"timeout_seconds":{"type":"integer","default":30}}}'
  ),
  ('file_store',
   'Dosya Depolama',
   'Çıktıları S3 / Supabase Storage''a yazar; URL döner.',
   'storage', 'api_key',
   '{"type":"object","properties":{"bucket":{"type":"string","default":"agent-outputs"},"region":{"type":"string","default":"eu-central-1"}}}'
  ),
  ('sql_query',
   'SQL Sorgusu',
   'Yapılandırılmış veriye salt-okunur SQL sorgusu çalıştırır.',
   'data', 'api_key',
   '{"type":"object","required":["connection_string"],"properties":{"connection_string":{"type":"string"},"max_rows":{"type":"integer","default":500}}}'
  )
ON CONFLICT (slug) DO NOTHING;
