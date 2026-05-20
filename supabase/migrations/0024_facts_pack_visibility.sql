-- 0024_facts_pack_visibility.sql
-- Kapı 5 — Çapraz-Fonksiyon Otonomi: Bir pack'in facts'leri başka pack tarafından okunabilsin.
-- Örnek: "satış" personası "pazarlama" pack'in son müşteri research'lerini okuyabilsin.
--
-- Tasarım: yönlü görünürlük matrisi. (source_pack, visible_to_pack) çifti varsa
-- "visible_to_pack" rolü altında çalışan ajan source_pack'in facts'lerini okuyabilir.

CREATE TABLE IF NOT EXISTS public.facts_pack_visibility (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_pack_id      TEXT NOT NULL REFERENCES public.domain_packs(id) ON DELETE CASCADE,
  visible_to_pack_id  TEXT NOT NULL REFERENCES public.domain_packs(id) ON DELETE CASCADE,
  tenant_id           UUID,                              -- NULL = sistem geneli
  reason              TEXT,                              -- "satis pazarlama'dan customer insight okur" gibi
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_pack_id, visible_to_pack_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_fpv_visible ON public.facts_pack_visibility(visible_to_pack_id);
CREATE INDEX IF NOT EXISTS idx_fpv_source  ON public.facts_pack_visibility(source_pack_id);

ALTER TABLE public.facts_pack_visibility ENABLE ROW LEVEL SECURITY;

-- Authenticated kullanıcı: kendi tenant'ı veya sistem (NULL) görsün
CREATE POLICY fpv_select ON public.facts_pack_visibility
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = auth.uid());

CREATE POLICY fpv_insert ON public.facts_pack_visibility
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = auth.uid());

CREATE POLICY fpv_update ON public.facts_pack_visibility
  FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

CREATE POLICY fpv_delete ON public.facts_pack_visibility
  FOR DELETE TO authenticated
  USING (tenant_id = auth.uid());

CREATE POLICY fpv_service ON public.facts_pack_visibility
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facts_pack_visibility TO authenticated;

-- Bir pack için görünür kaynak pack'lerin listesini döner (kendi pack'i dahil).
CREATE OR REPLACE FUNCTION public.visible_packs_for(p_pack_id TEXT, p_tenant UUID DEFAULT NULL)
RETURNS TABLE (pack_id TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p_pack_id AS pack_id
  UNION
  SELECT source_pack_id
  FROM public.facts_pack_visibility
  WHERE visible_to_pack_id = p_pack_id
    AND (tenant_id IS NULL OR tenant_id = p_tenant)
$$;

GRANT EXECUTE ON FUNCTION public.visible_packs_for(TEXT, UUID) TO authenticated, service_role;
