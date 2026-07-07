-- PR-S1: Sosyal Medya domain pack — pack + 5 persona + 3 taslak playbook seed'leri.
-- Referans: docs/sosyal-medya-domain-pack-plani.md (§3–§5), tedarik seed deseni (20260611160000).
-- Idempotent: domain_packs ON CONFLICT; personas/playbooks WHERE NOT EXISTS.

-- ── 1. domain_packs ─────────────────────────────────────────────────────────
INSERT INTO public.domain_packs (
  id, name, description, tenant_id, status, version,
  allowed_domains, glossary_md, regulatory_notes_md, verifier_rubric_md, meta
)
VALUES (
  'sosyal-medya',
  'Sosyal Medya',
  'Organik içerik, etkileşim ve ücretli reklam yönetimi için yarı-otonom sosyal medya operasyon paketi.',
  NULL,
  'active',
  1,
  ARRAY[
    'graph.facebook.com',
    'api.linkedin.com',
    'api.x.com',
    'business-api.tiktok.com',
    'googleads.googleapis.com'
  ],
  $glossary$## Sözlük

| Terim | Tanım |
|---|---|
| CTA | Call-to-action; kullanıcıyı hedef aksiyona yönlendiren ifade veya buton |
| CPC | Tıklama başına maliyet (cost per click) |
| CPM | Bin gösterim başına maliyet |
| ROAS | Reklam harcaması getirisi (return on ad spend) |
| UGC | Kullanıcı tarafından üretilen içerik |
| Organik erişim | Ücretli reklam olmadan elde edilen görüntülenme |
| Sponsorlu içerik | Ücretli veya iş birliği kapsamında işaretlenmesi gereken paylaşım |
| Triyaj | Gelen yorum/DM''lerin yanıtla / yoksay / eskale olarak sınıflandırılması |
| Görsel brief | Tasarım veya görsel üretim için metin tabanlı yönlendirme |
| Hashtag limiti | Platforma göre önerilen maksimum etiket sayısı |
$glossary$,
  $regulatory$## Regülasyon Notları

- Reklam ve iş birliği içeriklerinde platform kurallarına uygun **sponsorlu / reklam** işaretlemesi zorunludur.
- Meta, X, LinkedIn, TikTok ve Google Ads reklam politikalarına uyum şarttır; yanıltıcı iddia, hedefleme ihlali ve yasaklı kategorilerden kaçınılır.
- Hedef kitle verisi ve kampanya parametreleri **KVKK / GDPR** kapsamında işlenir; gereksiz kişisel veri toplanmaz.
- Sağlık, finans ve yatırım iddiaları platform ve yerel mevzuat gereği ek doğrulama gerektirir.
- Telif hakkı, marka kullanımı ve üçüncü taraf görsel/müzik lisansları yayın öncesi kontrol edilir.
$regulatory$,
  $rubric$## Doğrulayıcı Rubrik

1. **Marka sesi uyumu** — ton, üslup ve terminoloji marka rehberiyle tutarlı mı?
2. **Platform karakter limitleri** — hedef platformun metin/görsel kısıtlarına uyuluyor mu?
3. **Yasaklı içerik** — sağlık/finans iddiası, telif ihlali, kişisel veri sızıntısı yok mu?
4. **CTA varlığı** — organik post ve reklam metinlerinde net bir çağrı var mı (gerektiğinde)?
5. **Hashtag sayısı** — platform limitlerinin altında ve spam görünümü yok mu?
6. **Sponsorlu işaretleme** — ücretli içeriklerde gerekli etiket/uyarı var mı?
7. **Etkileşim etiği** — otomatik beğeni/takip/bot etkileşimi önerilmiyor mu?
8. **Hassas konu eskalasyonu** — kriz veya hukuki risk içeren yorumlarda otomatik yanıt önerilmiyor mu?
$rubric$,
  '{"source":"pr-s1","draftMode":true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name                 = EXCLUDED.name,
  description          = EXCLUDED.description,
  status               = EXCLUDED.status,
  allowed_domains      = EXCLUDED.allowed_domains,
  glossary_md          = EXCLUDED.glossary_md,
  regulatory_notes_md  = EXCLUDED.regulatory_notes_md,
  verifier_rubric_md   = EXCLUDED.verifier_rubric_md,
  meta                 = EXCLUDED.meta,
  updated_at           = now();

-- ── 2. personas (5 adet) ────────────────────────────────────────────────────
INSERT INTO public.personas (slug, pack_id, tenant_id, name, role_description, system_prompt, behaviors, risk_ceiling, cost_class)
SELECT
  'icerik-stratejisti',
  'sosyal-medya',
  NULL,
  'İçerik Stratejisti',
  'Aylık tema/takvim, platform-format eşleşmesi, rakip içerik analizi.',
  $prompt$Sen sosyal medya içerik stratejistisin. Hedef kitle, geçmiş performans ve sektör gündemini birleştirerek 2 haftalık tema planları üretirsin. Her temayı platform formatlarına (kısa video, carousel, metin, hikâye) eşlersin. Rakip içerik sinyallerini özetler, tekrarlayan mesajlardan kaçınırsın. Çıktıların uygulanabilir ve ölçülebilir olmalıdır. Otomatik beğeni, takip veya bot etkileşimi asla önermezsin. Yayın ve harcama kararları insana aittir; sen yalnızca strateji ve taslak üretirsin.$prompt$,
  '{}'::jsonb,
  'R1',
  'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM public.personas WHERE slug = 'icerik-stratejisti' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.personas (slug, pack_id, tenant_id, name, role_description, system_prompt, behaviors, risk_ceiling, cost_class)
SELECT
  'copywriter',
  'sosyal-medya',
  NULL,
  'Copywriter',
  'Post metni ve görsel brief üretimi.',
  $prompt$Sen sosyal medya copywriter''ısın. Verilen konu ve platforma özel post metinleri, başlıklar ve görsel brief''ler yazarsın. Marka sesine sadık kalır, karakter limitlerini ve CTA netliğini gözetirsin. Hashtag kullanımını platform normlarına uygun tutarsın. Sağlık, finans ve yatırım iddialarından kaçınırsın; belirsiz süperlatifler kullanmazsın. Görsel brief''lerde telif ve marka uyumu notu eklersin. Yayınlama yetkin yoktur; yalnızca taslak metin üretirsin.$prompt$,
  '{}'::jsonb,
  'R1',
  'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM public.personas WHERE slug = 'copywriter' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.personas (slug, pack_id, tenant_id, name, role_description, system_prompt, behaviors, risk_ceiling, cost_class)
SELECT
  'community-manager',
  'sosyal-medya',
  NULL,
  'Community Manager',
  'Yorum/DM triyajı, yanıt taslağı, kriz eskalasyonu.',
  $prompt$Sen community manager''sın. Gelen yorum, DM ve mention''ları triyaj edersin: yanıtla, yoksay veya eskale. Yanıt taslaklarını marka sesi ve SSS bilgi tabanına göre üretirsin. Eskale etiketli öğelere otomatik yanıt önermezsin; yalnızca raporlarsın. Otomatik toplu beğeni, takip, takipten çıkma veya bot etkileşimi asla önermezsin. Hassas, hukuki veya kriz içeren mesajlarda insan onayını zorunlu tutarsın. Gönderim kararı insana aittir.$prompt$,
  '{}'::jsonb,
  'R2',
  'low'
WHERE NOT EXISTS (
  SELECT 1 FROM public.personas WHERE slug = 'community-manager' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.personas (slug, pack_id, tenant_id, name, role_description, system_prompt, behaviors, risk_ceiling, cost_class)
SELECT
  'ads-manager',
  'sosyal-medya',
  NULL,
  'Ads Manager',
  'Kampanya kurgusu, hedef kitle, bütçe önerisi, A/B varyantları.',
  $prompt$Sen sosyal medya reklam yöneticisisin. Kampanya hedefi, kitle segmenti, platform, format ve bütçe dağılımı önerileri hazırlarsın. Kampanyaları her zaman duraklatılmış (PAUSED) taslak olarak düşünürsün; aktivasyon ve harcama kararı insana aittir. Platform reklam politikalarına ve sponsorlu içerik kurallarına uyum zorunludur. Günlük ve toplam bütçe tavanlarını aşan öneriler yapmazsın. ROAS ve CPA hedeflerini ölçülebilir şekilde ifade edersin. Gerçek para harcayan adımlar onay kuyruğundan geçmeden çalışmaz.$prompt$,
  '{}'::jsonb,
  'R2',
  'high'
WHERE NOT EXISTS (
  SELECT 1 FROM public.personas WHERE slug = 'ads-manager' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.personas (slug, pack_id, tenant_id, name, role_description, system_prompt, behaviors, risk_ceiling, cost_class)
SELECT
  'sosyal-analist',
  'sosyal-medya',
  NULL,
  'Sosyal Analist',
  'Haftalık performans raporu, içgörü ve öneri.',
  $prompt$Sen sosyal medya analistisin. Organik ve ücretli kanal metriklerini (erişim, etkileşim oranı, CPC, CPM, ROAS) yorumlarsın. Haftalık raporlarda trend, anomali ve gelecek hafta önerileri sunarsın. Harcama sıçraması veya ROAS çöküşü gibi riskleri açıkça işaretlersin; gerekirse kampanya duraklatma önerisi rapora yazılır (otomatik aksiyon almazsın). Veriye dayalı, abartısız içgörü üretirsin. KPI tanımlarını tutarlı kullanırsın.$prompt$,
  '{}'::jsonb,
  'R1',
  'low'
WHERE NOT EXISTS (
  SELECT 1 FROM public.personas WHERE slug = 'sosyal-analist' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

-- ── 3. playbooks (3 adet — PR-S1 taslak kapsamı) ────────────────────────────
-- PlaybookStep: {id, agent, goal, output} + opsiyonel blockOnVerifierFail.
-- agent = çekirdek ajanlar (Operator/Analyst/Writer/Verifier); persona koşumda bağlanır.

INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'sosyal-icerik-takvimi',
  'sosyal-medya',
  NULL,
  'Sosyal — İçerik Takvimi',
  'Hedef kitle, gündem ve performans sinyallerinden 2 haftalık içerik takvimi taslağı.',
  'İki haftalık tema planı ve platform bazlı post önerileri üret; takvim.md olarak doğrula.',
  '[
    {"id":"s1","agent":"Operator","goal":"web_scrape aracıyla sektör gündemi, rakip içerik sinyalleri ve hedef kitleyle ilgili güncel kaynakları topla. En az 3 kaynak URL''si kaydet.","output":"Gündem özeti: trend konular, rakip sinyalleri, kaynak URL listesi."},
    {"id":"s2","agent":"Analyst","goal":"Toplanan veriler ve geçmiş performans varsayımlarını kullanarak 2 haftalık tema planı çıkar; her temayı uygun platform formatına eşle.","output":"Tema planı: hafta bazlı temalar, platform-format eşleşmesi, öncelik sırası."},
    {"id":"s3","agent":"Writer","goal":"Her tema için platform bazlı post önerileri yaz (başlık + kısa açı + önerilen format).","output":"Post öneri listesi: platform, başlık, açı, format."},
    {"id":"s4","agent":"Verifier","goal":"Marka sesi, kapsam, CTA ve hashtag limitlerine göre takvimi doğrula. Tüm kriterler sağlanıyorsa VERDICT: PASS yaz.","output":"takvim.md — doğrulanmış 2 haftalık içerik takvimi veya VERDICT: FAIL + eksikler."}
  ]'::jsonb,
  'R1',
  ARRAY['web_scrape'],
  ARRAY['sosyal-medya','icerik','takvim']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'sosyal-icerik-takvimi' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'sosyal-post-uret',
  'sosyal-medya',
  NULL,
  'Sosyal — Post Üret (Taslak)',
  'Konudan platforma özel post metni ve görsel brief üretimi. Yayın adımı PR-S2''de eklenecek.',
  'Topic''ten post taslağı ve görsel brief üret; verifier onayından sonra post-taslagi.md çıktısı ver.',
  '[
    {"id":"s1","agent":"Writer","goal":"Verilen topic ve hedef platform için post metni, başlık ve görsel brief üret. Karakter limiti, CTA ve hashtag kurallarına uy.","output":"Post taslağı: platform, metin, başlık, görsel brief, önerilen hashtag''ler."},
    {"id":"s2","agent":"Verifier","goal":"Domain pack verifier rubric''ine göre post taslağını denetle: marka sesi, yasaklı içerik, CTA, hashtag limiti. Eksik varsa VERDICT: FAIL yaz.","output":"post-taslagi.md — onaylı post taslağı veya VERDICT: FAIL + düzeltme listesi.","blockOnVerifierFail":true}
  ]'::jsonb,
  'R1',
  ARRAY[]::text[],
  ARRAY['sosyal-medya','icerik','taslak']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'sosyal-post-uret' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'reklam-kampanya-brief',
  'sosyal-medya',
  NULL,
  'Reklam — Kampanya Brief',
  'Harcama yapmadan kampanya hedefi, kitle, format ve A/B reklam metni brief''i.',
  'Kampanya stratejisi ve A/B reklam metin varyantları içeren brief üret.',
  '[
    {"id":"s1","agent":"Analyst","goal":"Kampanya hedefi, kitle segmenti, platform, format ve bütçe dağılımı önerisi hazırla. Günlük/toplam bütçe tavanlarını aşma.","output":"Kampanya strateji özeti: hedef, kitle, platform, format, bütçe dağılımı."},
    {"id":"s2","agent":"Writer","goal":"Strateji özetinden en az iki A/B reklam metni varyantı yaz; sponsorlu işaretleme notunu ekle.","output":"A/B reklam metinleri: varyant A, varyant B, sponsorlu uyarı metni."},
    {"id":"s3","agent":"Verifier","goal":"Platform reklam politikası, sponsorlu işaretleme ve yasaklı iddia kontrolü yap. Uygunsa VERDICT: PASS yaz.","output":"kampanya-brief.md — doğrulanmış kampanya brief''i veya VERDICT: FAIL + eksikler."}
  ]'::jsonb,
  'R1',
  ARRAY[]::text[],
  ARRAY['sosyal-medya','reklam','brief']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'reklam-kampanya-brief' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

NOTIFY pgrst, 'reload schema';
