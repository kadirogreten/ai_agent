-- Sector Factory: DomainPackDraftWriter step_id='scaffold' arar; sector-paket-taslak adımı s1 idi.
-- Adım id'sini scaffold yap (içerik aynı kalır).

UPDATE public.playbooks
SET
  steps = (
    SELECT jsonb_agg(
      CASE
        WHEN s->>'id' = 's1' THEN
          (s - 'id') || '{"id":"scaffold"}'::jsonb
        ELSE s
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(s, ordinality)
  ),
  updated_at = now()
WHERE slug = 'sector-paket-taslak'
  AND pack_id = 'system'
  AND tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(steps) s
    WHERE s->>'id' = 's1'
  );

NOTIFY pgrst, 'reload schema';
