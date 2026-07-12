# AgentArmy → Tam Dinamik Ajan Platformu: Araştırma ve Yol Haritası

Tarih: 2026-07-08 · Dayanak: tüm repo incelemesi + güncel sektör araştırması (kaynaklar sonda)

## 0. Yönetici özeti

Talep: "Genel zeka noktasında ciddi seviye + sektörel dinamikleşme + full dinamik yapı."

Tez: "Full dinamik" tek bir özellik değil, **dört ayrı dinamiklik ekseni**dir ve AgentArmy'nin mevcut mimarisi dördüne de şaşırtıcı ölçüde hazır — eksik olan parçaların çoğu yeni icat değil, var olan altyapının (Sector Factory, operations loop, facts, llm_providers, mcp_servers) bir üst kademeye taşınmasıdır:

1. **Üretim dinamikliği** — yeni sektör = kod değil, konuşma. (Sector Factory → Ajan Fabrikası)
2. **Çalışma-zamanı dinamikliği** — sabit adım listesi değil, hedefe göre planlayan koşum. (operations DECIDE → genel planlayıcı)
3. **Öğrenme dinamikliği** — her koşum sistemi kalıcı olarak akıllandırır. (facts/memory → yaşayan bellek + skill kütüphanesi)
4. **Ekosistem dinamikliği** — araçlar ve ajanlar elle değil, keşifle bağlanır. (MCP registry + A2A)

Önemli hizalama: `operasyonel-ozerklik-yol-haritasi.md` Bölüm 2'nin tespiti geçerliliğini koruyor — **genellik temel modelden gelir, bu repo soketi inşa eder.** Aşağıdaki her şey "soketi dünya standardına çıkarma" işidir; sektör araştırması bu tezi doğruluyor (bkz. §1).

---

## 1. Dünya durumu (2026 ortası) — araştırma bulguları

### 1.1 Protokoller: MCP kazandı, A2A kurumsallaştı
MCP, araç bağlama katmanında fiili standart (97M+ indirme; Anthropic/OpenAI/Google/Microsoft). Google'ın A2A'sı (ajan↔ajan) Linux Foundation'a devredildi; Aralık 2025'te OpenAI/Anthropic/Google/Microsoft/AWS ortaklığında **Agentic AI Foundation** kuruldu — MCP ve A2A'nın kalıcı evi. A2A'nın merkezi kavramı **Agent Card**: ajanın yeteneklerini ilan eden JSON — dinamik keşfin temeli. Pratik tavsiye (sektör genelinde): bugün statik konfigürasyonla tasarla, Agent Card uçlarını şimdiden yayınla.

**AgentArmy için anlamı:** `mcp_servers` + `McpProxyTool` yatırımınız doğru ata oynamış. Eksik: MCP registry'den *keşif* (bugün elle kayıt) ve ajanlarınızın A2A Agent Card olarak dışa ilanı.

### 1.2 Kurumsal platformlar: "ajan kuran ajan" kategorisi doğdu
Sierra $15.8B değerlemeye ulaştı (Fortune 50'nin %40'ı müşteri); Mart 2026 ürünü **Ghostwriter: konuşma yoluyla ajan inşa eden AI**. Salesforce tüm ürün hattını Agentforce'a çevirdi; no-code ajan kurucular (MindStudio Architect, Airtable Omni) "tarif et → ajan+iş akışı üretilsin" moduna geçti. Dikey (sektörel) hazır ajan paketleri 2026'nın ana rekabet alanı.

**AgentArmy için anlamı:** Sector Factory'niz (araştır → taslak → test → onay kapalı döngüsü) tam olarak bu kategori — Ghostwriter'ın yaptığını siz migration'la yapıyorsunuz. Fark: sizinki CLI/portal arası bölünmüş ve tek atımlık; onlarınki diyalog tabanlı ve iteratif. Kapatılabilir bir fark (bkz. Eksen 1).

