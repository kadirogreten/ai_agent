-- PR-D0a: Untrusted içerik karantinası — tools.untrusted_source bayrağı.
-- Dış kaynaklı read araç çıktıları LLM'e spotlighting ile sarılır.

ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS untrusted_source BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tools.untrusted_source IS
  'true → araç çıktısı dış/kullanıcı kontrolünde içerik; LLM''e <untrusted_data> ile sarılır.';

UPDATE public.tools
SET untrusted_source = true,
    updated_at       = now()
WHERE slug IN ('social_inbox_fetch', 'web_scrape', 'link_check');
