-- PR12: Bellek terfisi (operation_memory → global facts) + drift ölçümü altyapısı.
-- Adlandırma: tarih-damgalı düzen. RLS deseni: 20260611200000_llm_providers.sql izlendi.
-- NOT: facts tablosunda owner/tenant kolonu yok — RLS genişletmesi yapılmamıştır.
--      promoteMemoryFacts tick içinde service_role ile koşar; RLS bypass zaten geçerli.

-- ── pg_trgm ───────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── facts tablosu: provenance kolonları ──────────────────────────────────────
ALTER TABLE public.facts
  ADD COLUMN IF NOT EXISTS operation_id         UUID REFERENCES public.operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_from_memory_id UUID REFERENCES public.operation_memory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by        TEXT REFERENCES public.facts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.facts.operation_id IS
  'Bellek terfisi provenance: hangi operasyon bu fact''ı ürettiğini izler.';
COMMENT ON COLUMN public.facts.promoted_from_memory_id IS
  'Kaynaktaki operation_memory.id — terfi zincirini izlemek için.';
COMMENT ON COLUMN public.facts.superseded_by IS
  'Çelişki işaretleme: yeni fact bu alanı eskisinin id''siyle doldurur. '
  'FK sıra: önce yeni INSERT, sonra eski PATCH (PR4 OperationMemoryStore deseni).';

-- ── GIN indeks — benzerlik taraması için ─────────────────────────────────────
-- Büyüyen facts tablosunda similarity() full-scan pahalanır; GIN bunu önler.
CREATE INDEX IF NOT EXISTS facts_claim_trgm_idx
  ON public.facts USING gin (claim gin_trgm_ops);

-- ── policy_settings seed'leri ─────────────────────────────────────────────────
-- İdempotent: partial index üzerinde WHERE NOT EXISTS (NULL UNIQUE semantiği, PR7 dersi).

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'memory.promote_similarity', '0.6'::jsonb,
  'Bellek terfisi: trigram benzerlik eşiği (0-1). Eşit veya yüksek benzerlik = çelişki → yeni kazanır.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'memory.promote_similarity' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'oploop.drift_threshold', '40'::jsonb,
  'Hedef sapma eşiği (0-100). Critic skoru bu değerin altındaysa karar uygulanmaz, escalate tetiklenir.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'oploop.drift_threshold' AND owner_user_id IS NULL
);

-- ── find_similar_fact fonksiyonu ──────────────────────────────────────────────
-- Verilen domain_pack + içerik için trigram benzerliği yüksek aktif fact varsa id'sini döner.
-- Aktif = superseded_by IS NULL.
-- Kullanım: SELECT find_similar_fact('pack-id', 'içerik', 0.6)

CREATE OR REPLACE FUNCTION public.find_similar_fact(
  p_domain_pack TEXT,
  p_content     TEXT,
  p_threshold   FLOAT
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_id TEXT;
BEGIN
  SELECT id INTO v_id
  FROM public.facts
  WHERE domain_pack    = p_domain_pack
    AND superseded_by  IS NULL
    AND similarity(claim, p_content) >= p_threshold
  ORDER BY similarity(claim, p_content) DESC
  LIMIT 1;

  RETURN v_id; -- NULL döner eşik altındaysa
END;
$$;

COMMENT ON FUNCTION public.find_similar_fact IS
  'pg_trgm trigram benzerliğiyle aktif fact arar. '
  'NULL döndürmesi = çelişen fact yok, doğrudan INSERT edilebilir.';

GRANT EXECUTE ON FUNCTION public.find_similar_fact TO service_role;
