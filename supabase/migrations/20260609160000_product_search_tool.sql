-- product_search aracının REGISTRY kaydı (kod aynası; SerpAPI/Google Shopping backend).
-- Portal Araçlar + Yeni İş sihirbazı chip listesinde görünmesi için. Idempotent.

INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, config_schema
) VALUES (
    'product_search',
    'Ürün Arama',
    'Gerçek bir arama servisinden (SerpAPI/Google Shopping) ürünleri getirir: başlık, fiyat, satıcı ve gerçek ürün URL''si. Araştırma adımı uydurma yerine bu sonuçları kullanır. SERPAPI_KEY env gerektirir.',
    'search', 'api_key',
    'read', true, 'R0',
    '{"type":"object","required":["query"],"properties":{"query":{"type":"string"},"max_results":{"type":"integer","default":6}}}'
) ON CONFLICT (slug) DO UPDATE SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    category     = EXCLUDED.category,
    auth_type    = EXCLUDED.auth_type,
    side_effect  = EXCLUDED.side_effect,
    reversible   = EXCLUDED.reversible,
    min_risk     = EXCLUDED.min_risk,
    config_schema = EXCLUDED.config_schema,
    updated_at   = now();

NOTIFY pgrst, 'reload schema';