### 1.3 Bellek: vektör araması yetmiyor, zamansal bilgi grafı yükseliyor
Pazar dört üründe toplandı: Letta (MemGPT devamı — RAM/disk benzeri katmanlı bellek), Zep (Graphiti — **zamansal bilgi grafı**: fact'in ne zaman doğru olduğunu izler), Mem0 (LLM'li çelişki çözümü — yeni claim eskisini geçersiz kılar), LangMem. Ortak yön: ham vektör araması değil; fact çıkarımı + çelişki çözümü + zaman boyutu.

**AgentArmy için anlamı:** `facts` tablonuz + `superseded_by` kolonunuz + memory-promote/drift mekanizmanız bu mimarinin embriyosu — çoğu rakipten önce düşünülmüş. Eksik: anlamsal arama (bugün token-overlap) ve zaman-farkında sorgu ("X geçen ay doğruydu, hâlâ doğru mu?").

### 1.4 Öz-iyileşen ajanlar: skill kütüphanesi çizgisi
2026 araştırma dalgası (SkillOps, EvoSkills, SkillFlow): ajanların başarılı çözümleri **yeniden kullanılabilir skill** olarak biriktirmesi, koşum geri bildirimiyle rafine etmesi, kütüphaneyi kendi kendine bakımlı tutması. Kurumsal karşılığı: hata örüntüsü tespiti → davranış yaması → üretim sinyalinden sürekli iyileşme.

**AgentArmy için anlamı:** Playbook'larınız zaten "skill" — ama bugün yalnız insan (veya Sector Factory) yazıyor. Eksik halka: **başarılı operasyon izlerinden yeni playbook taslağı türetme** ve onay redlerinden persona rafinasyonu.

### 1.5 Değerlendirme: pass^k ve yörünge (trajectory) evalleri standartlaştı
τ-bench çizgisi: ajan yalnız sonuçla değil, **k denemede k başarı** (pass^k — güvenilirlik) ve **yörünge kalitesiyle** (doğru sonuca güvensiz yoldan varma = "corrupt success") ölçülür. Üretim tavsiyesi: her koşum turunu sınıflandır, etiketleri eval setine geri besle. LLM-as-judge yalnız muhakeme gerektiren kriterlerde; kesin kontroller deterministik.

**AgentArmy için anlamı:** 87 kod testiniz var ama sıfır davranış eval'iniz var. Verifier rubrikleriniz LLM-as-judge'ın ta kendisi — eksik olan bunları tekrarlanabilir golden-set koşumlarına ve pass^k metriğine bağlamak.

### 1.6 Güvenlik: injection saldırılarının %55'i artık dolaylı
Prompt injection üçüncü yıldır OWASP LLM Top-10 birincisi; girişimler yıllık %340 arttı ve **%55'i dolaylı** (ajanın okuduğu içerik üzerinden). 2026 üretim düzeni: talimat hiyerarşisi (sistem > kullanıcı > araç çıktısı), untrusted içerik işaretleme (Microsoft Spotlighting), **imtiyaz ayrımı — untrusted içeriği okuyan ajan, tehlikeli aracı tutan ajan olmamalı**, şema doğrulamalı çıktı, anomali tespiti, yüksek riskte insan onayı.

**AgentArmy için anlamı:** İnsan onayı + risk hiyerarşiniz sektör tavsiyesinin önünde. Ama `web_scrape` ve `social_inbox_fetch` çıktıları bugün işaretlenmeden prompt'a giriyor — dolaylı injection'a açıksınız. Çekirdek ajan ayrımınız (Writer taslak yazar, Operator araç kullanır) imtiyaz ayrımına doğal zemin.

### 1.7 Framework'ler: kendi runtime'ınız savunulabilir
LangGraph kurumsal standart, Claude Agent SDK / OpenAI Agents SDK sağlayıcı-yerlisi hatlar. Ancak sektör tavsiyesi mevcut altyapıya yakın kalmak; sizin .NET runtime'ınız risk sözleşmesi, compensation ve DB-first governance ile bu framework'lerin çoğunun *önünde*. Geçiş maliyeti değmez — **uyum katmanı** (MCP tam desteği + A2A kartları + eval standartları) yeterli.

---

## 2. AgentArmy'nin konumu: dürüst değerlendirme

