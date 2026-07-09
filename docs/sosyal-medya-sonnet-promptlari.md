# Sosyal Medya Serisi — Sonnet Prompt Paketi (PR-S1 … PR-S6)

Bağlam dokümanı: `docs/sosyal-medya-domain-pack-plani.md`. Format ve taktikler: `docs/otomasyon-plani-ve-sonnet-promptlari.md` §6 (oturum başına tek PR, önce plan, bitti kriteri prompt'ta, şema doğrulama refleksi).

Sıra bağımlılığı: S1 → S2 → S3 → S4 → S5 → S6. S3 ve S4 yer değiştirebilir.

---

## PR-S1 — Tamamlandı (2026-07-07)

Teslim: `20260707100000_sosyal_medya_pack.sql` (pack + 5 persona + 3 playbook), `knowledge/sosyal-medya/README.md`, CLI düzeltmesi (`list --domainPack` DB'den okuyor). Doğrulama: migration 2x idempotent, build + 55/55 test, `list --domainPack sosyal-medya` = 3 playbook, `sosyal-post-uret.required_tools` boş.

### PR-S1 prompt'u — sosyal-medya pack + persona + taslak playbook seed'leri

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§3, §4, §5),
supabase/migrations/0019_domain_packs.sql (tablo şemaları),
supabase/migrations/20260611160000_operations_context.sql (seed deseni — birebir örnek al).

KURAL: Kolon adlarını ve CHECK kısıtlarını önce gerçek migration dosyalarından doğrula
(personas.risk_ceiling/cost_class CHECK'leri, playbooks UNIQUE(slug,pack_id,tenant_id),
domain_packs kolonu verifier_rubric_md — rubric değil). Yeni desen icat etme.

Görev: tek migration (tarih damgalı, örn. 20260707100000_sosyal_medya_pack.sql):

1. domain_packs insert: id='sosyal-medya', tenant_id=NULL, status='active',
   allowed_domains: plan §3'teki domainler, verifier_rubric_md ve regulatory_notes_md
   plan §3 içeriğinden yazılsın. Idempotent (WHERE NOT EXISTS).
2. personas insert (5 adet, plan §4 tablosu): icerik-stratejisti, copywriter,
   community-manager, ads-manager, sosyal-analist. pack_id='sosyal-medya', tenant_id=NULL.
   system_prompt her persona için 5-8 cümle, Türkçe, rol + sınırlar
   ("asla otomatik beğeni/takip önerme", "reklam bütçesi kararı insana ait" gibi).
   risk_ceiling ve cost_class plan tablosundan.
3. playbooks insert (3 adet — yalnız araç bağımlılığı mevcut olanlar):
   - sosyal-icerik-takvimi (R1, required_tools: {web_scrape}) — plan §5.1 adımları
   - sosyal-post-uret (R1 TASLAK modu — yayın adımı YOK, çıktı post-taslagi.md;
     yayın adımı PR-S2'de eklenecek) — plan §5.2'nin 1-2. adımları,
     Verifier adımına blockOnVerifierFail:true
   - reklam-kampanya-brief (R1, harcama yok) — plan §5.4 adımları
   Steps formatı: {"id","agent","goal","output"} — agent değerleri çekirdek ajanlar
   (Operator/Analyst/Writer/Verifier), tedarik-* seed'lerindeki gibi. Persona koşum
   düzeyinde bağlanır, steps içinde persona slug'ı KULLANMA.
4. knowledge/sosyal-medya/README.md — pack bilgi tabanı iskeleti
   (marka sesi, SSS, yasaklı konular başlıkları; knowledge/market-intel örnek).

Önce plan, sonra kod. Bitti kriteri: migration lokal Supabase'e temiz uygulanıyor
(iki kez üst üste — idempotency kanıtı); dotnet build yeşil;
CLI list --domainPack sosyal-medya 3 playbook'u gösteriyor (DB'den).
```

---

## PR-S2 — Tamamlandı (2026-07-07)

Teslim: `20260707120000_meta_social_publish.sql` (mcp_servers meta-social + tools meta-social__post_publish write/R2/reversible, compensation PR-S7'de post_delete + sosyal-post-uret s3/R2), `scripts/mock-meta-mcp.ts`, `SocialPublishFlowTests.cs` (onaylı→invoke, red→invocation yok, Faz A regresyon). Bonus backlog: market-intel README güncellendi, `20260707121000_sector_factory_scaffold_step.sql` (scaffold step_id düzeltmesi). Doğrulama: 58/58 test, mock MCP post_id döndü. Önemli düzeltme: CLI yolunda onay `RiskGate.GateForToolAsync` iledir — `gate_run_for_approval` RPC worker yoluna özgü.

### PR-S2 prompt'u — Meta MCP kaydı + onay gate'li yayın akışı

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§5.2, §6, §7), PR-S1 çıktısı,
supabase/migrations/20260614110000_mcp_servers.sql (mcp_servers şeması + tools genişlemesi),
src/AgentArmy.Cli/Tools/McpProxyTool.cs, 0015_approval_enforcement.sql (gate akışı).

KURAL: tools.category CHECK listesini 0017_tool_registry.sql'den doğrula
('mcp'/'external' YOK — 'communication' kullan). MCP araç slug formatı:
{server_slug}__{tool_name}. Şemayı migration'dan doğrulamadan kolon adı yazma.

Görev:

1. Migration: mcp_servers'a platform kaydı — slug='meta-social', transport='http',
   endpoint env-bazlı placeholder, auth_env='META_ACCESS_TOKEN'. Idempotent.
2. tools tablosuna meta-social__post_publish kaydı (mcp_server_id bağlı,
   category='communication', risk R2 — risk kolonunun gerçek adını 0017'den doğrula).
   Gerçek Meta çağrısı için MCP sunucusu dışarıda çalışacak; bu PR'da endpoint yoksa
   demo yanıt dönen bir fallback DAVRANIŞI McpProxyTool'a EKLEME — bunun yerine
   küçük bir yerel mock MCP http sunucusu ekle (scripts/ altında, tek dosya) ve
   testte onu kullan.
3. sosyal-post-uret playbook'una yayın adımı ekle (migration ile steps güncelle):
   {"id":"s3","agent":"Operator","goal":"meta-social__post_publish ile onaylı taslağı
   yayınla","output":"Yayın kaydı: post_id, url","blockOnVerifierFail":true},
   primaryTool: meta-social__post_publish. default_risk R2'ye çıkar.
4. R2 adımın gate_run_for_approval ile approval_queue'ya düştüğünü uçtan uca doğrula:
   run başlat → waiting_approval → portal RPC approve → yayın adımı koşuyor (mock MCP).

Önce plan, sonra kod. Bitti kriteri: dotnet build + dotnet test yeşil; mock MCP ile
tam akış: taslak → verifier PASS → waiting_approval → onay → post_id çıktısı;
onay reddedilirse yayın adımı hiç çalışmıyor (kanıt: invocation kaydı yok).
```

---

## PR-S3 — Tamamlandı (2026-07-07)

Teslim: `SocialInboxFetchTool` (read/R0, deterministik 5 öğe) + `SocialReplySendTool` (write/R2) + `ToolExecutor.CreateDefault` kaydı; `20260707130000_sosyal_etkilesim.sql` (2 tool seed, sosyal-etkilesim-yanit 4 adımlı playbook, 10 SSS `facts` seed'i sosyal-medya-faq-01…10, community-manager FactsIndex talimatı); README faq.jsonl temizliği; `SocialInboxFlowTests.cs` (4 test). Doğrulama: 62/62 test, migration 2x idempotent, `list` = 4 playbook. Not: `reversible=true` Faz A uyumu için (prompt'taki `reversible=false` hataydı — Faz A bloklardı); "yanıt geri alınamaz" iş kuralı goal'da, gerçek `reply_delete` PR-S7 backlog'unda.

### PR-S3 prompt'u — Etkileşim: inbox araçları + yanıt playbook'u

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§5.3, §9), PR-S1/S2 çıktıları,
src/AgentArmy.Cli/Tools/StockCheckTool.cs ve CargoTrackTool.cs (demo durum makinesi deseni),
src/AgentArmy.Cli/Tools/ToolContracts.cs, ToolExecutor.cs.

