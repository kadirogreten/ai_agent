-- CEO review: source kolonu + (gerekirse) tablo bootstrap.
-- Bazı remote DB'lerde 0010 hiç uygulanmadığı için bu migration ceo_question_reviews
-- tablosunu yoksa IDEMPOTENT şekilde kurar (0010'un içeriğini birebir tekrarlar);
-- sonra yeni 'source' kolonunu ekler:
--   - 'ceo'  : CeoPlanner üretti (varsayılan)
--   - 'user' : kullanıcı CeoReviewPage'de manuel ekledi
--
-- IF NOT EXISTS + DROP POLICY IF EXISTS desenleri sayesinde tablo zaten varsa
-- bu adımlar no-op'tur; veri kaybı yok.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Tablo (0010 bootstrap — yoksa kur)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ceo_question_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID NOT NULL,
  job_id           UUID NOT NULL REFERENCES public.run_requests(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  question         TEXT NOT NULL,
  suggested_answer TEXT,
  user_answer      TEXT,
  status           TEXT NOT NULL DEFAULT 'suggested'
                   CHECK (status IN ('suggested','edited','approved')),
  confidence       DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ceo_question_reviews_job_position
  ON public.ceo_question_reviews(job_id, position);

CREATE INDEX IF NOT EXISTS idx_ceo_question_reviews_owner
  ON public.ceo_question_reviews(owner_user_id, updated_at DESC);

ALTER TABLE public.ceo_question_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ceo_question_reviews_select_own ON public.ceo_question_reviews;
CREATE POLICY ceo_question_reviews_select_own ON public.ceo_question_reviews
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS ceo_question_reviews_insert_own ON public.ceo_question_reviews;
CREATE POLICY ceo_question_reviews_insert_own ON public.ceo_question_reviews
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS ceo_question_reviews_update_own ON public.ceo_question_reviews;
CREATE POLICY ceo_question_reviews_update_own ON public.ceo_question_reviews
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Yeni: source kolonu (Faz A — CEO review kullanıcı satırı ayrımı)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ceo_question_reviews
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ceo'
    CHECK (source IN ('ceo','user'));

COMMENT ON COLUMN public.ceo_question_reviews.source IS
  'Sorunun kaynağı: ceo = CeoPlanner üretti, user = kullanıcı CeoReviewPage''de manuel ekledi.';
