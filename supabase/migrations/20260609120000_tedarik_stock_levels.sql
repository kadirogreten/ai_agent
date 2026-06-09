-- Tedarik otomasyonu — ŞEMA (içerik yok).
-- NOT: Bu içerik daha önce 0032/0033 numaralarıyla verilmişti; o versiyonlar remote'ta zaten
-- "uygulandı" kayıtlı olduğu için CLI atlıyordu. Çakışmayan yeni bir versiyonla yeniden veriyoruz.
-- İdempotent: tekrar çalıştırılması güvenli.
--
-- 1) tools.category CHECK kısıtına 'commerce' ve 'logistics' ekle (portalden bu kategoride
--    araç oluşturulabilsin diye).
-- 2) stock_levels tablosu: stok DB-first; hardcode fixture yok. Portaldan/SQL'den yönetilir,
--    yarın IdeaSoft/ERP API'si upsert ederek besleyebilir.

-- ── 1. tools.category genişlet ──────────────────────────────────────────────
ALTER TABLE public.tools DROP CONSTRAINT IF EXISTS tools_category_check;
ALTER TABLE public.tools
  ADD CONSTRAINT tools_category_check
  CHECK (category IN ('search','communication','calendar','storage','code','data','utility','commerce','logistics'));

-- ── 2. stock_levels ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_levels (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product        TEXT        NOT NULL,
  sku            TEXT,
  current_stock  INTEGER     NOT NULL DEFAULT 0,
  threshold      INTEGER     NOT NULL DEFAULT 10,
  target_stock   INTEGER     NOT NULL DEFAULT 0,
  warehouse      TEXT,
  source         TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'ideasoft' | 'erp' ...
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, product)
);

CREATE INDEX IF NOT EXISTS idx_stock_levels_owner ON public.stock_levels(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_below ON public.stock_levels(owner_user_id)
  WHERE enabled = true AND current_stock <= threshold;

DROP TRIGGER IF EXISTS trg_stock_levels_updated_at ON public.stock_levels;
CREATE TRIGGER trg_stock_levels_updated_at
  BEFORE UPDATE ON public.stock_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_levels_select_own ON public.stock_levels;
CREATE POLICY stock_levels_select_own ON public.stock_levels
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS stock_levels_modify_own ON public.stock_levels;
CREATE POLICY stock_levels_modify_own ON public.stock_levels
  FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS stock_levels_service_all ON public.stock_levels;
CREATE POLICY stock_levels_service_all ON public.stock_levels
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_levels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_levels TO service_role;

-- PostgREST şema cache'ini tazele ki tablo hemen görünür olsun.
NOTIFY pgrst, 'reload schema';
