-- PR-S2: Meta MCP + onay gate'li sosyal post yayını.
-- 1. mcp_servers: meta-social (mock endpoint — PR-S7'de UPDATE migration ile gerçek URL).
-- 2. tools: meta-social__post_publish (write/R2, reversible=true; compensation PR-S7'de post_delete).
-- 3. sosyal-post-uret: s3 yayın adımı + default_risk R2.
--
-- NOT: mcp_servers.endpoint çalışma anında env ile override edilmez; CLI DB URL kullanır.
-- Mock: scripts/mock-meta-mcp.ts (http://127.0.0.1:3847/mcp).

-- ── 1. mcp_servers ───────────────────────────────────────────────────────────
INSERT INTO public.mcp_servers (
  owner_user_id, slug, display_name, transport, endpoint, auth_env, enabled
)
SELECT
  NULL,
  'meta-social',
  'Meta Social (Facebook/Instagram)',
  'http',
  'http://127.0.0.1:3847/mcp',
  'META_ACCESS_TOKEN',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.mcp_servers
  WHERE slug = 'meta-social' AND owner_user_id IS NULL
);

-- ── 2. tools — meta-social__post_publish ───────────────────────────────────
INSERT INTO public.tools (
  slug, name, description, category, auth_type,
  side_effect, reversible, min_risk, compensation,
  config_schema, mcp_server_id, mcp_tool_name
)
SELECT
  'meta-social__post_publish',
  'Meta Post Yayınla',
  'Onaylı post taslağını Meta Graph API üzerinden yayınlar (MCP post_publish). R2 — insan onayı gerekir.',
  'communication',
  'api_key',
  'write',
  true,
  'R2',
  NULL,
  '{"type":"object","required":["platform","text"],"properties":{"platform":{"type":"string","enum":["facebook","instagram"]},"text":{"type":"string"},"media_url":{"type":"string"}}}'::jsonb,
  s.id,
  'post_publish'
FROM public.mcp_servers s
WHERE s.slug = 'meta-social' AND s.owner_user_id IS NULL
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
  mcp_server_id = EXCLUDED.mcp_server_id,
  mcp_tool_name = EXCLUDED.mcp_tool_name,
  updated_at    = now();

-- ── 3. sosyal-post-uret — yayın adımı (s3) + R2 ─────────────────────────────
UPDATE public.playbooks
SET
  name = 'Sosyal — Post Üret ve Yayınla',
  description = 'Konudan platforma özel post metni üretir; verifier onayı ve insan onayı sonrası Meta''da yayınlar.',
  goal = 'Topic''ten post taslağı üret; verifier PASS ve insan onayı sonrası yayınla.',
  default_risk = 'R2',
  required_tools = ARRAY['meta-social__post_publish'],
  steps = '[
    {"id":"s1","agent":"Writer","goal":"Verilen topic ve hedef platform için post metni, başlık ve görsel brief üret. Karakter limiti, CTA ve hashtag kurallarına uy.","output":"Post taslağı: platform, metin, başlık, görsel brief, önerilen hashtag''ler."},
    {"id":"s2","agent":"Verifier","goal":"Domain pack verifier rubric''ine göre post taslağını denetle: marka sesi, yasaklı içerik, CTA, hashtag limiti. Eksik varsa VERDICT: FAIL yaz.","output":"post-taslagi.md — onaylı post taslağı veya VERDICT: FAIL + düzeltme listesi.","blockOnVerifierFail":true},
    {"id":"s3","agent":"Operator","goal":"meta-social__post_publish ile onaylı taslağı yayınla. post-taslagi.md içindeki platform ve metni argümanlara geç.","output":"Yayın kaydı: post_id, url","primaryTool":"meta-social__post_publish","blockOnVerifierFail":true}
  ]'::jsonb,
  updated_at = now()
WHERE slug = 'sosyal-post-uret'
  AND pack_id = 'sosyal-medya'
  AND tenant_id IS NULL;

NOTIFY pgrst, 'reload schema';
