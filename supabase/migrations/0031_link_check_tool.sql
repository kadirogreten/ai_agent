-- Faz B substance verifier: link_check aracını tools tablosuna kaydet.
-- LinkCheckTool koddan kayıtlı (CLI ToolExecutor.CreateDefault'a eklendi); bu migration
-- portal Araçlar sayfasında görünmesi + agent_tools üzerinden ilişkilendirilebilmesi için
-- DB seed satırını ekler. Idempotent (ON CONFLICT DO UPDATE).

INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk
) VALUES (
    'link_check',
    'Link Doğrulama',
    'Verilen URL listesini HEAD ile kontrol eder; her URL için status kodu ve dead/ok bilgisi döner. Substance verifier zincirinin temel parçası — uydurma kaynakları (fake URL) tespit etmek için kullanılır.',
    'utility',
    'none',
    'read',
    true,
    'R0'
) ON CONFLICT (slug) DO UPDATE SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    category     = EXCLUDED.category,
    auth_type    = EXCLUDED.auth_type,
    side_effect  = EXCLUDED.side_effect,
    reversible   = EXCLUDED.reversible,
    min_risk     = EXCLUDED.min_risk,
    updated_at   = now();
