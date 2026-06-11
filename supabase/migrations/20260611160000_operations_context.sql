-- PR6: Tedarik → Operations kapalı döngü.
-- 1. operations.context_json  : stok tetik metadata'sı (çift tetik koruması için).
-- 2. operation_events.kind CHECK : 'kpi_summary' eklendi.
-- 3. Alt-playbook seed'leri   : tedarik akışı üç fazlı alt-playbook'a bölündü.
-- 4. stock_replenish araç kaydı.
--
-- Adlandırma: tarih-damgalı düzen. RLS deseni: 20260611140000_operations.sql izlendi.

-- ── 1. operations.context_json ───────────────────────────────────────────────
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS context_json JSONB;

COMMENT ON COLUMN public.operations.context_json IS
  'Tetikleyici metadata. Stok tetikleri için: '
  '{stock_trigger_product, reorder_quantity, target_stock, current_stock_at_trigger}. '
  'stockMonitorTick çift tetik korumasını context_json->>''stock_trigger_product'' ile yapar.';

-- ── 2. operation_events.kind CHECK genişlet ───────────────────────────────────
ALTER TABLE public.operation_events
  DROP CONSTRAINT IF EXISTS operation_events_kind_check;

ALTER TABLE public.operation_events
  ADD CONSTRAINT operation_events_kind_check
    CHECK (kind IN ('observe','decide','act','escalate','kpi_summary'));

-- ── 3. Alt-playbook seed'leri ─────────────────────────────────────────────────
-- Tedarik akışı 3 fazlı alt-playbook'a bölündü (DB-first; portal üzerinden de düzenlenebilir).
-- LLM bu slug'ları DECIDE yanıtında kullanır; var olmayan slug escalate fırtınası yaratır.
--
-- Gerçek tablo şeması (0019_domain_packs.sql):
--   slug, pack_id, tenant_id, name, description, goal, steps (JSONB), default_risk, required_tools
-- NULL tenant_id = sistem/built-in playbook (tüm tenant'lara açık).
--
-- PlaybookStep sözleşmesi (Playbook.cs:23, hepsi required):
--   id (string), agent (string), goal (string), output (string)
--   + opsiyonel: blockOnVerifierFail (bool)
-- DomainPackDbLoader.ToPlaybook(): steps JSONB → PlaybookStep listesi; Id=slug, Title=name, DefaultPersona="default".
-- Araç çağıran adımlar "agent":"Operator" (CanUseTools=true); analiz/yazma "Analyst"/"Writer".
--
-- Idempotent: WHERE NOT EXISTS + UNIQUE(slug,pack_id,tenant_id).
-- NOT: PostgreSQL UNIQUE nullable sütunlarda NULL≠NULL sayar; built-in satırlar WHERE NOT EXISTS ile korunur.
--
-- Faz 1: Araştırma — stok kontrol, ürün arama, karşılaştırma, öneri, link doğrulama
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'tedarik-arastirma',
  'e-ticaret',
  NULL,
  'Tedarik — Araştırma',
  'Eşik altı ürün için tedarikçi araştırması: stok kontrol, ürün arama, karşılaştırma, öneri, link doğrulama.',
  'En uygun tedarikçiyi bul ve doğrulanmış satın alma önerisi hazırla.',
  '[
    {"id":"s1","agent":"Operator","goal":"stock_check aracıyla mevcut stok düzeyi ve reorder miktarını doğrula.","output":"Stok raporu: mevcut adet, eşik, hedef, gerekli sipariş miktarı."},
    {"id":"s2","agent":"Operator","goal":"product_search aracıyla en az 3 tedarikçi/pazar yeri seçeneği bul; her biri için fiyat, teslim süresi ve gerçek URL kaydet.","output":"Tedarikçi karşılaştırma tablosu: marka, model, fiyat, URL, teslim süresi."},
    {"id":"s3","agent":"Analyst","goal":"Fiyat, güvenilirlik ve teslim süresine göre en iyi seçeneği analiz et ve seç.","output":"Seçilen tedarikçi gerekçesi: neden tercih edildi, alternatifler neden elendi."},
    {"id":"s4","agent":"Writer","goal":"Seçilen ürün için marka, model, ürün kodu, gerçek URL, adet ve birim fiyat içeren satın alma önerisi yaz.","output":"Satın alma öneri belgesi: tüm alanlar dolu, URL doğrulanmış."},
    {"id":"s5","agent":"Verifier","goal":"link_check aracıyla önerilen ürün URL''lerini doğrula. FAIL durumunda alternatif URL öner.","output":"Link doğrulama raporu: PASS/FAIL ve sonuç."}
  ]'::jsonb,
  'R1',
  ARRAY['stock_check','product_search','link_check']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'tedarik-arastirma' AND pack_id = 'e-ticaret' AND tenant_id IS NULL
);

