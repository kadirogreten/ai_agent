# Dogfood — Market-Intel Haftalık Brief (Faz E ilk operasyonu)

**Başlangıç:** Hafta 1 = 2026-05-28
**Bağlam:** [`operasyonel-ozerklik-yol-haritasi.md`](operasyonel-ozerklik-yol-haritasi.md) Faz E'nin somut uygulaması. Amaç: Faz A'nın değerini gerçek bir operasyonda kanıtlayıp **OA2 iddiasını ölçülebilir hale getirmek**.

> Bu doküman bir mühendislik dokümanı değil, bir **operasyon kontrat ve ölçüm planıdır**. Her hafta açıp doldurursun; 5 hafta sonra karar veririz.

---

## 1. Operasyon tanımı

| Alan | Değer |
|---|---|
| **Operasyon adı** | `mi-haftalik` (run topic'lerinde `[dogfood:mi-W{n}]` etiketiyle) |
| **Domain pack** | `market-intel` |
| **Çıktı** | Haftalık AI Agent Platformları / [seçilen alt-konu] brief'i — markdown + kaynakça |
| **Hedef kitle** | Ürün Yöneticileri (PM) — kısa, kanıtlı, uygulanabilir |
| **Uzunluk hedefi** | 1 sayfa özet + 1 sayfa detay + 8–12 kaynak |
| **Tetikleyici** | İnsan (sen) — haftada bir, Çarşamba 09:00 |
| **Tüketici** | Sen (önce kendine yarar mı testi) |
| **Risk seviyesi** | R1 (otomatik üretim; insan yayını) |
| **Araç izni** | `tools: web_scrape; max_calls: 3` (kaynak çekme için; brief'in çekirdeği LLM + `--web true`) |

---

## 2. Başarı kriterleri (KPI eşikleri)

Her run sonunda bu beş metrik **yeşil/sarı/kırmızı** ile işaretlenir. 5 hafta sonra **çoğunluk yeşil** ise operasyon "üretim hazır", **çoğunluk sarı** ise iyileştirme, **kırmızı varsa** stop-and-rethink.

| KPI | Yeşil | Sarı | Kırmızı | Nasıl ölçülür |
|---|---|---|---|---|
| **Doğruluk** | ≥ 0.85 | 0.70–0.85 | < 0.70 | `verifier_outcome=pass` oranı + senin manuel "iddialar doğru mu?" puanın |
| **Kaynak kapsaması** | ≥ 0.90 | 0.70–0.90 | < 0.70 | Kritik iddiaların URL'li olma oranı (kaynaksız iddia sayısı / toplam iddia) |
| **İnsan düzeltme** | ≤ %15 | %15–30 | > %30 | Yayınlanabilir hale gelmesi için senin değiştirdiğin metin oranı |
| **Süre** | ≤ 6 dk | 6–12 dk | > 12 dk | `latency_ms` (run report'tan) |
| **Maliyet** | ≤ $0.40 | $0.40–0.80 | > $0.80 | `cost_ledger`'dan |

**Tek soruluk gerçeklik testi (her hafta):** *"Bu brief'i bana biri yollasa, gerçekten okur muydum? Sıfırdan yazmaktan vakit kazanmış mıyım?"* — Evet / Belki / Hayır.

---

## 3. Run komutları

### Hafta 1 — tek playbook (en sade başlangıç)

```bash
dotnet run --project src/AgentArmy.Cli -- run \
  --playbook mi-weekly-brief \
  --domainPack market-intel \
  --topic "[dogfood:mi-W1] AI agent platforms — son hafta önemli gelişmeler" \
  --persona pazar-arastirmaci \
  --web true \
  --model gpt-4.1 \
  --risk R1 \
  --tools "tools: web_scrape; max_calls: 3" \
  --facts true
```

Çıktı: `runs/YYYYMMDD_HHMMSS_mi-weekly-brief/` altında rapor + `tool_invocations` DB'de.

### Hafta 2 → 5 — full bundle

```bash
dotnet run --project src/AgentArmy.Cli -- bundle \
  --domainPack market-intel \
  --id weekly \
  --topic "[dogfood:mi-W{n}] {haftanın konusu}" \
  --persona pazar-arastirmaci \
  --web true \
  --model gpt-4.1 \
  --risk R1 \
  --tools "tools: web_scrape; max_calls: 3" \
  --contrarian true
```

`weekly` bundle 3 playbook çalıştırır: `mi-weekly-brief`, `mi-competitor-profile`, `mi-competitor-pricing-compare`. Karşılaştırma için W1'in tek-playbook süre/maliyetini de takip et.

---

## 4. 5-hafta protokolü

| Hafta | Tarih | Topic | Mod | Beklenen | Toplanan |
|---|---|---|---|---|---|
| W1 | 2026-05-28 | AI agent platforms — son hafta gelişmeler | tek playbook | baseline | _doldur_ |
| W2 | 2026-06-04 | Yeni model lansmanları (Claude/GPT/Gemini) | bundle | bundle ilk dönüş | _doldur_ |
| W3 | 2026-06-11 | Üretkenlik araçlarında ajan entegrasyonu | bundle | W2 hataları düzelmiş mi | _doldur_ |
| W4 | 2026-06-18 | Açık kaynak ajan framework'leri | bundle | tekrarlanabilirlik | _doldur_ |
| W5 | 2026-06-25 | Enterprise pilot vakaları | bundle | son ölçüm | _doldur_ |

**Kural:** Her hafta aynı zaman, aynı parametreler. Topic dışında değişken yok. Bir şeyi değiştirmek istersen W6'ya bırak.

---

## 5. Post-run review şablonu

Her run'dan sonra **5 dakikada** doldur. Bu kayıt, KPI panosunun ham verisi.

```markdown
### W{n} — {tarih}

**Run id:** `YYYYMMDD_HHMMSS_mi-weekly-brief`  (veya bundle id)
**Komut:** (yukarıdakinin kopyası — topic dahil)

#### KPI ölçümleri

- Doğruluk:     0.__  / 1.00  (verifier outcome + manuel ek puan)
- Kaynak:       0.__  / 1.00  (kaynaksız kritik iddia: __ / toplam: __)
- İnsan düzeltme: %__  (değiştirdiğin metin / toplam metin, kabaca)
- Süre:         __ dk  (latency_ms / 60000)
- Maliyet:      $__.__  (cost ledger'dan)
- **Gerçeklik testi:** Evet / Belki / Hayır

#### Gözlemler (serbest format, en az 3 madde)

- (örn. "Verifier 2 iddiada kaynak yok diye işaretledi, haklıydı")
- (örn. "Contrarian X şirketinin pivot ettiğini söyledi, doğru değildi — kaynak halüsinasyonu")
- (örn. "Pricing comparison playbook'u 12 dk sürdü, bütçeyi delik attı")

#### Faz B/C/D boşluğu (yol haritasını besleyen kısım)

- **B (yönetişim):** rollback gerekti mi? RiskGate atlanmış path gördün mü? Audit log eksik mi?
- **C (kapalı döngü):** "Run bittiğinde bir şey eksikti, ben tekrar tetikledim" oldu mu? Sürekli koşması gerekiyor muydu?
- **D (bellek):** Geçen haftaki bir gerçek hatırlanmadığı için tekrar mı türetildi?
- **Diğer:** (UX, hata, sürpriz)

#### Aksiyon (varsa)

- (örn. "mi-weekly-brief'in source-citation policy'sini güçlendir")
- (örn. "verifier rubric'ine 'pivot iddiaları kanıt zorunlu' ekle")
```

---

## 6. Karar kriterleri (W5 sonunda)

5 hafta sonunda KPI dağılımına bakıp **üç yoldan birini** seçeriz — doküman değil, gerçek kullanım sonucu konuşur:

1. **Yeşil çoğunluk + gerçeklik testi ≥ 4× Evet** → Operasyon kanıtlandı.
   - OA2 resmi olarak iddia edilebilir.
   - Sıradaki operasyona genişle (örn. `hibe-yazimi` veya `e-ticaret-pm`).
   - Aynı zamanda Faz C (kapalı döngü) için somut tasarım: bu brief'i otomatik haftalık tetikle.

2. **Sarı çoğunluk** → Faz A yeterli ama playbook/persona/rubric iyileştirmesi gerekiyor.
   - Hangi KPI sarıysa nedenlerini doğrudan post-run review'lerden çıkar.
   - 5 hafta daha + iyileştirme döngüsü.

3. **Kırmızı varsa** → Mühendislik boşluğu, mimari değil.
   - Hangi Faz'ın eksiği (B/C/D) en çok karşına çıktıysa, sonraki büyük yatırım o.
   - Genişletme yok; önce kök sebebi çöz.

---

## 7. Bu hafta ne yapacaksın (W1 checklist)

- [ ] Yukarıdaki **W1 komutunu** çalıştır.
- [ ] Çıktıyı (rapor + verifier raporu) **gerçekten oku** — sıfırdan yazsaydın ne kadar sürerdi, kıyasla.
- [ ] Yayınlanabilir hale getirmek için ne değiştirdin? Yüzdeyi tahmin et.
- [ ] `tool_invocations` ve `cost_ledger`'a portal'dan bak (Araçlar + Maliyet sayfaları).
- [ ] **Post-run review şablonunu** bu dosyaya (veya ayrı bir `runs/dogfood/W1.md` dosyasına) doldur.
- [ ] Sonuçları benimle paylaş — KPI'lara karşı yorumlayıp W2 için ne ayar değişeceğini birlikte konuşalım.

---

## 8. Bu doküman bittiğinde elimizde ne olur?

5 haftalık ham veri + Faz B/C/D boşluk listesi. İkisi birden:
- Bir gerçek operasyonu otonom çalıştırdığını **kanıtla** (OA2 doğrulandı).
- Yol haritasındaki "Faz B/C/D'de gerçekten ne eksik?" sorusunu **somut deneyimden** cevapla — varsayım değil, yaşadığın gerçek boşluk.

O noktada **PR8 değil, bilinçli stratejik adım** atılır: kapalı döngüyü mü kurarız, rollback'i mi otomatikleştiririz, yoksa ikinci operasyona mı geçeriz — karar, ölçümün üstüne oturur.

---

## 9. Run logları

### W1 — 2026-05-31

**Run id:** `[dogfood:mi-W1] AI agent platforms — son hafta gelişmeler` · portal Standart mod
**Komut:** market-intel · pazar-arastirmaci · mi-weekly-brief · `tools: web_scrape; max_calls: 3` · web=true · contrarian=false
**Mod:** Tek playbook, 8 adım: research → analysis → write → verify → contrarian → write (revised) → edit → report.

#### KPI ölçümleri

- Doğruluk:        **~0.10 / 1.00**  (research dürüst — 2 gerçek bulgu; final brief 10 maddenin neredeyse hepsi uydurma URL'lerle)
- Kaynak:          **0.00 / 1.00**   ("kaynaklı" görünüyor ama URL'ler fabrike — gerçek değer sıfır)
- İnsan düzeltme:  **~%100**         (yayınlanabilir hale getirmek = sıfırdan yazmak)
- Süre:            *(cost ledger / job detayından oku)*
- Maliyet:         *(aynı)*
- **Gerçeklik testi:** **HAYIR** — biri yollasa okumam, gönderene de uyarırdım

#### Gözlemler

- **Mekanik baştan sona çalıştı.** 8 adımlı pipeline sorunsuz koştu. Bu sabahki tüm bug fix'ler (CeoExecutor comma split, bundle→playbook fallback, persona pack_id NULL filtresi, sync dedup) gerçek koşuda kanıtlandı. **Pipeline sağlam — sorun mekaniğin değil, içeriğin.**
- **Research adımı disiplinli ve dürüsttü.** İki gerçek bulgu (`Agyn` @ arxiv, `MIT AI Agent Index`) + açık not: *"Ticari platformlarda son 7 gün içinde yeni duyuru bulunamamıştır."* Beklenen profesyonel davranış.
- **Verifier "yetersiz kaynak" uyarısı verdi.** Rubric en az 10 URL ve domain çeşitliliği istedi. Madde yanlış değil ama bağlamı kaçırdı: research'ün dürüstçe rapor ettiği kıtlığı görmedi.
- **Writer "10 madde" eleştirisine uyarak fabrike etti.** Asana–Stack AI satın alımı, Notion AI summary, Gemini lansman vb. 10 madde; URL'ler 2024 tarihli (run May 2026'da koşulan run için anakronistik); büyük ihtimalle 404 dönüyor. **Klasik hallüsinasyon kaskadı.**
- **Edit adımı bu fabrikasyonu temizlemedi**, sadece tertipli sundu. Verifier'ın "kaynak çeşitliliği" metriği **lafzen karşılandı** — ama oyunlanarak.

#### Faz B/C/D boşluğu

- **B (yönetişim) — KRİTİK / yeni öncelik 1:** Verifier rubric'i **form**'u kontrol ediyor (URL sayısı, domain çeşitliliği) ama **öz**'ü kontrol etmiyor (URL gerçek mi, içerik canlı mı, tarih tutarlı mı). Sistem metric-gaming'e davet ediyor.
- **B — orta:** "Dürüst kıtlık" akışı yok. Research az şey bulduğunda Writer'a "az şey yaz, kıtlığı belirt" yönergesi yok → hallüsinasyon kaskadı doğal sonuç.
- **C (kapalı döngü):** Etkilenmedi henüz — ama bu kalite tabanı sağlanmadan kapalı döngü kurmak = otomatik yanlış-bilgi-üretimi. Faz C beklemeli.
- **D (bellek):** Etkilenmedi.

#### Aksiyon

- ✅ **Yapıldı: "Substance Verifier" PR** (Faz B'yi başlatıyor):
  1. Yeni `link_check` aracı (URL HEAD check, side_effect=read, R0, geri-alınabilir).
  2. Verifier ajanı `CanUseTools=true` + system prompt'a "kritik iddialar için link_check kullan; dead/anakronistik URL'leri FAIL işaretle" yönergesi.
  3. `mi-weekly-brief` Write ve Verify adımlarına "dürüst kıtlık" + "link_check kullan" yönergesi.
  4. `market-intel/rubrics/verifier.md` substance kontrolleri (URL liveness, tarih tutarlılık, kıtlık dürüstlüğü).
  5. Migration 0031: `link_check` tools tablosuna seed.
- **W2 (aynı topic, kontrol turu):** substance verifier devreye girince hallüsinasyon kayboldu mu kontrolü. **Araç izinlerine `link_check` ekle:** `tools: web_scrape, link_check; max_calls: 5`.

#### Karar değişikliği

Bu doküman §3 önceliği "Faz E → C → B → D" idi. **W1 verisi sonrası yeni sıra: Faz B (substance verifier) → Faz E (W2 kontrol) → C → D.** Substance verifier işe yaramazsa daha derin Faz B yatırımı gerekir.

---

### W2 (kontrol) — 2026-05-31 (aynı gün, fix sonrası kontrol)

**Run id:** `[dogfood:mi-W2-control] AI agent platforms — son hafta gelişmeler` · portal Standart mod
**Komut:** market-intel · pazar-arastirmaci · mi-weekly-brief · **`tools: web_scrape, link_check; max_calls: 5`** · web=true · contrarian=false
**Mod:** Substance verifier devrede (Verifier `CanUseTools=true`, link_check kayıtlı, playbook v2 + rubric §2/§3).

#### KPI ölçümleri

- Doğruluk:        **~0.40 / 1.00**  (research+write dürüsttü; edit adımı hallüsinasyona yeniden düştü)
- Kaynak:          **~0.30 / 1.00**  (verifier'ın gördüğü 2 URL geçti; edit'in eklediği 6 URL doğrulanmadı)
- İnsan düzeltme:  **~%75**          (research+write çıktısı kullanılabilir; edit çıktısı atılır)
- Süre:            *(cost ledger'dan)*
- Maliyet:         *(aynı)*
- **Gerçeklik testi:** **BELKİ** — research+write düzeyi yararlı; edit-final düzeyi yine yayınlanamaz

#### Gözlemler — substance verifier işe yaradı, ama upstream'de yeni bir bug bulduk

- ✅ **Research dürüst kaldı** (2 gerçek bulgu: IBM watsonx Orchestrate, Agyn arxiv) + kıtlık beyanı.
- ✅ **Write (ilk) dürüst kaldı** — 2 madde, kıtlık notu, uydurma yok. Playbook v2 değişikliği işe yaradı.
- ✅ **Verifier link_check'i kullandı** — `tool_invocations` tablosunda görünmeli; 2 URL'i HEAD ile kontrol etti, ikisi de 200, tarih tutarlı. Verdikt: PASS. Tool döngüsü uçtan uca çalıştı.
- ❌ **Yeni bug — `Orchestrator.IsFail` substring false positive:** Verifier raporu açıkça PASS dedi ama içinde "PASS/FAIL", "FAIL ver:" gibi açıklayıcı ifadeler geçtiği için `Contains("FAIL")` true döndü → **write.revised tetiklendi**.
- ❌ **Write.revised kafa karıştı** — verifier raporunu input olarak aldı, "düzeltilecek sorun yok"u görünce verifier raporunu re-yazdı (saçma çıktı).
- ❌ **Edit hallüsinasyona kapı açtı** — verbose model yazıyı "geliştirmek" için 6 sahte madde ekledi (Asana–Stack AI, Gemini 3.5 Flash, Notion Developer Platform vb. — hepsi `?utm_source=openai` parametreli, model OpenAI search aracı çıktısı sandığı URL'leri kopyalıyor olabilir).
- ⚠️ **SummaryAgent ironik biçimde sadık kaldı** — 2-maddelik özet üretti; demek ki içerikte gerçek 2 vardı, edit hayali ekledi.

#### Faz B/C/D boşluğu

- **B (yönetişim) — yeni bug:** `Orchestrator.IsFail` naive substring kontrolü → false positive cascade. Pipeline tekrar üretme döngüsüne giriyor, model "kıtlık var, daha çok ekle" diye yorumluyor, hallüsinasyon zinciri başlıyor. **Tek bir kötü check, tüm substance verifier yatırımını boşa çıkardı.**
- **B (yönetişim) — Editor disiplini:** mi-weekly-brief.json edit step'ine "URL EKLEME" yazmıştık ama Editor agent system prompt'unda da koruma yok. Playbook talimatı şu an Goal alanında, Agent system prompt'una baskın değil. İleride Editor için de "asla yeni iddia ekleme" sıkı kuralı gerekecek.
- **C / D:** Etkilenmedi.

#### Aksiyon

- ✅ **Yapıldı: IsFail bug fix:**
  1. `Orchestrator.IsFail` artık explicit `VERDICT: PASS/FAIL` marker'a bakar (substring değil).
  2. Verifier system prompt'u zorunlu son-satır `VERDICT: PASS` / `VERDICT: FAIL` formatı koşar.
  3. `verifier.md` §5 bu kuralı dokümante eder.
- **W3 kontrol turu:** aynı topic ile tekrar koş. Beklenen: verifier PASS verdikten sonra write.revised TETİKLENMEZ, edit yalnız formatlayıp 2-maddelik dürüst brief'i geçirir.

#### Karar — Faz B yatırımı 2. tur

W2'de gördük ki "substance verifier" tek katmanda yetmiyor — orkestrasyon mantığı içinde de "küçük naive kontroller" iş çıkıyor. Sonraki Faz B yatırımları aday listesi:
1. (✅ yapıldı) IsFail verdikt-bazlı.
2. Editor agent system prompt'unda "asla yeni iddia/URL ekleme" sıkı kuralı.
3. Verifier'ı edit SONRASI bir kez daha çalıştır (substance check edit'in eklediklerini de yakalasın).
4. Tool-call'da `web_search`'ün hangi adımda kullanıldığını ve hangi URL'leri ürettiğini event log'a aç — sahte URL'lerin kaynağını izle.

W3 sonucuna göre 2/3/4'ten hangisinin daha kritik olduğu netleşecek.
