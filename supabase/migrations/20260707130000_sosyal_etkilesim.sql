-- PR-S3: Sosyal inbox + yanıt playbook'u.
-- 1. tools: social_inbox_fetch (read/R0), social_reply_send (write/R2, reversible=true — Faz A uyumu).
-- 2. playbook: sosyal-etkilesim-yanit (4 adım).
-- 3. facts: 10 SSS kaydı (sosyal-medya-faq-01..10).
-- 4. community-manager persona: FactsIndex/SSS arama talimatı.

-- ── 1. tools ─────────────────────────────────────────────────────────────────
INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, compensation, config_schema
) VALUES
  (
    'social_inbox_fetch',
    'Sosyal Inbox Çek',
    'Platformdaki yeni yorum, DM ve mention listesini döner (demo veri).',
    'communication', 'none',
    'read', true, 'R0', NULL,
    '{"type":"object","required":["platform"],"properties":{"platform":{"type":"string","enum":["facebook","instagram","x"]},"since":{"type":"string"}}}'
  ),
  (
    'social_reply_send',
    'Sosyal Yanıt Gönder',
    'Onaylı yanıt metnini ilgili yorum/DM öğesine gönderir (demo). R2 — insan onayı gerekir. İş kuralı: gönderilen yanıt geri alınmaz (PR-S7: reply_delete compensation).',
    'communication', 'none',
    'write', true, 'R2', NULL,
    '{"type":"object","required":["item_id","text","platform"],"properties":{"item_id":{"type":"string"},"text":{"type":"string"},"platform":{"type":"string","enum":["facebook","instagram","x"]}}}'
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

-- ── 2. playbook — sosyal-etkilesim-yanit ───────────────────────────────────
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'sosyal-etkilesim-yanit',
  'sosyal-medya',
  NULL,
  'Sosyal — Etkileşim Yanıt',
  'Inbox triyajı, SSS tabanlı yanıt taslağı ve onaylı yanıt gönderimi.',
  'Inbox''u çek; triyaj et (yanıtla|yoksay|eskale). Eskale öğelere yanıt üretme. Onaylı yanıtları gönder; gönderilen yanıt geri alınamaz.',
  '[
    {"id":"s1","agent":"Operator","goal":"social_inbox_fetch ile platform inbox''unu çek. Her öğeyi triyaj et: yanıtla, yoksay veya eskale. Eskale: kriz, hukuki tehdit veya hassas şikayet.","output":"Inbox özeti: item_id, type, text, author, triage etiketi listesi."},
    {"id":"s2","agent":"Writer","goal":"Yalnızca triyaj=yanıtla öğeler için yanıt taslağı üret. Eskale etiketli öğelere ASLA yanıt üretme — yalnızca eskale raporu yaz. Yanıt üretmeden önce Supabase facts tablosundaki (FactsIndex) sosyal-medya SSS kayıtlarını ara; eşleşen claim''i temel al.","output":"Yanıt taslakları: item_id, platform, taslak metin; eskale raporu (varsa)."},
    {"id":"s3","agent":"Verifier","goal":"Marka sesi, triyaj tutarlılığı ve SSS uyumunu doğrula. Eskale öğelere yanıt taslağı varsa VERDICT: FAIL yaz.","output":"Doğrulanmış yanıt listesi veya VERDICT: FAIL + düzeltme listesi.","blockOnVerifierFail":true},
    {"id":"s4","agent":"Operator","goal":"social_reply_send ile onaylı yanıt taslaklarını gönder. Her çağrıda item_id, text ve platform argümanlarını geç. Gönderilen yanıt geri alınamaz.","output":"Gönderim kaydı: reply_id, item_id, sent_at","primaryTool":"social_reply_send","blockOnVerifierFail":true}
  ]'::jsonb,
  'R2',
  ARRAY['social_inbox_fetch','social_reply_send'],
  ARRAY['sosyal-medya','etkilesim','inbox']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'sosyal-etkilesim-yanit' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

