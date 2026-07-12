# D4d — Usage Metering (SaaS faturalama temeli)

Tarih: 2026-07-12 · Durum: Plan · Risk: **Düşük** (dış saldırı yüzeyi yok — iç veri okuma/toplama)

## Bağlam ve konum

D4 ekosistem dalgasının son parçası. D4a (MCP keşif), D4b (A2A kart), D4c (public API) tamam. D4d dış yüzey açmaz; mevcut maliyet verisini tenant başına toplar, gösterir ve kota temeli kurar. D3 gözlem penceresiyle çakışmaz — planlayıcıya/dış yüzeye dokunmaz.

**Mevcut altyapı (doğrulandı):**

| Kaynak | Kolon | Not |
|---|---|---|
| `runs` | `owner_user_id`, `cost_usd` (NUMERIC 12,6), `tokens_in/out`, `domain_pack`, `model`, `meta` (eval dışlama), `created_at` | LLM maliyeti; `idx_runs_cost_usd(owner, cost)` var |
| `ad_spend_ledger` | `owner_user_id`, `spent`, `currency`, `campaign_id`, `platform` | Reklam harcaması (LLM'den ayrı) |
| `operation_budgets` | `scope`, `period` (daily/weekly/monthly), `period_start` | Kota deseni hazır |
| `runs_cost_ledger` sayfası | `portal/src/pages/CostLedgerPage.tsx` | Genişletilecek, yeniden yazılmayacak |

**Kritik ayrım:** LLM maliyeti (`runs.cost_usd`, USD) ile reklam harcaması (`ad_spend_ledger.spent`, TRY vb.) **farklı para birimi ve farklı anlam** — asla toplanmaz, ayrı gösterilir. Eval koşumları (`runs.meta.eval=true`) tüm faturalama görünümlerinden dışlanır (D1b kararı).

## Kapsam

Bu PR **ölçüm ve görünürlük** kurar; gerçek ödeme (Stripe) kapsam dışı — o ayrı bir PR (D4d+). Amaç: tenant "bu ay ne kadar tükettim, hangi pack/model, kotama ne kadar kaldı" görebilsin ve operatör tenant başına kullanımı izleyebilsin.

## Uygulama

### 1) Migration — `supabase/migrations/20260713XXXX_d4d_metering.sql`

**a) Aylık özet view (materialized değil — canlı):**
```sql
CREATE OR REPLACE VIEW public.usage_monthly AS
SELECT
  owner_user_id,
  date_trunc('month', created_at)::date AS period_month,
  domain_pack,
  count(*)                              AS run_count,
  coalesce(sum(cost_usd), 0)            AS llm_cost_usd,
  coalesce(sum(tokens_in), 0)           AS tokens_in,
  coalesce(sum(tokens_out), 0)          AS tokens_out
FROM public.runs
WHERE (meta->>'eval') IS DISTINCT FROM 'true'   -- eval koşumları dışlanır
GROUP BY owner_user_id, date_trunc('month', created_at), domain_pack;
```
- RLS: view `security_invoker` (Postgres 15+) veya altındaki `runs` RLS'ine güvenir — owner yalnız kendi satırını görür; service_role hepsini.
- Reklam harcaması ayrı view: `ad_spend_monthly` (owner, period_month, platform, currency, sum(spent)).

**b) Kota policy seed'leri** (`operation_budgets` deseni değil, `policy_settings`):
- `billing.monthly_llm_budget_usd` (default `null` = limitsiz; tenant/global override)
- `billing.alert_threshold_pct` (default `80` — bütçenin %80'inde uyarı)

**c) Opsiyonel `usage_alerts` tablosu:** owner, period_month, threshold_pct, notified_at — mükerrer uyarı önlemek için. (Basit tutmak istiyorsak v1'de atlanabilir; alert selfReflection/schedule ile de yapılabilir.)

### 2) API — `portal/api/routes/usage.ts` (JWT, owner-scoped)
- `GET /api/usage/summary?months=6` → `usage_monthly` + `ad_spend_monthly` owner için; LLM ve reklam **ayrı bloklar**.
- `GET /api/usage/current` → bu ayın toplamı + `billing.monthly_llm_budget_usd` → kalan/yüzde.
- Operatör görünümü (opsiyonel, admin flag'li): `GET /api/usage/tenants` → tüm tenant'ların aylık özeti (yalnız platform admin — mevcut admin kontrolü varsa ona bağla, yoksa bu endpoint'i v1'de atla).

### 3) Portal — CostLedgerPage genişletme (yeni sayfa değil)
- Mevcut sayfaya "Aylık Kullanım" sekmesi/bölümü: son 6 ay LLM maliyeti (USD) çizgi/bar + pack kırılımı; ayrı "Reklam Harcaması" bloğu (TRY, platform kırılımı).
- "Bu ay" kartı: harcanan / bütçe / kalan yüzde; %80 aşımında amber, %100'de kırmızı bant.
- Grafik: Chart.js (artifact deseni) veya mevcut portal grafik kütüphanesi — yeni bağımlılık ekleme.

### 4) Bütçe uyarısı (hafif, opsiyonel)
- `selfReflectionTick` veya yeni küçük `usageAlertTick`: aylık LLM maliyeti `billing.monthly_llm_budget_usd × alert_threshold_pct/100`'ü aşan owner'lara `notification_channels` üzerinden bir kez bildirim (`usage_alerts` ile dedup).
- Bu, mevcut bildirim altyapısını kullanır; yeni mekanizma yok.

### 5) Test
- `usage.test.ts`: eval run'ları özetten dışlanıyor mu (meta.eval=true → sayılmaz); owner-scope (başka owner'ın verisi sızmıyor); LLM ve reklam ayrı bloklar, currency karışmıyor.
- `ops:d4d-preflight`: view'ler var mı, policy seed'leri geldi mi.

## Kabul

| Kontrol | Beklenen |
|---|---|
| eval run'ları | özette YOK (meta.eval=true dışlanır) |
| owner izolasyonu | başka tenant verisi görünmez (RLS) |
| LLM vs reklam | ayrı bloklar, farklı currency toplanmaz |
| Bütçe kartı | harcanan/bütçe/kalan; %80 amber, %100 kırmızı |
| Bütçe null | "limitsiz" gösterir, hata vermez |
| Regresyon | mevcut CostLedgerPage bozulmaz |

## Bilinçli dışı (D4d+ / sonraki)
- Stripe/gerçek ödeme entegrasyonu
- Fatura PDF üretimi
- Kullanıma göre sert kesme (hard cap ile operasyon reddi) — şimdilik yalnız uyarı; sert kesme istenirse `consume_budget` deseniyle ayrı PR
- Multi-currency normalizasyon (USD/TRY dönüşümü) — ayrı gösterim yeterli

## Neden düşük risk
Dış endpoint yok (hepsi JWT + owner-scoped okuma). Yeni yetki/güç açmaz. Planlayıcıya, dış yüzeye, araç katmanına dokunmaz. Mevcut veriyi okur/toplar. D3 gözlemi devam ederken paralel yapılabilir; global açma kararıyla ilgisi yok.

## Uygulama sırası
Migration (view + policy) → API (usage.ts) → Portal (CostLedgerPage bölümü) → uyarı tick (opsiyonel) → test. Tek oturumda sığar.
