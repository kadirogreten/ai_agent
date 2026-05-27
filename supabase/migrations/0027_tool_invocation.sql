-- Faz A — Tool Invocation: araç sözleşmesi + çağrı kaydı
-- Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.1, §5)
-- Yol haritası: docs/operasyonel-ozerklik-yol-haritasi.md (Faz A — OA0→OA2)
--
-- Bu migration:
--   1) tools tablosuna sözleşme alanları ekler (girdi/çıktı şeması, yan etki,
--      geri-alınabilirlik, min risk, geri-alma eylemi).
--   2) tool_invocations tablosunu oluşturur (her çağrının kalıcı, denetlenebilir kaydı
--      + geri-alma anahtarı).
--   3) 0017'deki seed araçların sözleşmelerini doldurur.
--
-- Güvenlik invariant'ı (tasarım §8): yan etkili (write/external) ve geri-alınamaz
-- (reversible=false) araçlar Faz A'da yürütücü tarafından REDDEDİLİR. Bu migration
-- yalnız metadata tutar; enforcement CLI tarafında (ToolExecutor) yapılır.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. tools sözleşmesini genişlet
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS input_schema  JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS output_schema JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS side_effect   TEXT    NOT NULL DEFAULT 'none'
       CHECK (side_effect IN ('none','read','write','external')),
  ADD COLUMN IF NOT EXISTS reversible    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_risk      TEXT    NOT NULL DEFAULT 'R1'
       CHECK (min_risk IN ('R0','R1','R2','R3')),
  ADD COLUMN IF NOT EXISTS compensation  TEXT;

COMMENT ON COLUMN public.tools.input_schema  IS 'JSON Schema (draft-07) — çağrı argümanlarını doğrular (config_schema''dan ayrı).';
COMMENT ON COLUMN public.tools.output_schema IS 'JSON Schema (draft-07) — araç çıktısını doğrular.';
COMMENT ON COLUMN public.tools.side_effect   IS 'none|read = otomatik geçer; write|external = RiskGate''e tabi.';
COMMENT ON COLUMN public.tools.reversible    IS 'Yan etki geri alınabilir mi? Faz A: write/external + reversible=false yasak.';
COMMENT ON COLUMN public.tools.min_risk      IS 'Aracın taban risk sınıfı; etkin risk = max(görev riski, min_risk).';
COMMENT ON COLUMN public.tools.compensation  IS 'Geri-alma eylemi etiketi (ör. delete_object). NULL = geri-alma yok.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. tool_invocations — her çağrının kalıcı kaydı + geri-alma anahtarı
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tool_invocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID NOT NULL,
  run_id             TEXT NOT NULL,
  step_id            TEXT,
  agent_id           TEXT,
  tool_slug          TEXT NOT NULL,
  args               JSONB,
  status             TEXT NOT NULL DEFAULT 'pending'
       CHECK (status IN ('pending','succeeded','failed','blocked','compensated')),
  risk_level         TEXT CHECK (risk_level IN ('R0','R1','R2','R3')),
  side_effect        TEXT CHECK (side_effect IN ('none','read','write','external')),
  output             JSONB,
  compensation_token TEXT,                 -- geri-alma için (ör. silinecek obje id'si)
  error              TEXT,
  approval_queue_id  UUID,                  -- RiskGate / approval_queue kaydına bağ
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_inv_run    ON public.tool_invocations(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_inv_owner  ON public.tool_invocations(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_inv_slug   ON public.tool_invocations(owner_user_id, tool_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_inv_status ON public.tool_invocations(owner_user_id, status, created_at DESC);

ALTER TABLE public.tool_invocations ENABLE ROW LEVEL SECURITY;

-- Sahibi kendi çağrı kayıtlarını görebilir (audit_log deseniyle aynı).
DROP POLICY IF EXISTS tool_inv_select_own ON public.tool_invocations;
CREATE POLICY tool_inv_select_own ON public.tool_invocations
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- Yazma yalnız service_role (CLI / worker) üzerinden; immutable amaçlı authenticated yazamaz.
GRANT SELECT ON TABLE public.tool_invocations TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.tool_invocations TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Seed araçların sözleşmeleri (0017'deki 8 araç)
--    Faz A'da AKTİF: read araçları + geri-alınabilir file_store.
--    Faz A'da PASİF (metadata var, yürütücü reddeder): email_send, calendar_write.
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE public.tools
   SET side_effect = 'read', reversible = true, min_risk = 'R0'
 WHERE slug IN ('web_search','web_scrape','calendar_read','sql_query');

UPDATE public.tools
   SET side_effect = 'write', reversible = true, min_risk = 'R1', compensation = 'delete_object'
 WHERE slug = 'file_store';

-- code_exec: tasarım §11 kararı — Faz A'da kapalı (sandbox sertleşene kadar).
UPDATE public.tools
   SET side_effect = 'external', reversible = false, min_risk = 'R2'
 WHERE slug = 'code_exec';

UPDATE public.tools
   SET side_effect = 'external', reversible = false, min_risk = 'R3'
 WHERE slug IN ('email_send','calendar_write');