-- ── 3. facts — SSS seed (10 kayıt) ─────────────────────────────────────────
INSERT INTO public.facts (
    id, domain_pack, run_id, playbook_id, topic, claim,
    evidence_url, source_title, source_domain, confidence, extracted_at
) VALUES
  (
    'sosyal-medya-faq-01', 'sosyal-medya', 'seed', 'seed',
    'Çalışma saatleriniz nedir?',
    'Hafta içi 09:00–18:00 arasında müşteri hizmetlerimiz aktiftir. Hafta sonu yalnızca acil destek hattı (09:00–14:00) açıktır.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-02', 'sosyal-medya', 'seed', 'seed',
    'Siparişim ne zaman kargoya verilir?',
    'Stokta olan siparişler 1–2 iş günü içinde kargoya verilir. Yoğun dönemlerde bu süre 3 iş gününe uzayabilir; takip numarası SMS ile iletilir.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-03', 'sosyal-medya', 'seed', 'seed',
    'İade ve değişim nasıl yapılır?',
    'Ürünü teslim aldıktan sonra 14 gün içinde kullanılmamış ve orijinal ambalajında iade edebilirsiniz. İade talebi için destek@marka.com adresine sipariş numaranızı yazın.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-04', 'sosyal-medya', 'seed', 'seed',
    'Fiyat listesini nereden görebilirim?',
    'Güncel fiyatlar web sitemizdeki ürün sayfalarında yer alır. Toplu alım veya kurumsal fiyat için satis@marka.com ile iletişime geçebilirsiniz.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-05', 'sosyal-medya', 'seed', 'seed',
    'Sponsorlu içerikleriniz nasıl işaretleniyor?',
    'Ücretli iş birlikleri ve sponsorlu paylaşımlarda #işbirliği veya #reklam etiketi kullanılır; platform kurallarına uygun şekilde açıkça belirtilir.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-06', 'sosyal-medya', 'seed', 'seed',
    'Hesabım hacklendi, ne yapmalıyım?',
    'Hemen şifrenizi değiştirin ve iki faktörlü doğrulamayı açın. Resmi hesabımızdan DM veya destek@marka.com üzerinden bize ulaşın; kimlik doğrulama sonrası yardımcı oluruz.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-07', 'sosyal-medya', 'seed', 'seed',
    'Kampanya kodum çalışmıyor.',
    'Kodun süresi dolmuş veya minimum sepet tutarı karşılanmamış olabilir. Kodu büyük/küçük harf duyarlı girin; sorun devam ederse sipariş numaranızla destek@marka.com''a yazın.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-08', 'sosyal-medya', 'seed', 'seed',
    'Hangi ödeme yöntemlerini kabul ediyorsunuz?',
    'Kredi/banka kartı, havale/EFT ve kapıda ödeme (seçili bölgeler) kabul edilir. Taksit seçenekleri ödeme sayfasında gösterilir.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-09', 'sosyal-medya', 'seed', 'seed',
    'Fiziksel mağazanız var mı?',
    'İstanbul Kadıköy''de showroom mağazamız hafta içi 10:00–19:00 arası açıktır. Randevusuz ziyaret edebilirsiniz.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  ),
  (
    'sosyal-medya-faq-10', 'sosyal-medya', 'seed', 'seed',
    'Ürün garantisi ne kadar?',
    'Tüm ürünlerde 2 yıl üretici garantisi geçerlidir. Garanti belgesi kargo ile birlikte gönderilir; arıza durumunda destek@marka.com''a başvurun.',
    NULL, 'SSS', 'sosyal-medya-faq', 1.0, now()
  )
ON CONFLICT (id) DO UPDATE SET
    domain_pack    = EXCLUDED.domain_pack,
    topic          = EXCLUDED.topic,
    claim          = EXCLUDED.claim,
    source_domain  = EXCLUDED.source_domain,
    confidence     = EXCLUDED.confidence,
    extracted_at   = EXCLUDED.extracted_at;

-- ── 4. community-manager persona — FactsIndex talimatı ───────────────────────
UPDATE public.personas
SET
  system_prompt = system_prompt || E'\n\nYanıt üretmeden önce bilgi tabanından (facts / FactsIndex) ilgili SSS kayıtlarını ara; eşleşen claim''i temel al.',
  updated_at = now()
WHERE slug = 'community-manager'
  AND pack_id = 'sosyal-medya'
  AND tenant_id IS NULL
  AND system_prompt NOT LIKE '%FactsIndex%';

NOTIFY pgrst, 'reload schema';
