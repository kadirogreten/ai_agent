-- D4a: MCP registry keşif önbelleği + mcp_servers onay durumu.
-- Desen: 20260614110000_mcp_servers.sql, 20260611170000_policy_settings.sql.

-- ── 1. mcp_registry_cache ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_registry_cache (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_url  TEXT         NOT NULL,
  slug          TEXT         NOT NULL,  -- registry name (örn. io.github.user/server)
  name          TEXT         NOT NULL,
  description   TEXT,
  transport     TEXT         NOT NULL DEFAULT 'http'
                             CHECK (transport IN ('http', 'stdio', 'streamable-http', 'sse', 'unknown')),
  endpoint      TEXT,                   -- remote URL varsa; stdio için NULL
  homepage      TEXT,
  auth_env_hint TEXT,                   -- önerilen env adı (secret değil)
  risk_hint     TEXT         NOT NULL DEFAULT 'R1'
                             CHECK (risk_hint IN ('R0', 'R1', 'R2', 'R3')),
  raw_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (registry_url, slug)
);

COMMENT ON TABLE public.mcp_registry_cache IS
  'D4a — resmi/topluluk MCP registry index önbelleği (TTL 24h). Secret yok.';

CREATE INDEX IF NOT EXISTS idx_mcp_registry_cache_fetched
  ON public.mcp_registry_cache (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_registry_cache_name
  ON public.mcp_registry_cache USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));

ALTER TABLE public.mcp_registry_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_registry_cache_select ON public.mcp_registry_cache;
CREATE POLICY mcp_registry_cache_select ON public.mcp_registry_cache
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON TABLE public.mcp_registry_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mcp_registry_cache TO service_role;

-- ── 2. mcp_servers: onay durumu + registry köprüsü ────────────────────────────

ALTER TABLE public.mcp_servers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_approval', 'active', 'rejected', 'disabled')),
  ADD COLUMN IF NOT EXISTS registry_slug TEXT,
  ADD COLUMN IF NOT EXISTS homepage TEXT,
  ADD COLUMN IF NOT EXISTS risk_hint TEXT
    CHECK (risk_hint IS NULL OR risk_hint IN ('R0', 'R1', 'R2', 'R3'));

COMMENT ON COLUMN public.mcp_servers.status IS
  'D4a — pending_approval: keşiften önerildi, enabled=false; active: onaylı; rejected/disabled: kapalı.';
COMMENT ON COLUMN public.mcp_servers.registry_slug IS
  'Kaynak registry name (mcp_registry_cache.slug). Elle eklenenlerde NULL.';

-- Mevcut satırlar active kalsın (DEFAULT zaten active).
UPDATE public.mcp_servers SET status = 'active' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_status
  ON public.mcp_servers (owner_user_id, status)
  WHERE owner_user_id IS NOT NULL;

-- ── 3. policy seed ────────────────────────────────────────────────────────────

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'mcp.registry_urls',
  '["https://registry.modelcontextprotocol.io"]'::jsonb,
  'D4a — MCP registry base URL listesi (okuma-only). İlk eleman resmi registry.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'mcp.registry_urls' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'mcp.registry_cache_ttl_hours', '24'::jsonb,
  'D4a — mcp_registry_cache yenileme eşiği (saat).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'mcp.registry_cache_ttl_hours' AND owner_user_id IS NULL
);
