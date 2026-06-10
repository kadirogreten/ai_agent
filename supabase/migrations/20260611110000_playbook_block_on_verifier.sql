-- Güvenlik kilidi 1: blockOnVerifierFail adım bayrağı.
-- playbook_steps tablosu YOK; adımlar playbooks.steps JSONB'de duruyor (0019_domain_packs.sql:106).
-- Bu migration yalnız veri güncellemesidir: tedarik playbook'undaki purchase_order adımına
-- {"blockOnVerifierFail": true} bayrağını ekler.
--
-- C# tarafı: PlaybookStep.BlockOnVerifierFail bool alanı bu bayrağı okur.
-- Orchestrator: blockOnVerifierFail=true bir adım başlamadan önce önceki Verifier sonucu
-- FAIL ise adım çalıştırılmaz — blok aksiyonu önlediği için önceki adımların kompensasyonu
-- tetiklenmez.
--
-- Adlandırma: mevcut tarih-damgalı düzen (20260609* gibi).
-- Örnek: supabase/migrations/20260609130000_tedarik_tools_seed.sql

UPDATE public.playbooks
SET steps = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'agent' = 'Operator'
        AND (s->'toolPermissions' IS NOT NULL
             OR (s->>'goal') ILIKE '%purchase_order%'
             OR (s->>'goal') ILIKE '%sat%n alma%'
             OR (s->>'goal') ILIKE '%sipari%')
      THEN s || '{"blockOnVerifierFail": true}'::jsonb
      ELSE s
    END
  )
  FROM jsonb_array_elements(steps) s
)
WHERE slug = 'e-ticaret-tedarik-tam-akis';

-- Fallback: slug'ı bilmiyorsak ya da steps içinde 'tool':'purchase_order' alanı varsa
UPDATE public.playbooks
SET steps = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'tool' = 'purchase_order'
      THEN s || '{"blockOnVerifierFail": true}'::jsonb
      ELSE s
    END
  )
  FROM jsonb_array_elements(steps) s
)
WHERE slug = 'e-ticaret-tedarik-tam-akis'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(steps) s
    WHERE (s->>'blockOnVerifierFail')::boolean = true
  );

COMMENT ON TABLE public.playbooks IS
  'steps JSONB kolonundaki adımlar blockOnVerifierFail:true bayrağı taşıyabilir. '
  'Orchestrator bu bayrağı görünce önceki Verifier FAIL ise adımı çalıştırmaz.';