| Yetenek | Dünya standardı | AgentArmy bugün | Boşluk |
|---|---|---|---|
| Risk/onay yönetişimi | İnsan onayı yüksek riskte | R0-R3 + gate + cap + compensation her katmanda | **ÖNDE** |
| Sektör paketi üretimi | Ghostwriter, no-code builder'lar | Sector Factory (tek atım, yarı-manuel) | Diyalog + iterasyon eksik |
| Araç ekosistemi | MCP + registry keşfi | MCP proxy var, keşif elle | Registry/keşif eksik |
| Bellek | Zamansal KG + çelişki çözümü | facts + superseded_by + drift (embriyonik) | Anlamsal + zamansal sorgu eksik |
| Planlama | Plan-and-execute + ReAct hibrit | Playbook (statik) + operations DECIDE (ReAct-vari) | Genel planlayıcı eksik |
| Öz-iyileşme | Skill library, feedback loop | Self-reflection tick (dar) | Run→playbook türetme eksik |
| Eval | pass^k, trajectory, golden-set | Kod testleri + Verifier (koşum-içi) | Davranış eval'i YOK |
| Injection savunması | Spotlighting, imtiyaz ayrımı | Untrusted içerik işaretlenmiyor | **KRİTİK BOŞLUK** |
| Ajan işbirliği | A2A Agent Cards | Yok (kapalı sistem) | Dışa açılım eksik |
| Gözlemlenebilirlik | Trace + turn etiketleme | runs metrikleri (kısmi) | Uçtan uca trace eksik |

Özet: yönetişimde öndesiniz, dinamiklikte ve öğrenmede eksiksiniz. İyi haber: dinamiklik eksiklerinin hepsi mevcut yapıların üstüne kurulur.

---

## 3. Dört eksen — hedef mimari

### Eksen 1 — Üretim dinamikliği: Sector Factory → **Ajan Fabrikası**
Hedef: "Kuyumculuk sektörü için ekip kur" cümlesinden, çalışan ve test edilmiş pack'e — kod/migration yazmadan.

