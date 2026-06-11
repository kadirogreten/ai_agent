-- PR10: LLM provider tablosu — model seçimini koddan DB'ye taşır.
-- Adlandırma: 20260611* tarih damgası (20260609* ve 20260611* deseni korundu).
-- RLS deseni: 20260611170000_policy_settings.sql esas alındı.
--
-- api_key_env: anahtarın KENDİSİ DEĞİL, okunacak env değişkeninin adı.
-- kind TEXT: fabrika URL koklamak yerine bunu okur (kırılganlık düzeltmesi).
-- is_default_for TEXT[]: PostgREST cs.{purpose} dizi-içerir operatörüyle sorgulanır.

CREATE TABLE IF NOT EXISTS public.llm_providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  display_name      TEXT        NOT NULL,
  api_base          TEXT        NOT NULL,
  api_key_env       TEXT        NOT NULL,
  model_id          TEXT        NOT NULL,
  kind              TEXT        NOT NULL CHECK (kind IN ('openai','anthropic')),
  tier              TEXT        NOT NULL CHECK (tier IN ('basic','standard','frontier')),
  max_decision_risk TEXT        NOT NULL CHECK (max_decision_risk IN ('R0','R1','R2','R3')),
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  is_default_for    TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.llm_providers IS
  'PR10: LLM provider kaydı. api_key_env env değişkeninin adını tutar (anahtarın kendisini değil). kind factory için; is_default_for PostgREST cs.{purpose} ile sorgulanır.';

COMMENT ON COLUMN public.llm_providers.api_key_env IS
  'Okunacak env değişkeninin adı — ör. OPENAI_API_KEY, ANTHROPIC_API_KEY. Anahtarın kendisi saklanmaz.';

COMMENT ON COLUMN public.llm_providers.is_default_for IS
  'Bu provider varsayılan olarak hangi amaçlar için kullanılır: run, decide, facts. PostgREST: is_default_for=cs.{decide}';

ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;

-- SELECT: tüm authenticated kullanıcılar (api_key_env adı görünür, anahtar değil)
CREATE POLICY llm_providers_select ON public.llm_providers
  FOR SELECT TO authenticated
  USING (true);

-- Yazma: yalnızca service_role (RLS politikasız → sadece service_role bypass eder)
-- INSERT / UPDATE / DELETE için authenticated politika tanımlanmamış → erişim yok.

-- ── Seed ────────────────────────────────────────────────────────────────────
-- decide + facts + run varsayılanı: gpt-4.1 (standard, R2) — küçük JSON kararı, ucuz tutulmalı.
-- PR12 critic da 'facts' varsayılanını kullanacak.
INSERT INTO public.llm_providers (slug, display_name, api_base, api_key_env, model_id, kind, tier, max_decision_risk, enabled, is_default_for)
SELECT 'gpt-4.1-standard', 'GPT-4.1 (Standard)', 'https://api.openai.com', 'OPENAI_API_KEY',
  'gpt-4.1', 'openai', 'standard', 'R2', true, ARRAY['run','decide','facts']
WHERE NOT EXISTS (SELECT 1 FROM public.llm_providers WHERE slug = 'gpt-4.1-standard');

-- Frontier seçenek: gpt-5 — varsayılan değil; Modeller sayfasından atanabilir.
INSERT INTO public.llm_providers (slug, display_name, api_base, api_key_env, model_id, kind, tier, max_decision_risk, enabled, is_default_for)
SELECT 'gpt-5-frontier', 'GPT-5 (Frontier)', 'https://api.openai.com', 'OPENAI_API_KEY',
  'gpt-5', 'openai', 'frontier', 'R3', true, ARRAY[]::TEXT[]
WHERE NOT EXISTS (SELECT 1 FROM public.llm_providers WHERE slug = 'gpt-5-frontier');

-- Anthropic örnek (disabled — ANTHROPIC_API_KEY gerektirir)
INSERT INTO public.llm_providers (slug, display_name, api_base, api_key_env, model_id, kind, tier, max_decision_risk, enabled, is_default_for)
SELECT 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY',
  'claude-sonnet-4-6', 'anthropic', 'standard', 'R2', false, ARRAY[]::TEXT[]
WHERE NOT EXISTS (SELECT 1 FROM public.llm_providers WHERE slug = 'claude-sonnet-4-6');

NOTIFY pgrst, 'reload schema';
