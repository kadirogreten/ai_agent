-- Tedarik otomasyonu — stok seviyeleri (ŞEMA; içerik yok).
--
-- Stok artık hardcode fixture değil, DB'den yönetilir. Satırlar portaldan/SQL'den düzenlenir;
-- yarın IdeaSoft/ERP API'si bu tabloyu upsert ederek besleyebilir (source alanı kaynağı belirtir).
--
--   - stock_check aracı (CLI): owner + product ile bu tablodan okur.
--   - stockMonitorTick (worker): threshold altına düşen satırlar için araştırma işi açar.

CREATE TABLE IF NOT EXISTS public.stock_levels (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product        TEXT        NOT NULL,
  sku            TEXT,
  current_stock  INTEGER     NOT NULL DEFAULT 0,
  threshold      INTEGER     NOT NULL DEFAULT 10,
  target_stock   INTEGER     NOT NULL DEFAULT 0,   -- yeniden doldurma hedefi (sipariş adedi hesabı)
  warehouse      TEXT,
  source         TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'ideasoft' | 'erp' ...
  enabled        BOOLEAN     NOT NULL DEFAULT true,       -- izleyici bu ürünü izlesin mi
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, product)
);

CREATE INDEX IF NOT EXISTS idx_stock_levels_owner       ON public.stock_levels(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_below       ON public.stock_levels(owner_user_id)
  WHERE enabled = true AND current_stock <= threshold;

DROP TRIGGER IF EXISTS trg_stock_levels_updated_at ON public.stock_levels;
CREATE TRIGGER trg_stock_levels_updated_at
  BEFORE UPDATE ON public.stock_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;

-- Sahibi kendi stok satırlarını görür/yönetir.
DROP POLICY IF EXISTS stock_levels_select_own ON public.stock_levels;
CREATE POLICY stock_levels_select_own ON public.stock_levels
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS stock_levels_modify_own ON public.stock_levels;
CREATE POLICY stock_levels_modify_own ON public.stock_levels
  FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- Worker / CLI (service_role) tam erişim.
DROP POLICY IF EXISTS stock_levels_service_all ON public.stock_levels;
CREATE POLICY stock_levels_service_all ON public.stock_levels
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_levels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_levels TO service_role;
