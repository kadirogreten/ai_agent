# Sosyal Medya Domain Pack — Tasarım Planı

Tarih: 2026-07-07 · Durum: Taslak · Kapsam: Organik içerik + etkileşim + ücretli reklam

## 1. Amaç

Ajan ordusuna sosyal medya yönetimi yeteneği kazandırmak: içerik üretimi, yayın takvimi, yorum/DM etkileşimi ve reklam kampanyası yönetimi. Özellikle **reklam** ve **etkileşim** odaklı, insan onayı gate'li yarı-otonom bir işletim modeli.

## 2. Mevcut Mimariye Oturma

Yeni altyapı gerekmez; her parça mevcut bir yapıya eşlenir:

| İhtiyaç | Mevcut yapı |
|---|---|
| Sektör paketi | `domain_packs` tablosu, pack_id = `sosyal-medya` |
| Uzman ajanlar | `personas` (slug, system_prompt, behaviors, risk_ceiling, cost_class) |
| İş akışları | `playbooks.steps` JSONB — `{id, agent, goal, output}` formatı (tedarik-* deseni) |
| Platform API'leri | `mcp_servers` + `McpProxyTool` (Faz 1) → yerli `ITool` (Faz 2) |
| Yayın/harcama onayı | `gate_run_for_approval()` + `approval_queue` + portal approve/reject RPC |
| Zamanlanmış koşum | `persona_schedules` (cron + timezone, anomali eşiği) |
| Bütçe takibi | `runs` maliyet kolonları (`cost_usd`) + `consume_budget_for_update` |
| Kalite kontrolü | Verifier + `blockOnVerifierFail` |

## 3. Domain Pack Tanımı

- **pack_id:** `sosyal-medya`
- **allowed_domains:** yayın hedefi platform domainleri (graph.facebook.com, api.linkedin.com, api.x.com, business-api.tiktok.com, googleads.googleapis.com)
- **verifier_rubric:** marka sesi uyumu, platform karakter limitleri, yasaklı içerik kontrolü (sağlık/finans iddiası, telif, kişisel veri), CTA varlığı, hashtag sayısı limiti
- **regulatory_notes:** reklamlarda "sponsorlu" işaretleme zorunluluğu, platform reklam politikaları, KVKK/GDPR (hedef kitle verisi)

## 4. Personalar

| Slug | Rol | risk_ceiling | cost_class |
|---|---|---|---|
| `icerik-stratejisti` | Aylık tema/takvim, platform-format eşleşmesi, rakip içerik analizi | R1 | medium |
| `copywriter` | Post metni + görsel brief (playbook `image` spec ile görsel üretim) | R1 | medium |
| `community-manager` | Yorum/DM triyajı, yanıt taslağı, kriz eskalasyonu | R2 | low |
| `ads-manager` | Kampanya kurgusu, hedef kitle, bütçe önerisi, A/B varyantları | R2 | high |
| `sosyal-analist` | Haftalık performans raporu, içgörü, öneri | R1 | low |

Not: `risk_ceiling` persona'nın *tavanıdır*; yayınlama ve harcama adımları playbook düzeyinde R2/R3 işaretlenir ve onay kuyruğuna düşer (§7).

## 5. Playbook'lar

Steps formatı tedarik-* seed'leriyle aynı: `{id, agent, goal, output}` + gerekirse `primaryTool`, `blockOnVerifierFail`, `saveAs`, `image`.

### 5.1 `sosyal-icerik-takvimi` (R1)
1. `icerik-stratejisti` — hedef kitle + geçmiş performans + sektör gündemi (web_scrape) → 2 haftalık tema planı
2. `copywriter` — tema başına platform bazlı post önerileri (başlık + açı)
3. Verifier — marka sesi + kapsam kontrolü → `takvim.md`

### 5.2 `sosyal-post-uret` (R2 — yayın adımı gate'li)
1. `copywriter` — topic'ten platforma özel metin + görsel brief (`image` spec)
2. Verifier — rubrik kontrolü, `blockOnVerifierFail: true`
3. Yayın adımı — `primaryTool: social_post_publish` → **R2, approval_queue'ya düşer; insan onaylayınca yayınlanır**

