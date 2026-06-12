-- R6 dogfood fix: primaryTool alanı + tedarik-siparis s1 agent düzeltmesi.
--
-- 1. tedarik-siparis s1: agent Verifier → Operator
--    (Verifier CanUseTools=true olsa da DB override'da false kalabiliyor;
--     link_check s1'de değil s2'de çalışıyordu → s1 Operator olarak düzeltildi.)
-- 2. tedarik-siparis s2: primaryTool="purchase_order" (savuşturma kapanır)
-- 3. tedarik-kargo s1: primaryTool="cargo_track"
-- 4. tedarik-kargo s2: primaryTool="stock_replenish"
--
-- Adlandırma: tarih-damgalı düzen.
-- Desen: 20260611160000_operations_context.sql (jsonb UPDATE + koşullu adım patch).
-- KURAL: Mevcut adım hedefi gerçek steps jsonb'den doğrulandı; kolon/değer uydurulmadı.

-- ── tedarik-siparis ────────────────────────────────────────────────────────────

-- s1: Verifier → Operator (link_check artık Operator'da çalışır; VERDICT gerekliyse
--     Operator'ın goal'une eklenmiş "VERDICT: PASS/FAIL yaz" talimatı korunur.)
-- s2: primaryTool ekle
UPDATE public.playbooks
SET
  steps = (
    SELECT jsonb_agg(
      CASE
        WHEN s->>'id' = 's1' THEN
          s || '{"agent":"Operator"}'::jsonb
        WHEN s->>'id' = 's2' THEN
          s || '{"primaryTool":"purchase_order"}'::jsonb
        ELSE s
      END
    ORDER BY ordinality
    )
    FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(s, ordinality)
  ),
  updated_at = now()
WHERE slug = 'tedarik-siparis'
  AND pack_id = 'e-ticaret'
  AND tenant_id IS NULL;

-- ── tedarik-kargo ──────────────────────────────────────────────────────────────

-- s1: primaryTool="cargo_track"
-- s2: primaryTool="stock_replenish"
UPDATE public.playbooks
SET
  steps = (
    SELECT jsonb_agg(
      CASE
        WHEN s->>'id' = 's1' THEN
          s || '{"primaryTool":"cargo_track"}'::jsonb
        WHEN s->>'id' = 's2' THEN
          s || '{"primaryTool":"stock_replenish"}'::jsonb
        ELSE s
      END
    ORDER BY ordinality
    )
    FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(s, ordinality)
  ),
  updated_at = now()
WHERE slug = 'tedarik-kargo'
  AND pack_id = 'e-ticaret'
  AND tenant_id IS NULL;