Görev:

1. İki yerli ITool (demo-first, CargoTrackTool'un demo deseni gibi; gerçek API sonraki PR):
   - social_inbox_fetch (read/R0): platform+tarih filtresiyle yorum/DM/mention listesi.
     Demo modda deterministik örnek veri üretsin (sabit seed — test edilebilir).
   - social_reply_send (write/R2, reversible=false): item_id + yanıt metni.
2. Migration: iki aracın tools kaydı (kolonları ve CHECK'leri 0017 +
   20260609130000_tedarik_tools_seed.sql'den doğrula) + sosyal-etkilesim-yanit
   playbook seed'i (plan §5.3): triyaj adımı {yanıtla|yoksay|eskale} etiketleri,
   eskale etiketlilere ASLA yanıt üretme kuralı goal metnine gömülü,
   gönderim adımı R2 + blockOnVerifierFail.
3. SSS bilgi tabanı — DOSYA DEĞİL, DB: kök knowledge/ klasörü legacy'dir, hiçbir kod
   okumaz (FactsStore/FactsIndex yorumu: "Tek hakikat kaynağı DB"). 10 örnek SSS'i
   migration ile facts tablosuna seed et: domain_pack='sosyal-medya', topic=soru,
   claim=cevap, confidence=1.0 (kolonları FactEntry.cs + facts migration'ından doğrula).
   community-manager system_prompt'una "yanıtları önce bilgi tabanından (facts) ara"
   talimatı (persona UPDATE migration'ı). FactsIndex bunları otomatik bulur —
   yeni okuma mekanizması yazma.
4. Uçtan uca: inbox fetch → triyaj → taslaklar → R2 gate → onay → reply_send (demo).

Önce plan, sonra kod. Bitti kriteri: build + test yeşil; demo akışta eskale etiketli
item'a yanıt üretilmediğinin testi var; R2 gate kanıtı (waiting_approval kaydı).
```

---

## PR-S4 — Tamamlandı (2026-07-08)

Teslim (2 commit): a0964ef CI fix — `help` komutu (exit 0) + ci.yml smoke `-- help` (bare `list` exit 1 beklenen davranış); 9c633aa PR-S4 — `IToolPreGate` (ITool.cs, ToolExecutor gate-öncesi doğrulama), `AdsCampaignCreateTool` (R1, her zaman paused) / `AdsCampaignActivateTool` (R3, ICompensable, compensation=ads_campaign_pause) / `AdsCampaignPauseTool` (R1) / `AdsBudgetGuard` / `AdsLedgerHelper`, `20260707140000_sosyal_ads.sql` (ad_spend_ledger owner NOT NULL=RUN_OWNER_USER_ID fail-closed, 3 tool seed, ads.max_daily_budget=5000 / ads.max_total_budget=50000, reklam-kampanya-yayinla playbook R3). Doğrulama: 68/68 test; cap aşımı gate çağrılmadan araç hatası (`gate.WasCalled==false`); compensation ledger'ı paused'a çekiyor; bütçe ledger'dan okunuyor; `list` = 5 playbook. Öğrenilen: cap kontrolü executor sırası gereği `IToolPreGate` kancasıyla gate öncesine alındı.

### PR-S4 prompt'u — Reklam katmanı: kampanya araçları + ad_spend_ledger + R3

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§5.5, §7), PR-S1..S3,
src/AgentArmy.Cli/Tools/PurchaseOrderTool.cs (R3 onay deseni — birebir örnek),
src/AgentArmy.Cli/Tools/CompensationExecutor.cs, 0012_runs_cost_ledger.sql
(DİKKAT: cost ledger ayrı tablo DEĞİL, runs kolonları — reklam harcaması için
YENİ tablo gerekiyor).

Görev:

1. Migration: ad_spend_ledger tablosu — campaign_id, platform, owner_user_id,
   daily_budget, total_budget_cap, spent (demo), currency, status
   CHECK ('paused','active','stopped'), created/updated. RLS: owner select,
   service_role all (0015 deseni).
2. Üç yerli ITool (demo-first):
   - ads_campaign_create (write/R1): kampanyayı HER ZAMAN paused oluşturur,
     ledger'a kayıt açar. daily_budget ve total_budget_cap parametreleri ZORUNLU.
   - ads_campaign_activate (write/R3, reversible=true): ledger'da cap kontrolü —
     cap policy_settings'teki limitten büyükse aracın kendisi hata döndürür
     (LLM'e güvenme, araç içinde kontrol). R3 → onay kuyruğu.
   - ads_campaign_pause (write/R1): compensation aracı. ads_campaign_activate'in
     compensation'ı olarak kaydet (CompensationExecutor deseni).
   Üç araçta da reversible=true (Faz A kuralı: write + reversible=false araçlar
   AvailableFor'da hiç sunulmaz — PR-S2/S3'te doğrulandı). activate zaten gerçekten
   geri alınabilir: tools.compensation='ads_campaign_pause'.
3. policy_settings'e ads.max_daily_budget ve ads.max_total_budget seed
   (20260611170000 deseni; gerçek kolonları doğrula).
4. reklam-kampanya-yayinla playbook seed'i (plan §5.5): create (paused) →
   activate (R3 gate) adımları, blockOnVerifierFail.
5. Testler: cap aşımında activate'in R3 gate'e DÜŞMEDEN araç hatası döndürdüğü;
   activate sonrası run fail olursa compensation'ın pause çağırdığı.

Önce plan, sonra kod. Bitti kriteri: build + test yeşil; demo akışta kampanya
paused doğuyor, aktivasyon yalnız insan onayıyla; cap aşımı testi ve
compensation testi geçiyor; ad_spend_ledger kayıtları doğru.
```

---

## PR-S5 — Tamamlandı (2026-07-08)

Teslim: `StableHash.cs` (FNV-1a — string.GetHashCode() proses başına rastgele olduğundan), `SocialMetricsFetchTool` + `AdsMetricsFetchTool` (read/R0, ledger yalnız SELECT, spent DB'ye yazılmıyor) + `AdsMetricsDemo` (deterministik harcama + anomaly_spike kuralı); `20260707150000_sosyal_metrics.sql` (2 tool seed, sosyal-haftalik-rapor playbook, 5 persona_schedules şablonu **enabled=false** + placeholder owner); README schedule kurulum notları. Doğrulama: 73/73 test, migration 2x idempotent, `list` = 6 playbook, ledger'a PATCH/POST yapılmadığı test kanıtlı. Not: anomali test id'si `camp_spike_3` (plandaki id formülle spike üretmiyordu). Öğrenilenler: deterministik demo araçlarda kararlı hash şart; şablon schedule'lar pasif seed'lenmeli (aktif olsaydı schedulerTick sahte owner'a run üretirdi).

### PR-S5 prompt'u — Metrik araçları + haftalık rapor + schedule seed'leri

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§5.6, §8), PR-S1..S4,
supabase/migrations/0023_persona_schedules.sql (şema — kolonları doğrula),
portal/api/lib/schedulerTick.ts (veya scheduler worker'ın gerçek dosyası — önce bul).

Görev:

1. İki read/R0 yerli ITool (demo-first, deterministik örnek veri):
   - social_metrics_fetch: platform+tarih aralığı → erişim, etkileşim, takipçi delta.
   - ads_metrics_fetch: campaign_id → harcama, gösterim, tıklama, CPC/CPM/ROAS.
     DİKKAT: read/R0 araç DB'ye YAZMAZ — ledger.spent'i güncelleme. Demo harcamayı
     deterministik hesapla (örn. kampanya yaşı × daily_budget'ın sabit oranı,
     campaign_id hash'iyle) ve yalnız çıktıda döndür. spent kolonunun gerçek
     güncellemesi PR-S7'de gerçek API senkronuyla gelir.
2. Migration: araç kayıtları + sosyal-haftalik-rapor playbook seed'i (plan §5.6,
   çıktı haftalik-rapor.md) + persona_schedules seed'leri plan §8 tablosundan
   (5 kayıt; owner_user_id seed'de nasıl çözülüyor — mevcut schedule seed'i varsa
   deseni al, yoksa README'ye kurulum notu yaz ve seed'i şablon olarak bırak).
3. Anomali köprüsü: ads_metrics_fetch çıktısında harcama sıçraması varsa
   (spent > daily_budget * 1.2) rapor playbook'unun analist adımı bunu
   "kampanyayı duraklat önerisi" olarak işaretlesin — goal metnine gömülü kural,
   yeni mekanizma icat etme.

Önce plan, sonra kod. Bitti kriteri: build + test yeşil; rapor playbook'u demo
metriklerle md rapor üretiyor; schedule kayıtları scheduler tick'te next_fire_at
hesaplatıyor (test veya manuel kanıt); anomali senaryosu raporda görünüyor.
```

---

## PR-S6 — Tamamlandı (2026-07-08)

Teslim (portal-only, backend dokunuşsuz): `approvalCards.ts` (parseToolApproval + resolveCardKind, `tool:` prefix), `components/approval/` — PostPreviewCard / CampaignBudgetCard (ad_spend_ledger RLS SELECT + "Bu onay para harcar" bandı) / GenericKeyValueCard / ApprovalDetailCard; ApprovalQueuePage entegrasyonu (decide_approval akışı aynen); OperationsPage Sosyal Medya şablonu (domain_pack sabit, playbook dropdown zorunlu, context_json.first_playbook). Doğrulama: portal 14/14 test (+4), tsc + build yeşil, dotnet 73/73 regresyonsuz. Gerçek format notu: action_summary=`tool:{slug}`, action_detail=`{tool,args}` (RiskGate.cs:36–38).

---

## Seri durumu (2026-07-08): PR-S1–S6 TAMAMLANDI

`sosyal-medya` domain pack uçtan uca çalışır durumda (demo-first): 5 persona, 6 playbook, 7 yerli araç + 1 MCP aracı, ad_spend_ledger + cap guardrail (IToolPreGate), R2/R3 onay gate'leri, 5 pasif schedule şablonu, portal onay kartları + operasyon şablonu. Toplam test: 73 (.NET) + 14 (portal). Kalan tek iş: **PR-S7** (gerçek API + OAuth/credential katmanı — backlog bölümü yukarıda; önkoşul App Review başvuruları, plan §11).

### PR-S6 prompt'u — Portal: sosyal onay kuyruğu görünümü

```
Repo: ai_agent. Bağlam: docs/sosyal-medya-domain-pack-plani.md (§7, §10 PR-S6),
portal/ approval queue mevcut sayfası (önce bul ve oku), 0015_approval_enforcement.sql
(action_detail JSONB — yapıyı worker ne yazıyorsa onu kullan, uydurma).

Görev:

1. Kart tipi TÜRETİLİR, backend'e dokunulmaz. Doğrulanmış durum (ToolExecutor:357 +
   RiskGate.GateForToolAsync): CLI yolunda action_summary = araç slug'ı,
   action_detail = araç argümanları JSON'u. Kart seçimi action_summary'den:
   - meta-social__post_publish, social_reply_send → Post önizleme kartı:
     platform, metin (action_detail'den), karakter sayısı, görsel (varsa).
     Onay/red mevcut RPC'lerle — yeni RPC yazma.
   - ads_campaign_activate → Kampanya bütçe kartı: action_detail'de YALNIZ
     campaign_id var; daily_budget/total_budget_cap/currency/platform'u
     ad_spend_ledger'dan SELECT et (RLS owner policy'si yeter — onay sahibi =
     ledger sahibi). "Bu onay para harcar" uyarı bandı.
   - Diğer slug'lar → mevcut genel kart (regresyon yok).
3. OperationsPage şablon seçicisine (Sektör Fabrikası deseni) "Sosyal Medya"
   şablonu: domain_pack='sosyal-medya' + playbook seçimi.

Önce plan, sonra kod. Bitti kriteri: npm run build --prefix portal + tsc --noEmit
yeşil; iki kart demo verisiyle görünüyor; onay/red akışı mevcut RPC'lerle çalışıyor;
ekran görüntüsü veya kısa kayıt PR açıklamasına.
```

---

## PR-S7 — Tamamlandı (2026-07-08, S7a + S7b iki oturum)

**S7a (credential çekirdeği):** `20260708100000_user_social_accounts.sql` (platform-agnostik, RLS, ciphertext); AES-256-GCM app-level şifreleme (`SOCIAL_TOKEN_ENC_KEY`, C#/TS uyumlu wire format — Vault/pgsodium kurulu olmadığından bilinçli tercih); `CredentialResolver` + env fallback; McpClient per-request bearer; portal `/api/social/*` agnostik OAuth router + `MetaOAuthProvider` + SocialAccountsPage + `credentialRefreshTick`.
**S7b (canlı Meta):** `scripts/meta-social-mcp.ts` (Graph + `SOCIAL_API_MODE=demo` fallback; post_publish/post_delete/reply_delete); `20260708110000_sosyal_live_meta.sql` (post_delete + reply_delete compensation'ları); McpProxyTool compensationToken çıkarımı; `ads_metrics_fetch` live modda `ledger.spent` PATCH.
Doğrulama: dotnet 76/76 + portal 16/16 + build yeşil + `check-token-leakage.sh` OK. Kalan dış bağımlılık: Meta App Review + `META_PAGE_ID` (prod yayın için). Aşağıdaki backlog maddelerinin tamamı karşılandı; PR-S8 (X/LinkedIn/TikTok/Google Ads) yalnız provider ekleyerek gelir.

### PR-S7 backlog — gerçek API bağlama (arşiv; S7'de karşılandı)

Seri boyunca biriken maddeler; PR-S7 prompt'u yazılırken hepsi kapsanmalı:

1. Gerçek Meta/X/LinkedIn/TikTok/Google Ads API bağlantısı (App Review onayları önkoşul — plan §11).
2. Çok-kullanıcılı credential yönetimi: portal OAuth akışı ("hesabını bağla"), `user_social_accounts` tablosu (owner_user_id, platform, şifreli access/refresh token, expires_at; RLS owner-only; pgsodium/Vault), araç katmanında token'ın global env yerine koşum sahibine göre çözümlenmesi, token refresh schedule'ı. Mevcut `auth_env` yaklaşımı tek-hesap/tek-dağıtım içindir.
3. Compensation'lar: `post_delete` (meta-social__post_publish için) ve `reply_delete` (social_reply_send için) + tools.compensation kolonlarının doldurulması.
4. mcp_servers.endpoint güncellemesi: mock (127.0.0.1:3847) → gerçek endpoint, UPDATE migration ile.
5. reversible/`iş kuralı` ayrımının gözden geçirilmesi: demo'da reversible=true idi; gerçek API'de compensation'larla birlikte doğrulanmalı.

## PR-S7c — Tamamlandı (2026-07-08, Claude tarafından uygulandı)

Teslim: `20260708120000_social_oauth_apps.sql` (tablo; authenticated'a policy/grant bilinçli YOK — secret PostgREST'ten okunamaz, tüm erişim portal API/service_role); `portal/api/lib/social/oauthApps.ts` (çözümleme: owner > platform geneli > env fallback, ENV_MAP 5 platform, audit_log kaydı); `ISocialOAuthProvider` imzaları `OAuthAppCredentials` enjeksiyonlu; MetaOAuthProvider'dan requireEnv kaldırıldı; routes: GET /api/social/apps (secret_set boolean, secret asla dönmez) + PUT/DELETE /:provider/app; credentialRefreshTick owner-bazlı config; SocialAccountsPage "Uygulama ayarları" bölümü (App ID, write-only secret, redirect kopyalama, kaynak rozeti, "Yapılandırma gerekli" durumu); `oauthApps.test.ts` (öncelik sırası + secret sızmama); check-token-leakage.sh app_secret deseni. Doğrulama: tsc --noEmit + token-leakage OK (sandbox'ta); vitest kullanıcı makinesinde koşulacak (esbuild platform binary'si).

### PR-S7c prompt'u — OAuth app kimlik bilgilerinin panelden yönetimi (arşiv)

```
Repo: ai_agent. Bağlam: PR-S7a/S7b çıktıları — portal/api/lib/tokenEncryptor.ts,
portal/api/lib/social/providers/, portal/src/pages/SocialAccountsPage.tsx,
supabase/migrations/20260708100000_user_social_accounts.sql (RLS + şifreleme deseni),
0014_audit_log.sql (audit deseni).

KURAL: Kolon adlarını ve CHECK kısıtlarını önce gerçek migration dosyalarından doğrula.
SOCIAL_TOKEN_ENC_KEY env'de KALIR (kök anahtar) — bu PR onu DB'ye taşımaz.

Görev: META_APP_ID / META_APP_SECRET / redirect URI artık env değil, panelden yönetilsin.

1. Migration: social_oauth_apps tablosu — platform TEXT NOT NULL, owner_user_id UUID
   NULL (NULL = platform geneli varsayılan; dolu = tenant'a özel), app_id TEXT NOT NULL,
   app_secret_ciphertext TEXT NOT NULL (tokenEncryptor AES-GCM), redirect_uri TEXT,
   enabled BOOLEAN default true, created_at/updated_at + trigger.
   UNIQUE partial index'ler mcp_servers deseninde (platform satırı / owner satırı).
   RLS: owner kendi satırını SELECT/INSERT/UPDATE/DELETE (app_secret_ciphertext'i
   SELECT'ten gizlemek için portal API'si üzerinden erişim — aşağıda), service_role ALL.
   Sonuna NOTIFY pgrst, 'reload schema' ekle.
2. Provider config çözümleme sırası (MetaOAuthProvider + gelecekteki tüm provider'lar
   için ortak helper): (a) social_oauth_apps owner satırı → (b) platform geneli satır
   → (c) env fallback (META_APP_ID vb. — geriye uyum, kaldırma).
   app_secret yalnız server-side decrypt edilir.
3. Portal API: GET /api/social/apps (app_secret ASLA dönmez — yalnız app_id,
   redirect_uri, updated_at, secret_set:boolean), PUT /api/social/:platform/app
   (app_id + app_secret + redirect_uri; secret boşsa mevcut korunur), DELETE.
   Her değişiklik audit_log'a yazılır (0014 deseni).
4. UI: SocialAccountsPage'e platform kartı başına "Uygulama ayarları" bölümü
   (veya ayrı sekme): app_id alanı, app_secret write-only parola alanı
   (kayıtlıysa "••••" + secret_set rozeti), redirect_uri önerisi otomatik
   (PORTAL_PUBLIC_URL + /api/social/{platform}/oauth/callback, kopyala butonu).
   Kaydet sonrası "META_APP_ID eksik" banner'ı kalkar (banner artık DB+env
   birleşik çözümlemeye bakar).
5. Testler: çözümleme sırası (owner > platform > env) unit; secret'ın hiçbir GET
   yanıtında ve logda görünmediği; şifreli round-trip (encrypt→decrypt).
   scripts/check-token-leakage.sh kapsamına app_secret pattern'i ekle.

Önce plan, sonra kod. Bitti kriteri: migration 2x idempotent; portal build + testler
yeşil; panelden girilen App ID/Secret ile OAuth akışı env'siz uçtan uca çalışıyor
(dev mode); GET yanıtlarında secret yok; audit_log kaydı düşüyor.
```

---

## D0 Güvenlik Dalgası + PR-S8-X — Tamamlandı (2026-07-09)

D0a: `20260709120000_d0_untrusted_source.sql` + `ToolDescriptor.UntrustedSource` + `WrapUntrusted` (`<untrusted_data source="tool:slug">`) + LLM istemcilerinde koşullu sarma + PromptBuilder talimat hiyerarşisi. D0b: RunContext taint (adım başında temizlenir) + privilege gate (untrusted read sonrası aynı adımda R2+ yan etkili araç → Blocked + `tool.privilege_denied` audit) + URL→R3 yükseltme; mention yükseltmesi `security.mention_escalation` policy (default off). D0c: AdversarialTests senaryo 10–12, `ToolArgumentValidator` (minimal JSON Schema, gate öncesi red), `20260709130000_d0_sosyal_verifier_rubric.sql`, guvenlik-eval-raporu güncellendi. PR-S8-X: `providers/x.ts` (OAuth2 PKCE + refresh; interface `createOAuthExtras`/`oauthState` ile genişletildi), env fallback `X_*`. Doğrulama: 85 .NET + 23 portal testi. KURAL: canlı inbox (`SOCIAL_API_MODE=live`) yalnız D0 migration'ları push edildikten sonra açılır; adımlar-arası injection savunması Verifier rubriği + insan onayına dayanır (taint adım-içi).

## D1 Öğrenme Çekirdeği — Tamamlandı (2026-07-09)

4 migration (20260709140000–170000): model router seed + eval meta + pgvector facts + approval feedback. Kod: `StepLlmResolver` (adım-bazlı tier routing), Orchestrator Verifier-FAIL frontier retry (yan etki korumalı — başarılı write/external varsa `model.upgrade_skipped`), `EmbeddingService` + FactsIndex hibrit arama (vector→trgm fallback) + FactsStore supersede, `evals/` + `run-evals.ts` (CI fake, nightly live, `meta.eval=true` KPI dışlama), selfReflectionTick approval_feedback sinyali. 98+25 test. Kullanıcı tarafı: `supabase db push` (4 migration; pgvector extension migration içinde), worker/CI'da `OPENAI_API_KEY`, CI secret'ları (nightly eval için).

Sıradaki: **D2 — Ajan Fabrikası** (diyaloglu fabrika + otomatik eval üretimi + canary yayın + pack manifest). D1b eval kapısı hazır.

## D2 Ajan Fabrikası — Tamamlandı (2026-07-09)

Diyaloglu sektör fabrikası: SectorBuilderPage senkron soru-cevap (kalıcı answers_json) → mevcut sector_factory operasyonu (yeni yürütme yolu yok); izole EvalGenerator (rubric + D0 güvenlik case karışımı, `eval_generator_run_id` ile taslak-üreten ajandan ayrı) → merge eval kapısı (pass³ eşiği); canary yayın (yeni pack ilk N koşum R2 tabanı + D0 smoke doğrulaması); pack-manifest-v1 export/import. Migration `20260709180000_d2_eval_canary.sql`. 103 .NET + 28 portal testi. Kullanıcı tarafı: `supabase db push`, worker/CI `OPENAI_API_KEY` (eval üretimi).

Sıradaki: **D3 — Genel Planlayıcı** (playbook yoksa hedeften plan-and-execute; gate'ler + D0 güvenlik + eval korunur). Bu, "yürütme dinamikliği"nin — tam dinamik hedefinin son büyük parçası.

## Çalışma notları

- Oturum başına tek PR; her prompt'un başındaki bağlam dosyalarını Sonnet'e okutmadan koda başlatma.
- Her PR sonrası: `dotnet build` + `dotnet test` + `npm run build --prefix portal` + migration'ı iki kez uygulama (idempotency).
- Gerçek platform API'leri (Meta App Review, X ücretli katman, Google Ads token) bu seriden bağımsız yürür — plan §11. Demo-first araçlar sayesinde seri, API onayları beklenmeden uçtan uca test edilebilir; gerçek API bağlama ayrı bir PR-S7 olarak App Review sonrasına.
