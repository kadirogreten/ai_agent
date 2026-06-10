-- Compensation runtime — tool_invocations tablosuna geri-alma durum kolonları.
-- Yol haritası: docs/operasyonel-ozerklik-yol-haritasi.md (Faz B)
-- Örnek adlandırma: 0027_tool_invocation.sql, 20260609120000_tedarik_stock_levels.sql
--
-- Idempotency guard (CLI + runtime): CompensationExecutor yalnız
--   status='succeeded' AND compensation_token IS NOT NULL
--   AND compensated_at IS NULL AND side_effect IN ('write','external')
-- satırlarda çalışır; ikinci çağrı compensated_at dolu görünce no-op döner.
--
-- compensated_at + compensation_status tek UPDATE'te yazılır; yarım kayıt kalmaz.

ALTER TABLE public.tool_invocations
  ADD COLUMN IF NOT EXISTS compensated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_status TEXT
       CHECK (compensation_status IN ('succeeded','failed'));

COMMENT ON COLUMN public.tool_invocations.compensated_at
  IS 'Geri-alma tamamlandığı an; NULL = henüz geri alınmadı.';

COMMENT ON COLUMN public.tool_invocations.compensation_status
  IS 'succeeded | failed. compensated_at ile birlikte tek UPDATE''te yazılır.';

-- Hızlı sorgu: "bu run'da geri alınmamış yan etkili başarılı çağrılar var mı?"
CREATE INDEX IF NOT EXISTS idx_tool_inv_comp
  ON public.tool_invocations(owner_user_id, status, compensated_at)
  WHERE compensated_at IS NULL;
