-- PR-S5: Sosyal metrik araçları + haftalık rapor playbook + schedule şablonları.
-- ads_metrics_fetch: demo spent hesaplanır; ledger.spent güncellenmez (PR-S7).
-- persona_schedules: enabled=false şablon — gerçek owner UUID + portal'dan enable.

-- ── 1. tools seed ────────────────────────────────────────────────────────────
INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, compensation, config_schema
) VALUES
  (
    'social_metrics_fetch',
    'Sosyal Metrik Çek',
    'Platform organik metriklerini döner (demo, deterministik).',
    'data', 'none',
    'read', true, 'R0', NULL,
    '{"type":"object","required":["platform"],"properties":{"platform":{"type":"string","enum":["facebook","instagram","x"]},"since":{"type":"string"},"until":{"type":"string"}}}'
  ),
  (
    'ads_metrics_fetch',
    'Reklam Metrik Çek',
    'Kampanya reklam metriklerini döner. Demo spent deterministik hesaplanır; ad_spend_ledger.spent güncellenmez (PR-S7).',
    'data', 'none',
    'read', true, 'R0', NULL,
    '{"type":"object","required":["campaign_id"],"properties":{"campaign_id":{"type":"string"}}}'
  )
ON CONFLICT (slug) DO UPDATE SET
    name          = EXCLUDED.name,
    description   = EXCLUDED.description,
    category      = EXCLUDED.category,
    auth_type     = EXCLUDED.auth_type,
    side_effect   = EXCLUDED.side_effect,
    reversible    = EXCLUDED.reversible,
    min_risk      = EXCLUDED.min_risk,
    compensation  = EXCLUDED.compensation,
    config_schema = EXCLUDED.config_schema,
    updated_at    = now();

-- ── 2. sosyal-haftalik-rapor playbook ────────────────────────────────────────
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'sosyal-haftalik-rapor',
  'sosyal-medya',
  NULL,
  'Sosyal — Haftalık Rapor',
  'Organik ve reklam metriklerinden haftalık performans raporu.',
  'Metrikleri çek; içgörü ve öneri üret. ads_metrics_fetch çıktısında anomaly_spike=true ise kampanyayı duraklat önerisi yaz.',
  '[
    {"id":"s1","agent":"Operator","goal":"social_metrics_fetch ile hedef platform organik metriklerini çek; ads_metrics_fetch ile aktif kampanya metriklerini çek (campaign_id).","output":"Metrik ham verisi: organik + reklam."},
    {"id":"s2","agent":"Analyst","goal":"Metrikleri yorumla: erişim, etkileşim oranı, CPC/CPM/ROAS. ads_metrics_fetch çıktısında anomaly_spike=true (spent > daily_budget × 1.2) ise raporda ayrı ''Kampanyayı Duraklat Önerisi'' bölümü yaz.","output":"Haftalık içgörü taslağı + anomali notu (varsa)."},
    {"id":"s3","agent":"Verifier","goal":"Rapor tutarlılığını doğrula; gelecek hafta önerisi ekle. Uygunsa VERDICT: PASS yaz.","output":"haftalik-rapor.md — doğrulanmış haftalık rapor veya VERDICT: FAIL + eksikler."}
  ]'::jsonb,
  'R1',
  ARRAY['social_metrics_fetch','ads_metrics_fetch'],
  ARRAY['sosyal-medya','rapor','metrik']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'sosyal-haftalik-rapor' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

-- ── 3. persona_schedules şablonları (enabled=false) ─────────────────────────
-- Placeholder owner: deploy''da gerçek auth.users UUID ile değiştir + portal''dan enable et.
-- schedulerTick enabled=true kayıtları tetikler; şablonlar pasif kalmalı.

INSERT INTO public.persona_schedules (
  owner_user_id, tenant_id, name, description, domain_pack, persona_slug, playbook_slug,
  topic_template, cron_expression, timezone, risk, enabled
)
SELECT
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  'Sabah inbox triyajı',
  'Şablon — gerçek owner UUID yaz + enable et (PR-S5).',
  'sosyal-medya',
  'community-manager',
  'sosyal-etkilesim-yanit',
  '{{date}} sabah inbox triyajı',
  '0 8 * * *',
  'Europe/Istanbul',
  'R1',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.persona_schedules
  WHERE name = 'Sabah inbox triyajı' AND domain_pack = 'sosyal-medya' AND owner_user_id = '00000000-0000-4000-8000-000000000099'::uuid
);

INSERT INTO public.persona_schedules (
  owner_user_id, tenant_id, name, description, domain_pack, persona_slug, playbook_slug,
  topic_template, cron_expression, timezone, risk, enabled
)
SELECT
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  'Öğlen inbox triyajı',
  'Şablon — gerçek owner UUID yaz + enable et (PR-S5).',
  'sosyal-medya',
  'community-manager',
  'sosyal-etkilesim-yanit',
  '{{date}} öğlen inbox triyajı',
  '0 13 * * *',
  'Europe/Istanbul',
  'R1',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.persona_schedules
  WHERE name = 'Öğlen inbox triyajı' AND domain_pack = 'sosyal-medya' AND owner_user_id = '00000000-0000-4000-8000-000000000099'::uuid
);

INSERT INTO public.persona_schedules (
  owner_user_id, tenant_id, name, description, domain_pack, persona_slug, playbook_slug,
  topic_template, cron_expression, timezone, risk, enabled
)
SELECT
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  'İçerik takvimi',
  'Şablon — gerçek owner UUID yaz + enable et (PR-S5).',
  'sosyal-medya',
  'icerik-stratejisti',
  'sosyal-icerik-takvimi',
  '{{date}} haftalık içerik takvimi',
  '0 9 * * 1',
  'Europe/Istanbul',
  'R1',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.persona_schedules
  WHERE name = 'İçerik takvimi' AND domain_pack = 'sosyal-medya' AND owner_user_id = '00000000-0000-4000-8000-000000000099'::uuid
);

INSERT INTO public.persona_schedules (
  owner_user_id, tenant_id, name, description, domain_pack, persona_slug, playbook_slug,
  topic_template, cron_expression, timezone, risk, enabled
)
SELECT
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  'Haftalık rapor',
  'Şablon — gerçek owner UUID yaz + enable et (PR-S5).',
  'sosyal-medya',
  'sosyal-analist',
  'sosyal-haftalik-rapor',
  '{{date}} haftalık sosyal medya raporu',
  '0 9 * * 5',
  'Europe/Istanbul',
  'R1',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.persona_schedules
  WHERE name = 'Haftalık rapor' AND domain_pack = 'sosyal-medya' AND owner_user_id = '00000000-0000-4000-8000-000000000099'::uuid
);

INSERT INTO public.persona_schedules (
  owner_user_id, tenant_id, name, description, domain_pack, persona_slug, playbook_slug,
  topic_template, cron_expression, timezone, risk, enabled
)
SELECT
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  'Kampanya metrik kontrolü',
  'Şablon — gerçek owner UUID yaz + enable et (PR-S5).',
  'sosyal-medya',
  'sosyal-analist',
  'sosyal-haftalik-rapor',
  '{{date}} günlük kampanya metrik kontrolü',
  '0 10 * * *',
  'Europe/Istanbul',
  'R1',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.persona_schedules
  WHERE name = 'Kampanya metrik kontrolü' AND domain_pack = 'sosyal-medya' AND owner_user_id = '00000000-0000-4000-8000-000000000099'::uuid
);

NOTIFY pgrst, 'reload schema';