### 5.3 `sosyal-etkilesim-yanit` (R1 taslak / R2 gönderim)
1. `community-manager` — `social_inbox_fetch` ile yeni yorum/DM'leri çek, triyaj: {yanıtla, yoksay, eskale}
2. Yanıt taslakları üret (SSS → bilgi tabanından, `knowledge/sosyal-medya/`)
3. Gönderim — `social_reply_send`, R2 gate. Eskalasyon etiketlileri yalnız rapora yazar, asla otomatik yanıtlamaz.

### 5.4 `reklam-kampanya-brief` (R1 — harcama yok)
1. `ads-manager` — hedef, kitle segmenti, platform, format, bütçe dağılımı önerisi
2. `copywriter` — reklam metni varyantları (A/B)
3. Verifier — platform reklam politikası kontrolü → `kampanya-brief.md`

### 5.5 `reklam-kampanya-yayinla` (R3 — para harcar)
1. `ads-manager` — brief'ten kampanya taslağı, `primaryTool: ads_campaign_create` (platformda **PAUSED** durumda oluşturur)
2. Aktivasyon adımı — `ads_campaign_activate` → **R3, zorunlu insan onayı + bütçe üst limiti yeni `ad_spend_ledger` tablosuyla takip (LLM maliyeti değil, reklam harcaması — `runs.cost_usd`'den ayrı tutulmalı)**
3. `sosyal-analist` — 24 saat sonra ilk metrik kontrolü (schedule ile ayrı tetiklenir)

### 5.6 `sosyal-haftalik-rapor` (R1)
1. `sosyal-analist` — `social_metrics_fetch` + `ads_metrics_fetch` → erişim, etkileşim oranı, CPC/CPM/ROAS
2. İçgörü + gelecek hafta önerisi → `haftalik-rapor.md`

## 6. Araç Katmanı

### Faz 1 — MCP-first (önerilen başlangıç)
`mcp_servers` tablosuna platform sunucuları eklenir; `mcp-sync` araçları `{server_slug}__{tool_name}` slug'ıyla `tools` tablosuna indirir (category: `communication`). `auth_env` ile token env'den okunur — anahtar DB'ye yazılmaz.

| Platform | API | Env |
|---|---|---|
| Facebook/Instagram | Meta Graph API + Marketing API | `META_ACCESS_TOKEN` |
| X | X API v2 | `X_BEARER_TOKEN` |
| LinkedIn | Marketing/Community API | `LINKEDIN_ACCESS_TOKEN` |
| TikTok | Business API | `TIKTOK_ACCESS_TOKEN` |
| Google Ads | Google Ads API | `GOOGLE_ADS_*` |

### Faz 2 — Yerli ITool'lar (kararlılaşınca)
`StockCheckTool` deseninde, `ToolContracts` + `ToolExecutor` üzerinden:

| Slug | İşlev | Risk |
|---|---|---|
| `social_post_publish` | Post yayınlama (platform, metin, medya) | R2 |
| `social_inbox_fetch` | Yorum/DM/mention çekme | R0 |
| `social_reply_send` | Yanıt gönderme | R2 |
| `social_metrics_fetch` | Organik metrikler | R0 |
| `ads_campaign_create` | Kampanya oluşturma (PAUSED) | R1 |
| `ads_campaign_activate` | Kampanya aktivasyonu (harcama başlar) | R3 |
| `ads_metrics_fetch` | Reklam metrikleri | R0 |

Persona izinleri `ToolPermissions` formatıyla: örn. `community-manager` → `tools: social_inbox_fetch, social_reply_send; max_calls: 20`.

## 7. Onay ve Risk Modeli

- **R0:** okuma (inbox, metrik) — serbest
- **R1:** taslak/analiz üretimi — serbest, Verifier'lı
- **R2:** dış dünyaya içerik gönderimi (post, yanıt) — `gate_run_for_approval`, portal onayı şart
- **R3:** para harcayan aksiyon (reklam aktivasyonu, bütçe artışı) — R2 + bütçe limiti kontrolü; limit aşımında otomatik red

Ek guardrail'ler: aktivasyon aracı günlük bütçe parametresini zorunlu kılar ve platform tarafında da kampanya bütçe limiti set eder (çifte emniyet); `compensation` olarak `ads_campaign_pause` tanımlanır (CompensationExecutor deseni); anomali (ROAS çöküşü, harcama sıçraması) tespitinde `sosyal-analist` schedule'ı kampanyayı duraklat önerisiyle approval queue'ya kayıt açar.

## 8. Zamanlama (persona_schedules)

| Ad | Playbook | Cron | Risk |
|---|---|---|---|
| Sabah inbox triyajı | `sosyal-etkilesim-yanit` | `0 8 * * *` | R1 |
| Öğlen inbox triyajı | `sosyal-etkilesim-yanit` | `0 13 * * *` | R1 |
| İçerik takvimi | `sosyal-icerik-takvimi` | `0 9 * * 1` (Pzt) | R1 |
| Haftalık rapor | `sosyal-haftalik-rapor` | `0 9 * * 5` (Cum) | R1 |
| Kampanya metrik kontrolü | `sosyal-haftalik-rapor` (günlük mod) | `0 10 * * *` | R0 |

Timezone: `Europe/Istanbul` (tablo default'u). `anomaly_threshold: 3` korunur.

## 9. Etkileşim İlkeleri (Kritik)

Yapılır: yorum/DM'lere onaylı, bağlama uygun yanıt; SSS otomasyonu; mention takibi; UGC teşvik içerikleri.

Yapılmaz: otomatik toplu beğeni/takip/takipten çıkma, engagement pod, yapay yorum üretimi, bot etkileşimi. Bunlar tüm platformların kullanım koşullarına aykırıdır ve hesap askıya alınmasıyla sonuçlanır. Etkileşim büyümesi içerik kalitesi + hızlı yanıt süresi + reklam ile sağlanır, sahte sinyalle değil.

## 10. Uygulama Sırası (PR planı)

1. **PR-S1:** Migration — `sosyal-medya` pack + 5 persona + 6 playbook seed'i (tedarik seed deseni). Yayın/harcama araçları henüz yokken playbook'lar taslak modda çalışır (çıktı: md dosyaları).
2. **PR-S2:** Meta MCP sunucusu kaydı + mcp-sync + `sosyal-post-uret` uçtan uca (tek platform, onay gate'li).
3. **PR-S3:** `sosyal-etkilesim-yanit` + inbox araçları + bilgi tabanı (`knowledge/sosyal-medya/faq.jsonl`).
4. **PR-S4:** Reklam katmanı — `ads_campaign_*` araçları, `ad_spend_ledger`, R3 gate, compensation (pause).
5. **PR-S5:** Diğer platformlar + `sosyal-haftalik-rapor` + schedule seed'leri.
6. **PR-S6:** Portal — sosyal onay kuyruğu görünümü (post önizleme + kampanya bütçe kartı).

Alternatif hızlandırıcı: PR-S1 yerine Sector Factory'ye (`kind: sector_factory`, sektör: "sosyal medya yönetimi") taslak ürettirip elle rötuşlamak.

## 11. Önkoşullar / Dış Bağımlılıklar

- Meta Business hesabı + App Review (pages_manage_posts, instagram_content_publish, ads_management izinleri — onay süreci haftalar alabilir, erken başvurun)
- X API ücretli katman (yazma erişimi Basic+ gerektirir)
- LinkedIn Marketing Developer Platform başvurusu
- Google Ads developer token (test → basic erişim süreci)
- Reklam hesaplarında ödeme yöntemi ve hesap-düzeyi harcama limitleri (platform tarafında da set edin)

## 12. KPI

Organik: etkileşim oranı, yanıt süresi (medyan), takipçi büyümesi, onay-red oranı (ajan kalitesi göstergesi). Ücretli: CPC/CPM, ROAS, bütçe sapması. Operasyonel: run başarı oranı, onay bekleme süresi, blocked_by_verifier oranı.