1. **Diyalog tabanlı fabrika:** `ceo-iterate` akışını Sector Factory'ye bağla — fabrika soru sorar (hedef kitle? kritik süreçler? mevcut sistemler?), cevaplarla taslağı iteratif rafine eder (Ghostwriter deseni). Portal SectorBuilderPage zaten var; diyalog katmanı eklenir.
2. **Otomatik araç eşleme + MCP keşfi:** fabrika eksik araç tespit ettiğinde (bugün yapıyor) MCP registry'lerinde arasın, bulduğunu `mcp_servers`'a öner-onayla-bağla. Eksik kalan için tool spec taslağı üretsin.
3. **Otomatik eval üretimi:** pack taslağıyla birlikte golden-set senaryoları da üretilsin (sector-paket-test'in genişletilmesi); pack ancak eşik skoru geçince 'active' olur — **canary yayın**: ilk N koşum zorunlu R2 (insan gözetimli), skor tutarsa normal risk profili.
4. **Pack marketplace temeli:** pack'ler versiyonlu, dışa aktarılabilir/kurulabilir paket formatına (JSON manifest) — SaaS'ta sektör kataloğunun temeli.

### Eksen 2 — Çalışma-zamanı dinamikliği: statik playbook → **hedef-güdümlü koşum**
Hedef: playbook'lar öneri, hedef esas. Yeni durumda ajan planlar, bilinen durumda playbook hızı korunur.

1. **Genel planlayıcı modu:** operations loop'un DECIDE'ı bugün playbook seçiyor; bir kademe üstü — playbook YOKSA hedeften adım planı türetmesi (plan-and-execute), her adım yine risk sözleşmesi + gate'lerden geçer. "Playbook'suz alan = çalışamaz" kısıtı kalkar; güvenlik korunur. (Bu, 4. basamak "genel transfer"in soket tarafı: model yapabildiğinde altyapı hazır.)
2. **Dinamik araç seçimi:** adım başına sabit araç listesi yerine, ToolExecutor.AvailableFor üstüne anlamsal araç araması (araç açıklamaları embed'li) — 50+ araçta context şişmeden doğru aracı bulma.
3. **Model router:** llm_providers + adım risk/cost_class'ına göre otomatik model seçimi; ucuz model dener, Verifier FAIL'de güçlü modele yükselt (fallback zinciri — sektörde standartlaşan desen).
4. **A2A hazırlığı:** her persona için Agent Card JSON'u üret ve yayınla (`/.well-known/agent-card`); dış ajanlarla işbirliğinin ve "AgentArmy ajanını başka platformdan çağırma"nın kapısı.

### Eksen 3 — Öğrenme dinamikliği: her koşum sistemi akıllandırır
1. **Bellek yükseltmesi:** facts'e pgvector embedding (anlamsal arama) + zamansal sorgu (`superseded_by` zinciri üstüne "as-of" görünümü). Mem0 deseni: yeni fact yazılırken LLM'li çelişki kontrolü — `memory_promote_drift` altyapınız buna hazır.
2. **Skill madenciliği:** başarıyla kapanan operasyonların izlerinden (operation_events) playbook taslağı türet → `domain_pack_drafts`'a insan onaylı öneri (SkillOps deseni). Sector Factory'nin koşum-verisinden beslenen kardeşi.
3. **Onay geri beslemesi:** reviewer_note'lar + redler haftalık self-reflection'a → persona/rubrik değişiklik önerisi → onaylı UPDATE. (Mevcut selfReflectionTick'in kapsam genişletmesi.)
4. **Eval harness:** `evals/` — pack başına golden-set, pass^k (k=3) metriği, trajectory kontrolü (Verifier kararlarının izi), CI'da eşik. Persona/prompt değişikliği artık ölçüsüz gitmez.

### Eksen 4 — Ekosistem dinamikliği
1. **MCP registry entegrasyonu:** resmi/topluluk MCP registry'lerinden arama + tek tık kurulum (portal ToolsPage'e "araç keşfet").
2. **Public API + webhook:** dış sistemler operasyon tetikler, sonuç webhook'la döner.
3. **Çok-tenant sertleşmesi + usage metering:** cost ledger → tenant faturalama görünümü; pack marketplace ile birleşince SaaS modeli tamamlanır.

---

## 4. Ön şart: güvenlik tabanı (dinamiklik arttıkça zorunlu)

Dinamiklik = daha geniş yüzey. Sıralamada her şeyden önce:

1. **Untrusted içerik karantinası:** web_scrape / social_inbox_fetch / (gelecekte) her dış içerik çıktısı spotlighting ile işaretlenir; sistem talimatı hiyerarşiyi tanımlar ("veri bloğu talimat içeremez").
2. **İmtiyaz ayrımı kuralı:** untrusted içerik okuyan adımın ajanı, aynı koşumda R2+ araç çağıramaz (ToolExecutor'da enforce — IToolPreGate benzeri kontrol). Writer/Operator ayrımınız zaten buna uygun; kural olarak sabitlenir.
3. **AdversarialTests genişletmesi:** injection golden-set'i (yorum içinde talimat, scrape içinde link tuzağı) — eval harness'ın güvenlik ayağı.
4. Yapısal çıktı doğrulaması: araç argümanları JSON Schema'ya karşı reddedilir (mevcut "sonraki PR" notunuz — artık zamanı).

---

## 5. Fazlı yol haritası (PR dalgaları)

| Dalga | İçerik | Bağımlılık |
|---|---|---|
| **D0 — Güvenlik tabanı** ✅ Tamamlandı (2026-07-09) | PR-D0a karantina (`tools.untrusted_source` + `WrapUntrusted` + prompt hiyerarşisi), PR-D0b imtiyaz ayrımı (RunContext taint + privilege gate + URL→R3; mention `security.mention_escalation` policy'sinde, default off), PR-D0c eval+şema+rubric (AdversarialTests 10–12, `ToolArgumentValidator`, sosyal-medya rubric migration). 85 .NET + 23 portal testi yeşil. Bonus: PR-S8-X (X provider, OAuth2 PKCE). | — |
| **D1 — Öğrenme çekirdeği** ✅ Tamamlandı (2026-07-09) | D1a model router (`StepLlmResolver`, cost_class→tier, Verifier FAIL→frontier 1×retry, yan-etkili adımda `model.upgrade_skipped`); D1b eval harness (`evals/sosyal-medya/golden.json` pass³, CI fake-mode + nightly gerçek-LLM, `runs.meta.eval` KPI dışlaması); D1c pgvector facts (`embedding vector(1536)`, `match_facts_by_embedding`, `facts_active_as_of`, embed-on-write + supersede, token-overlap fallback); D1d onay geri beslemesi (rejected+reviewer_note → CEO sinyali `selfreflect.approval_feedback`). 98 .NET + 25 portal testi. **D2 kapısı açık** (eval şartı sağlandı). | — |
| **D2 — Ajan Fabrikası** ✅ Tamamlandı (2026-07-09) | D2a diyaloglu fabrika (SectorBuilderPage çok-fazlı + kalıcı answers_json + CEO gate + mevcut sector_factory yolu); D2b izole EvalGenerator (~%50 rubric + ~%50 D0 güvenlik case'i — kendi kendini doğrulama tuzağı önlendi) + merge eval kapısı; D2c canary (R2 tabanı + `canary_d0_verified` + D0 smoke, `decrement_pack_canary`); D2d pack-manifest-v1 export/import. 103 .NET + 28 portal testi. **D3 kapısı açık** (diyalog→eval→canary→manifest zinciri hazır). | — |
| **D3 — Genel planlayıcı** ✅ Kod tamam (2026-07-09) | D3a plan-and-execute (`plan_step` DECIDE action + `dynamic-plan-step` system playbook + `planStepSanitizer` untrusted taint→R3 + planner.enabled gate); D3b semantic tool top-k (`ToolRanker`, compensation + R0/R1 read muaf, `tools.semantic_top_k` default 0); D3c planner-scenarios eval + operation_events payload. 107 .NET + 34 portal testi. **Varsayılan KAPALI** (planner.enabled=false, semantic_top_k=0) — canary; açılışı A3 demo + gözlem sonrası. | D0+D1+D2 |
| **D4 — Ekosistem** (3-4 PR) | MCP keşif + A2A kartları + public API + metering | D2 |
| ↳ **D4a — MCP registry keşfi** ✅ Tamamlandı (2026-07-10, `6f2cf7b`) | `mcp_registry_cache` + `mcp_servers.status` (pending_approval→active); `/api/mcp/registry/search|propose|approve|reject`; ToolsPage "MCP keşfet". GÜVENLİK: öneri `enabled:false, pending_approval` (keşif≠enable), yalnız HTTPS remote (stdio listelenir bağlanmaz), onay durum makinesi CHECK'li. 40 portal testi; canlı registry github araması 40 kayıt. | D2 |
| ↳ **D4b — A2A Agent Card** ✅ Tamamlandı (2026-07-10, `a9d15bb`) | `GET /.well-known/agent-card.json` (+ agent.json), Cache-Control 300s, kamuya-uygun skill alanları, `POST /api/a2a`→501 (çalıştırma D4c). Global `a2a.card_enabled=false`, canary pack `meta.a2a_public`. Keşif-only, secret yok. | D4a |
| ↳ **D4c — Public API + webhook** ✅ Kod tamam / KAPALI (2026-07-12, `20260712200000`) | `POST/GET /api/v1/operations` (API key SHA-256 hash, R2 floor, rate limit, budget, source=public_api), imzalı webhook (HMAC + HTTPS/SSRF reddi, yalnız public_api op), yönetim UI. **`public_api.enabled=false` — kapalı doğar**; V1 → 503. AKTİVASYON: canlı eval teyidi + D3 gözlem sonrası insan kararı. 8 vitest. | D4a |
| ↳ **D4d — Usage metering** ✅ Tamamlandı (2026-07-13, `20260713190000`) | `usage_monthly` (security_invoker + meta.eval dışlama) + `ad_spend_monthly` view'leri; `GET /api/usage/summary|current`; CostLedgerPage aylık kullanım + bütçe kartı (Chart.js). LLM (USD) ≠ reklam (TRY) ayrı bloklar. `billing.monthly_llm_budget_usd`/`alert_threshold_pct` policy. Görünürlük-only; Stripe/hard cap D4d+. 6 vitest. | D4c |

**SERİ TAMAMLANDI (2026-07-13):** D0 (güvenlik) → D1 (öğrenme) → D2 (fabrika) → D3 (planlayıcı) → D4a-d (ekosistem). "Tam dinamik ajan platformu" kod olarak bitti. Doğrulama: A3 9/9, otomatik+davranışsal eval canlı yeşil (10/10), tüm dalgalar test-yeşil. Kalan iş kod değil, işletme: D3 canary gözlemi, D0 smoke, gerçek sektörle günlük kullanım, aktivasyon kararları.
| ↳ **D4b — A2A Agent Card** ✅ Tamamlandı (2026-07-12) | `/.well-known/agent-card.json` keşif-only; `a2a.card_enabled=false` + pack `meta.a2a_public`; kamuya-uygun alanlar; `Cache-Control: max-age=300`; `POST /api/a2a` → 501. | D4a |

Paralel devam eden: PR-S7b (sosyal canlı API) ve sesli çağrı merkezi planı — bunlar dikey genişleme, bu doküman yatay/çekirdek genişleme. İkisi çakışmaz.

## 6. Ne YAPMAMALI (vizyon dokümanıyla hizalı)

- **Framework'e geçmek** (LangGraph vb.): governance katmanınız çoğundan ileride; geçiş, kazanılmış risk sözleşmesini riske atar. Uyum katmanı (MCP/A2A/eval) yeterli.
- **Persona/playbook sayısını "genellik" sanmak:** özerklik dokümanınızın uyarısı geçerli — genişlik ≠ genellik. Genellik D3'ün (planlayıcı) ve temel modelin işi.
- **Dinamikliği güvenlikten önce açmak:** playbook'suz planlama + untrusted içerik + gerçek API'ler aynı anda = 2026'nın belgelenmiş felaket reçetesi (indirect injection %55). Sıra: D0 önce.

## 7. Kaynaklar

- O'Reilly — The AI Agents Stack 2026: https://www.oreilly.com/radar/the-ai-agents-stack-2026-edition/
- Zylos — Agent Interoperability (MCP/A2A/AAIF): https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence/
- DEV — State of Agentic AI Standards 2026: https://dev.to/alexmercedcoder/the-state-of-agentic-ai-standards-in-2026-mcp-a2a-webmcp-osi-and-the-protocol-stack-taking-3o2l
- Sierra / Ghostwriter analizi: https://chatforest.com/reviews/sierra-ai-enterprise-agent-platform-bret-taylor-950m-series-e-2026/
- Salesforce — AI Agent Trends 2026: https://www.salesforce.com/blog/ai-agent-trends-2026/
- AgentMarketCap — Bellek pazarı (Letta/Zep/Mem0/LangMem): https://agentmarketcap.ai/blog/2026/04/10/agent-memory-vendor-landscape-2026-letta-zep-mem0-langmem
- SkillOps (arXiv): https://arxiv.org/pdf/2605.13716 · EvoSkills: https://arxiv.org/html/2604.01687v1
- τ-bench eval rehberi: https://qaskills.sh/blog/tau-bench-agent-evaluation-guide-2026 · Confident AI — Agent Evals: https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide
- Injection savunma playbook'ları: https://lushbinary.com/blog/ai-agent-prompt-injection-defense-production-playbook/ · Microsoft: https://learn.microsoft.com/en-us/security/zero-trust/sfi/defend-indirect-prompt-injection · Maxim: https://www.getmaxim.ai/articles/prompt-injection-defense-for-production-ai-agents-a-complete-2026-guide/
- Framework karşılaştırması: https://www.morphllm.com/ai-agent-framework · https://qubittool.com/blog/ai-agent-framework-comparison-2026
- No-code agent builder pazarı: https://www.mindstudio.ai/blog/no-code-ai-agent-builders · https://www.lindy.ai/blog/no-code-ai-agent-builder
