-- PR13: MCP (Model Context Protocol) sunucu kaydı + tools tablosu genişlemesi.
--
-- 1. mcp_servers: platform (owner_user_id NULL) + kullanıcı sahipli sunucular.
--    transport CHECK: 'http' | 'stdio' — bu PR'da yalnız http aktif; stdio sonraki PR.
-- 2. tools: mcp_server_id + mcp_tool_name kolonları (NULL = yerleşik C# aracı).
-- 3. policy_settings: mcp.call_timeout_seconds seed.
--
-- Adlandırma: tarih-damgalı düzen.
-- Desen: 0027_tool_invocation.sql (RLS), 20260611170000_policy_settings.sql (seed).
-- KURAL: tools.category CHECK ('search','communication','calendar','storage','code','data','utility')
--        doğrulandı — mcp-sync category='utility' kullanır, 'mcp'/'external' YOKTUR.
-- KURAL: tools.slug UNIQUE (global) — mcp-sync slug'ları {server_slug}__{tool_name} formatında
--        üretir; buluşma zamanı check yapılır.

-- ── 1. mcp_servers ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_servers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = platform
  slug           TEXT        NOT NULL,
  display_name   TEXT        NOT NULL,
  transport      TEXT        NOT NULL DEFAULT 'http'
                             CHECK (transport IN ('http', 'stdio')),
  endpoint       TEXT        NOT NULL,  -- http: URL; stdio (sonraki PR): komut satırı
  auth_env       TEXT,                  -- env değişken ADI (anahtarın kendisi değil)
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.mcp_servers IS
  'MCP sunucu kaydı. owner_user_id IS NULL = platform sunucu (tüm kullanıcılar görebilir); '
  'dolu = kullanıcıya özel sunucu. endpoint SSRF yüzeyi — çok-tenant''da ek izin kontrolü ekle.';
COMMENT ON COLUMN public.mcp_servers.auth_env IS
  'Kimlik doğrulama anahtarının ENV DEĞİŞKEN ADI (örn. MY_MCP_API_KEY). '
  'Anahtar değeri burada saklanmaz; CLI çalışma anında env''den okur.';

-- Slug benzersizliği: policy_settings deseniyle aynı (partial index, NULL semantiği).
CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_platform_slug_idx
  ON public.mcp_servers (slug)
  WHERE owner_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_owner_slug_idx
  ON public.mcp_servers (owner_user_id, slug)
  WHERE owner_user_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

-- SELECT: platform (owner=NULL) → herkese; owner satırı → sahibine.
DROP POLICY IF EXISTS mcp_servers_select ON public.mcp_servers;
CREATE POLICY mcp_servers_select ON public.mcp_servers
  FOR SELECT TO authenticated
  USING (owner_user_id IS NULL OR owner_user_id = auth.uid());

-- INSERT: owner satırı → kendi uid'siyle (platform satırı service_role'e özel — WITH CHECK guard).
DROP POLICY IF EXISTS mcp_servers_insert ON public.mcp_servers;
CREATE POLICY mcp_servers_insert ON public.mcp_servers
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
-- NOT: owner_user_id = auth.uid() → NULL satır yazmak mümkün değil (NULL ≠ uid). PR7/PR8 dersi.

-- UPDATE / DELETE: kendi satırlarını.
DROP POLICY IF EXISTS mcp_servers_update ON public.mcp_servers;
CREATE POLICY mcp_servers_update ON public.mcp_servers
  FOR UPDATE TO authenticated
  USING  (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS mcp_servers_delete ON public.mcp_servers;
CREATE POLICY mcp_servers_delete ON public.mcp_servers
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- service_role: platform satırları için tam yetki (CLI mcp-sync).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mcp_servers TO service_role;
GRANT SELECT ON TABLE public.mcp_servers TO authenticated;

-- ── 2. tools tablosu genişlemesi ─────────────────────────────────────────────

ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS mcp_server_id UUID
      REFERENCES public.mcp_servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mcp_tool_name TEXT;
-- NULL değerler = yerleşik C# aracı (geriye uyumlu).

COMMENT ON COLUMN public.tools.mcp_server_id IS
  'NULL → yerleşik C# aracı. Dolu → McpProxyTool; McpClient bu sunucuya çağrı yapar.';
COMMENT ON COLUMN public.tools.mcp_tool_name IS
  'MCP sunucusundaki asıl araç adı (tools/list → name). tools.slug''dan farklı olabilir.';

CREATE INDEX IF NOT EXISTS idx_tools_mcp_server
  ON public.tools (mcp_server_id)
  WHERE mcp_server_id IS NOT NULL;

-- ── 3. policy_settings seed ───────────────────────────────────────────────────

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'mcp.call_timeout_seconds', '60'::jsonb,
  'MCP araç çağrısı zaman aşımı (saniye). McpClient.CallToolAsync CancellationToken eşiği. '
  'Artırmak web-search benzeri uzun MCP araçları için gerekebilir.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'mcp.call_timeout_seconds' AND owner_user_id IS NULL
);
