# Tedarik Otomasyonu (Stok → Araştırma → Onaylı Satın Alma → Kargo)

IdeaSoft senaryosu: bir ürünün stoğu eşik altına düşünce sistem otomatik tedarik araştırması
yapar, en uygun seçeneği önerir; satın alma **insan onayından** sonra yürür ve kargo takip edilir.

## DB-first ilke

Bu sistemde **statik içerik yoktur**. Migration'lar yalnız **şema**, repodaki C# dosyaları yalnız
**kod** (tool executor'ları, worker). Tüm **içerik** — pack, playbook, persona, bundle, araç kaydı,
stok — DB'de dinamik satırdır ve **portaldaki CRUD sayfalarından** yönetilir
(`/playbooks`, `/personas`, `/bundles`, `/tools`, ileride stok ekranı). `sync-to-db` ve JSON/md
dosyaları kaldırılmıştır.

## Akış (iki aşamalı)

1. **Stok izleyici** (`portal/api/lib/stockMonitorTick.ts`) DB'deki `stock_levels` tablosunu tarar.
   Eşik altına düşen (`current_stock <= threshold`, `enabled`) her ürün için **araştırma**
   run_request'i (R1) oluşturur.
2. **Araştırma playbook'u** (`e-ticaret-tedarik-arastirma`, R1): `stock_check` → tedarikçi/fiyat
   araştırması (web) → karşılaştırma → **satın alma önerisi** → doğrulama.
3. **Satın alma playbook'u** (`e-ticaret-tedarik-satinalma`, R3): `purchase_order` çağrısı
   **approval_queue**'ya düşer; onaylayınca sipariş geçer, ardından `cargo_track` ile kargo izlenir.

> `purchase_order` aracı R3 olduğundan, tek bir bundle çalışmasında bile satın alma adımı
> tool seviyesindeki RiskGate ile otomatik insan onayına düşer.

## Kod tarafı (repoda; şema + kod)

- Araçlar (CLI `ToolExecutor.CreateDefault`): `StockCheckTool` (DB'den okur), `PurchaseOrderTool`
  (R3/onaylı, dummy), `CargoTrackTool` (dummy).
- Migration `0032_tedarik_tools.sql`: `tools.category` CHECK'ine `commerce`/`logistics` ekler (şema).
- Migration `0033_stock_levels.sql`: `stock_levels` tablosu (şema).
- `portal/api/lib/stockMonitorTick.ts`: stok izleyici (DB'den okur).

## Kurulum (içerik DB'de oluşturulur)

### 1) Migration'ları uygula
```
supabase db push     # 0032 (kategori) + 0033 (stock_levels)
```

### 2) Araç kayıtlarını portaldan ekle (`/tools`)
Portalda **Araçlar** sayfasından şu üç kaydı oluştur (yürütme CLI'da; bu kayıtlar listeleme +
izin içindir):

| slug | category | side_effect | reversible | min_risk |
| --- | --- | --- | --- | --- |
| `stock_check` | data | read | true | R0 |
| `purchase_order` | commerce | external | true | R3 |
| `cargo_track` | logistics | read | true | R1 |

### 3) Persona ekle (`/personas`)
slug: `satin-alma-uzmani` — "Stok ve tedarikten sorumlu satın alma uzmanı. Önce `stock_check` ile
stoğu doğrula; eşik altındaysa tedarikçi/fiyat araştır, tek net öneri üret. Satın alma R3,
insan onayı gerekir; onaysız sipariş geçmez."

### 4) Playbook'ları ekle (`/playbooks`, pack = `e-ticaret`)

**`e-ticaret-tedarik-arastirma`** (defaultRisk R1, persona `satin-alma-uzmani`) — adımlar:
1. `stock` · Operator — `stock_check` ile stok ve eşik altı durumunu belirle, önerilen sipariş adedini hesapla.
2. `research` · Researcher — en az 3 tedarikçi/pazar yeri: fiyat, min. sipariş, stok, teslim, kaynak URL.
3. `compare` · Analyst — toplam maliyet/teslim/güvenilirlik karşılaştırması; tek önerilen seçenek + gerekçe.
4. `recommend` · Writer — satın alma önerisi: ürün/tedarikçi/adet/birim fiyat/toplam/teslim/kaynak.
5. `verify` · Verifier — kaynak/tarih kontrolü; VERDICT: PASS/FAIL.

**`e-ticaret-tedarik-satinalma`** (defaultRisk R3, persona `satin-alma-uzmani`) — adımlar:
1. `order` · Operator — `purchase_order` çağır (R3 → onaya düşer); sipariş/takip no kaydet.
2. `track` · Operator — `cargo_track` ile kargo durumunu al.
3. `report` · Writer — sipariş + kargo tek sayfalık özet.

### 5) Bundle ekle (`/bundles`, pack = `e-ticaret`)
slug `tedarik-otomasyonu` → playbooks: `e-ticaret-tedarik-arastirma`, `e-ticaret-tedarik-satinalma`.

### 6) Stok satırı ekle (`stock_levels`)
Demo için (kendi user id'nle), portaldan veya SQL ile:
```sql
insert into public.stock_levels (owner_user_id, product, sku, current_stock, threshold, target_stock, warehouse)
values ('<senin-user-id>', 'kırmızı kalem', 'KIR-0001', 8, 10, 1000, 'Merkez Depo');
```
Yarın IdeaSoft/ERP API'si aynı tabloyu upsert ederek besleyebilir (`source` alanı kaynağı belirtir).

## Çalıştırma

- **Otomatik:** `STOCK_MONITOR_OWNER_ID` gerekmez (tablo owner'a göre okunur); cron ile
  `npx tsx portal/api/lib/stockMonitorTick.ts` — eşik altı ürünler için araştırma işini açar.
- **Manuel (Yeni İş):**
  - Araştırma: pack `e-ticaret`, playbook `e-ticaret-tedarik-arastirma`, risk R1,
    Tools: `tools: stock_check, web_scrape; max_calls: 6`
  - Satın alma: playbook `e-ticaret-tedarik-satinalma`, risk R3,
    Tools: `tools: purchase_order, cargo_track; max_calls: 4` → satın alma **Onay Kuyruğu**'na düşer.

## Demo → gerçek geçişi

`purchase_order`/`cargo_track` şu an gerçekçi **sahte** çıktı üretir; `stock_check` zaten DB'den
okur. Gerçeğe geçerken yalnız ilgili `ITool.InvokeAsync` gövdesi (ve stok için API→`stock_levels`
besleme) değişir; sözleşme, risk sınıfı ve onay akışı aynı kalır.
