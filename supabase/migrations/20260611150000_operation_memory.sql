-- PR4: Operasyon belleği — run'lar arası taşınan kalıcı durum.
-- kind: fact (doğrulanmış bulgu), decision (alınan karar), work (ara çalışma özeti)
-- superseded_by: çelişen yeni kayıt eskiyi geçersiz kıldığında doldurulur.
-- topic_key: SHA256(kind || '::' || content_prefix) ile hesaplanan dedup anahtarı.
--
-- Adlandırma: tarih-damgalı düzen (20260609* gibi).
-- RLS deseni: 20260611140000_operations.sql (operation_events) izlendi.
-- NOT: superseded_by FK INSERT'ten sonra PATCH ile doldurulur (FK sıra zorunluluğu).

-- ── operation_memory ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operation_memory (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    UUID        NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL CHECK (kind IN ('fact','decision','work')),
  topic_key       TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  source_run_id   TEXT,                        -- CLI runId (runs.external_id)
  superseded_by   UUID        REFERENCES public.operation_memory(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operation_memory IS
  'Operasyon kapsamlı kalıcı bellek. Her run sonunda fact/decision/work üçlüsü eklenir. '
  'Çelişen yeni kayıt eskinin superseded_by kolonunu doldurur. '
  'Prompt enjeksiyonu: superseded_by IS NULL olan en yeni 30 kayıt.';

COMMENT ON COLUMN public.operation_memory.superseded_by IS
  'FK sıra: önce yeni kayıt INSERT edilir, sonra eski kayda PATCH yapılır. '
  'Henüz var olmayan id referans alınamaz (FK ihlali).';

COMMENT ON COLUMN public.operation_memory.topic_key IS
  'SHA256(kind || "::" || content[:120]) hex. Aynı önekli içerik üzerine yazılır. '
  'Farklı ifadeli çelişki tespiti v1 kapsamı dışı (PR6 dogfood sonrası iyileştirilir).';

ALTER TABLE public.operation_memory ENABLE ROW LEVEL SECURITY;

-- authenticated: kendi operasyonuna ait bellek kayıtlarını okuyabilir
CREATE POLICY om_select_own ON public.operation_memory
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = operation_id AND o.owner_user_id = auth.uid()
    )
  );

-- authenticated INSERT/UPDATE de var — portal'dan erişim için
CREATE POLICY om_insert_own ON public.operation_memory
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = operation_id AND o.owner_user_id = auth.uid()
    )
  );

CREATE POLICY om_update_own ON public.operation_memory
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = operation_id AND o.owner_user_id = auth.uid()
    )
  );

CREATE POLICY om_service_role_all ON public.operation_memory
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE public.operation_memory TO authenticated;
GRANT ALL ON TABLE public.operation_memory TO service_role;

-- ── indeksler ─────────────────────────────────────────────────────────────────
-- Prompt sorgusu: belirli operasyonun aktif kayıtları, en yeni önce
CREATE INDEX IF NOT EXISTS idx_om_operation_active
  ON public.operation_memory(operation_id, created_at DESC)
  WHERE superseded_by IS NULL;

-- Supersede sorgusu: aynı kind+topic_key aktif kayıt var mı?
CREATE INDEX IF NOT EXISTS idx_om_dedup
  ON public.operation_memory(operation_id, kind, topic_key)
  WHERE superseded_by IS NULL;
