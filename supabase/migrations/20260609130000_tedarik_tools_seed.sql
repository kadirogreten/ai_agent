-- Tedarik araçlarının REGISTRY kayıtları (kodun aynası).
-- Bir araç ancak CLI ToolExecutor.CreateDefault'ta tanımlıysa çalışır; bu tablo o kod
-- kataloğunun DB aynasıdır (mevcut 8 aracın 0017/0031'de yapıldığı gibi). Portal Araçlar
-- sayfası + Yeni İş sihirbazındaki araç seçimi bu satırlardan beslenir.
-- Idempotent (ON CONFLICT DO UPDATE). 'commerce'/'logistics' kategorileri için kategori
-- CHECK'i 20260609120000 migration'ında genişletildi (bu dosyadan önce çalışır).

INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, compensation, config_schema
) VALUES
  (
    'stock_check',
    'Stok Kontrol',
    'Bir ürünün güncel stok seviyesini (stock_levels) okur; eşik altında mı bilgisini döner.',
    'data', 'none',
    'read', true, 'R0', NULL,
    '{"type":"object","required":["product"],"properties":{"product":{"type":"string"},"threshold":{"type":"integer"}}}'
  ),
  (
    'purchase_order',
    'Satın Alma Siparişi',
    'Seçilen ürün için tedarikçiye sipariş geçer. Yüksek riskli (R3) — insan onayı gerektirir; onaysız sipariş geçmez. (Demo: gerçekçi sipariş/takip no üretir.)',
    'commerce', 'none',
    'external', true, 'R3', 'cancel_order',
    '{"type":"object","required":["product","quantity"],"properties":{"product":{"type":"string"},"quantity":{"type":"integer","minimum":1},"supplier":{"type":"string"},"unit_price":{"type":"number"}}}'
  ),
  (
    'cargo_track',
    'Kargo Takip',
    'Verilen takip numarasının güncel kargo durumunu ve hareket geçmişini döner.',
    'logistics', 'none',
    'read', true, 'R1', NULL,
    '{"type":"object","required":["tracking_number"],"properties":{"tracking_number":{"type":"string"},"carrier":{"type":"string"}}}'
  )
ON CONFLICT (slug) DO UPDATE SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    category     = EXCLUDED.category,
    auth_type    = EXCLUDED.auth_type,
    side_effect  = EXCLUDED.side_effect,
    reversible   = EXCLUDED.reversible,
    min_risk     = EXCLUDED.min_risk,
    compensation = EXCLUDED.compensation,
    config_schema = EXCLUDED.config_schema,
    updated_at   = now();

NOTIFY pgrst, 'reload schema';
