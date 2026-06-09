# Tedarik Otomasyonu — Son Durum

Stok eşiği altına düşen ürünler için: **gerçek veriyle** araştırma → öneri → **insan onaylı** satın alma → kargo → stok yenileme. Uçtan uca, DB-first.

## İlke: DB-first + gerçek veri
- **Statik içerik yok.** Migration'lar yalnız şema, C# yalnız kod. Tüm içerik (pack, playbook, persona, bundle, araç kaydı, stok) DB'de; portaldan yönetilir.
- **Model olgu/link kaynağı değildir.** Ürün/fiyat/link gerçek bir arama servisinden (`product_search`) gelir; agent yalnız yorumlar.

## Akış (8 adımlı tek playbook: `e-ticaret-tedarik-tam-akis`)
1. `stock_check` (Operator) — stok + eşik altı + önerilen adet
2. `product_search` (Operator) — **gerçek** ürün/fiyat/link sonuçları
3. karşılaştırma (Analyst) — en uygun seçenek
4. öneri (Writer) — marka/model/kod/özellik/gerçek URL ile
5. `link_check` (Verifier) — linkleri doğrula (PASS/FAIL, bilgilendirici)
6. `purchase_order` (Operator) — **R3, insan onayı**; onay sonrası sipariş + **stok yenilenir**
7. `cargo_track` (Operator) — kargo durumu
8. özet (Writer)

Araç çağıran adımlar (1,2,6,7) **Operator** olmalı (yalnız `CanUseTools` ajanlar araç çağırır). 3/4/8 yorumlama adımlarıdır.

## Bileşenler (kod + şema)
**Araçlar** (CLI `ToolExecutor.CreateDefault`):
- `stock_check` — `stock_levels` tablosundan okur (read, R0)
- `product_search` — **SerpAPI/Google Shopping** birincil, **Tavily** yedek; gerçek başlık/fiyat/satıcı/URL (read, R0). Anahtar yoksa net hata (uydurmaz). Env: `SERPAPI_KEY`, `TAVILY_KEY`
- `link_check` — URL'leri HEAD ile doğrular (read)
- `purchase_order` — sipariş; **External, R3 → RiskGate onay kuyruğu**; onay sonrası `adjust_stock` RPC ile stoğu artırır; marka/model/kod/url/specs taşır
- `cargo_track` — kargo durumu (read, demo)

**Şema (migration'lar):**
- `stock_levels` tablosu (RLS: sahibi yönetir, service_role tam)
- `adjust_stock(p_owner, p_product, p_delta)` RPC — onaylı sipariş sonrası stok += adet
- `decide_approval(...)` RPC — hem job-seviye hem tool-seviye (purchase_order) onayını işler
- `tools` registry seed satırları (stock_check, product_search, purchase_order, cargo_track) + `category` CHECK genişletmesi (commerce/logistics)
- `tools.category` CHECK kısıt revizyonu

**Onay (RiskGate + approval_queue):** R2/R3 araç çağrıları onaya düşer, insan onaylayana kadar bekler. `purchase_order` R3 olduğu için sipariş onaysız geçmez.

**Stok izleyici** (`portal/api/lib/stockMonitorTick.ts` + `stock-monitor.yml` cron, 15 dk):
`stock_levels`'ı tarar, eşik altı ürünler için işi kuyruğa atar (çift tetik koruması). Varsayılan araçlar: `stock_check, product_search, web_scrape, link_check, purchase_order, cargo_track`.

**Portal:**
- `Stok` ekranı — ürün ekle/düzenle/sil, izleme aç-kapa (`/app/stock`)
- `Tedarik raporu` (`/app/tedarik-raporu`) — stok tetikleri, **bekleyen onaylar (satır-içi Onayla/Reddet + gerekçe paneli)**, siparişler, kargo; "● Canlı" otomatik yenileme
- Playbook/persona/bundle/tool CRUD sayfaları (içerik buradan yönetilir)
- `tools` chip seçici (Yeni İş + Playbook formu) — slug ezberlemeden araç seçimi

## Kurulum
1. **Migration'lar:** `supabase db push` (stock_levels, adjust_stock, decide_approval, tool seed'leri, product_search seed). Versiyon çakışması olursa `supabase migration repair --status reverted <eski no>`.
2. **GitHub Actions secret'ları:** `SERPAPI_KEY`, `TAVILY_KEY` (CLI worker kullanır — **Vercel'e gerekmez**). Ayrıca mevcut: `OPENAI_API_KEY`, `SUPABASE_*`.
3. **İçerik (portaldan):** persona `e-ticaret-tedarik-satinalma` (R3, Tam bağlam açık) + 8 adımlı `e-ticaret-tedarik-tam-akis` playbook'u.
4. **Stok satırı:** `Stok` ekranından ürün ekle (mevcut/eşik/hedef).
5. **CI build:** `agent-worker.yml` `--no-incremental` ile derler (kod değişiklikleri kesin yansır).

## Demo → gerçek geçişi
- `product_search` zaten gerçek (SerpAPI/Tavily). Daha doğru TR ürün-sayfası + canlı fiyat istenirse backend bir TR pazaryeri/fiyat API'sine çevrilir; tool sözleşmesi sabit.
- `purchase_order` ve `cargo_track` hâlâ demo (gerçekçi sahte sipariş/takip). Gerçek tedarikçi/kargo API'sine geçişte yalnız ilgili `InvokeAsync` gövdesi değişir; risk sınıfı ve onay akışı aynı kalır.

## Bilinen sınırlar / sonraki adımlar
- Verifier FAIL şu an bilgilendirici (satın almayı otomatik durdurmaz) — istenirse "FAIL → satın almayı blokla" eklenebilir.
- Onayda tek öneri onaylanır; "alternatifler arasından seç" interaktif onay eklenebilir.
- Stok teslimde değil sipariş anında yenilenir (demo tercihi).
- Bütçe sınırı / onay eşiği, e-posta/Slack bildirimi, sipariş idempotency'si eklenebilir.