-- Faz 2: Sipariş — önce Verifier yeniden doğrular (PR2 kilidi korunur), ardından PO (blockOnVerifierFail:true)
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'tedarik-siparis',
  'e-ticaret',
  NULL,
  'Tedarik — Sipariş',
  'Araştırma sonucu seçilen ürün için insan onaylı satın alma siparişi. Verifier kilidi aktif.',
  'Doğrulanmış öneri için insan onaylı sipariş ver.',
  '[
    {"id":"s1","agent":"Verifier","goal":"link_check aracıyla araştırma adımından gelen ürün URL''lerini yeniden doğrula. Satın alma URL''si geçersizse VERDICT: FAIL yaz.","output":"Nihai link doğrulama: PASS veya VERDICT: FAIL + gerekçe."},
    {"id":"s2","agent":"Operator","goal":"purchase_order aracıyla siparişi ver. Araştırma adımından gelen marka/model/kod/url/fiyat/adet bilgilerini eksiksiz geç. R3 onay kuyruğuna düşer; insan onayı gerekir.","output":"Sipariş onayı: order_id, tracking_number, tahmini teslim tarihi.","blockOnVerifierFail":true}
  ]'::jsonb,
  'R3',
  ARRAY['link_check','purchase_order']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'tedarik-siparis' AND pack_id = 'e-ticaret' AND tenant_id IS NULL
);

-- Faz 3: Kargo ve stok yenileme — cargo_track (durum), stock_replenish (teslimde), özet
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'tedarik-kargo',
  'e-ticaret',
  NULL,
  'Tedarik — Kargo ve Stok Yenileme',
  'Sipariş sonrası kargo takibi; teslim anında stock_replenish (write/R1) ile stok güncelleme.',
  'Kargo teslim edildi durumuna ulaşsın; stok hedef seviyeye çıksın.',
  '[
    {"id":"s1","agent":"Operator","goal":"cargo_track aracıyla sipariş kargo durumunu kontrol et. tracking_number ve carrier bilgisini sipariş çıktısından al.","output":"Kargo durumu: mevcut aşama ve tahmini teslim tarihi."},
    {"id":"s2","agent":"Operator","goal":"Kargo durumu ''Teslim edildi'' ise stock_replenish aracıyla stoğu güncelle. product ve quantity alanlarını sipariş bilgisinden al.","output":"Stok güncelleme: stock_updated:true, replenished_at."},
    {"id":"s3","agent":"Writer","goal":"Sipariş süreci, teslim tarihi ve stok güncel durumunu özetleyen kısa kapanış raporu yaz.","output":"Teslim özeti: ürün, adet, tedarikçi, teslim tarihi, yeni stok düzeyi."}
  ]'::jsonb,
  'R1',
  ARRAY['cargo_track','stock_replenish']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'tedarik-kargo' AND pack_id = 'e-ticaret' AND tenant_id IS NULL
);

-- ── 4. stock_replenish araç kaydı ────────────────────────────────────────────
-- write/R1/reversible: normal ToolExecutor + RiskGate + invocation kaydından geçer.
-- Compensation: adjust_stock(-qty) — stok iptal edilince geri alınır.
INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, config_schema
) VALUES (
    'stock_replenish',
    'Stok Yenile',
    'Teslim edilen sipariş için stock_levels.current_stock''u artırır (adjust_stock RPC). '
    'write/R1 — ToolExecutor + RiskGate kaydından geçer. '
    'Compensation: adjust_stock(-qty) ile geri alınabilir.',
    'commerce', 'none',
    'write', true, 'R1',
    '{"type":"object","required":["product","quantity"],"properties":{"product":{"type":"string"},"quantity":{"type":"integer","minimum":1},"order_id":{"type":"string"},"tracking_number":{"type":"string"}}}'
) ON CONFLICT (slug) DO UPDATE SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    category     = EXCLUDED.category,
    side_effect  = EXCLUDED.side_effect,
    reversible   = EXCLUDED.reversible,
    min_risk     = EXCLUDED.min_risk,
    config_schema = EXCLUDED.config_schema,
    updated_at   = now();

NOTIFY pgrst, 'reload schema';
