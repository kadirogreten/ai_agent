-- PR8 Görev 7a: tools_update RLS daraltma + tool_overrides tablosu.
--
-- Sorun: tools_update policy `tenant_id IS NULL OR tenant_id = auth.uid()` ile platform
-- araçlarını (tenant_id IS NULL) herhangi bir kullanıcı güncelleyebiliyor.
-- Düzeltme: authenticated yalnız kendi tenant satırını güncelleyebilir; platform satırları
-- service_role ile güncellenir (RLS bypass). Kullanıcı başına override ayrı tabloda tutulur.
--
-- tool_overrides: tools şemasına dokunmadan per-user enabled/disabled override'ı.
-- Runner.cs ToolEnabledMap: tools (platform) + tool_overrides (user); override kazanır.
-- Adlandırma: tarih-damgalı düzen. RLS deseni: 20260611140000_operations.sql izlendi.

-- ── 1. tools_update RLS daralt ───────────────────────────────────────────────
DROP POLICY IF EXISTS tools_update ON public.tools;

CREATE POLICY tools_update ON public.tools
  FOR UPDATE TO authenticated
  USING  (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

-- ── 2. tool_overrides tablosu ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tool_overrides (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug     TEXT        NOT NULL,
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, tool_slug)
);

COMMENT ON TABLE public.tool_overrides IS
  'Kullanıcı başına araç enabled/disabled override''ı. '
  'tools.enabled platform varsayılanı; bu tablo onu gölgeler (override kazanır). '
  'Runner.cs ToolEnabledMap: tools (NULL tenant) + tool_overrides birleşimi.';

-- Performans: Runner.cs'nin owner_user_id filtreli sorgusu için
CREATE INDEX IF NOT EXISTS idx_tool_overrides_owner ON public.tool_overrides (owner_user_id);

ALTER TABLE public.tool_overrides ENABLE ROW LEVEL SECURITY;

-- SELECT: yalnız kendi override'larını görebilir
CREATE POLICY tool_overrides_select ON public.tool_overrides
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- INSERT: yalnız kendi override'ını ekleyebilir
CREATE POLICY tool_overrides_insert ON public.tool_overrides
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

-- UPDATE: yalnız kendi override'ını güncelleyebilir
CREATE POLICY tool_overrides_update ON public.tool_overrides
  FOR UPDATE TO authenticated
  USING  (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- DELETE: yalnız kendi override'ını silebilir
CREATE POLICY tool_overrides_delete ON public.tool_overrides
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
