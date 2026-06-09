/**
 * Tedarik otomasyonu — Stok İzleyici
 *
 * Stok kaynağını DB'deki `stock_levels` tablosundan okur (DB-first; statik fixture yok).
 * Eşik altına düşen (current_stock <= threshold) ve enabled her ürün için e-ticaret tedarik
 * ARAŞTIRMA playbook'unu (R1) tetikler — run_requests tablosuna kayıt insert eder. Asıl
 * çalıştırmayı mevcut runRequestWorker yapar; bu yalnız tetikleme katmanıdır.
 *
 * Araştırma bir SATIN ALMA ÖNERİSİ üretir. Satın alma (R3) ayrı adımdır ve purchase_order
 * aracının kendi onay kapısıyla (approval_queue) insan onayına düşer.
 *
 * Çift tetiklemeyi önlemek için: aynı ürün için zaten açık (pending/running/waiting_approval)
 * bir tetik varsa atlar.
 *
 * Stok satırları portaldan/SQL'den yönetilir; yarın IdeaSoft/ERP API'si stock_levels'ı
 * upsert ederek besleyebilir.
 *
 * Manuel test: `npx tsx portal/api/lib/stockMonitorTick.ts`
 * Deploy: GitHub Actions cron (örn. 10 dakikada bir) bunu çağırır.
 */
import { createClient } from '@supabase/supabase-js'

function log(message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  if (!meta) { console.log(`[stock-monitor ${ts}] ${message}`); return }
  console.log(`[stock-monitor ${ts}] ${message}`, JSON.stringify(meta))
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

const DOMAIN_PACK = process.env.STOCK_DOMAIN_PACK ?? 'e-ticaret'
const PLAYBOOK = process.env.STOCK_PLAYBOOK ?? 'e-ticaret-tedarik-tam-akis'
const PERSONA = process.env.STOCK_PERSONA ?? 'satin-alma-uzmani'
const MODEL = process.env.STOCK_MODEL ?? 'gpt-4.1'
// Birleşik akış araçları: stok → gerçek ürün arama → link doğrulama → onaylı satın alma → kargo.
const TOOLS = process.env.STOCK_TOOLS ?? 'tools: stock_check, product_search, web_scrape, link_check, purchase_order, cargo_track; max_calls: 14'

const ACTIVE_STATUSES = ['pending', 'running', 'waiting_approval']

type StockRow = {
  id: string
  owner_user_id: string
  product: string
  current_stock: number
  threshold: number
  target_stock: number
}

export async function tick() {
  const supabase = getSupabase()

  // Eşik altındaki, izlenen tüm satırlar (tüm sahipler). Satır-bazlı eşik karşılaştırması
  // PostgREST'te kolon-kolon yapılamadığı için enabled satırları çekip JS'te filtreliyoruz.
  const res = await supabase
    .from('stock_levels')
    .select('id, owner_user_id, product, current_stock, threshold, target_stock')
    .eq('enabled', true)

  if (res.error) throw res.error
  const rows = (res.data ?? []) as StockRow[]
  const low = rows.filter((r) => Number(r.current_stock) <= Number(r.threshold))

  log(`stok tarandı: ${rows.length} izlenen ürün, eşik altı=${low.length}`)

  let fired = 0
  for (const r of low) {
    try {
      // Çift tetik koruması: aynı sahip + ürün için açık bir tetik var mı?
      const existing = await supabase
        .from('run_requests')
        .select('id, status')
        .eq('owner_user_id', r.owner_user_id)
        .in('status', ACTIVE_STATUSES)
        .contains('answers_json', { stock_trigger_product: r.product })
        .limit(1)

      if (existing.error) throw existing.error
      if (existing.data && existing.data.length > 0) {
        log('atlandı — zaten açık tetik var', { product: r.product, run_request_id: existing.data[0].id })
        continue
      }

      const target = Number(r.target_stock) > 0 ? Number(r.target_stock) : Number(r.threshold) * 10
      const reorderQty = Math.max(target - Number(r.current_stock), 1)
      const topic =
        `${r.product} ürününde stok ${r.current_stock} adete düştü (eşik ${r.threshold}). ` +
        `Hedef stok ${target}; yaklaşık ${reorderQty} adet tedarik gerekiyor. ` +
        `Tedarikçi/pazar yerlerini gez, güncel fiyat karşılaştırması yap ve en uygun seçeneği öner. ` +
        `2026 güncel fiyatlar olsun.`

      const ins = await supabase
        .from('run_requests')
        .insert({
          owner_user_id: r.owner_user_id,
          mode: 'run',
          domain_pack: DOMAIN_PACK,
          request_text: topic,
          answers_json: {
            playbookId: PLAYBOOK,
            persona: PERSONA,
            topic,
            stock_trigger: true,
            stock_trigger_product: r.product,
            current_stock: Number(r.current_stock),
            threshold: Number(r.threshold),
            reorder_quantity: reorderQty,
          },
          model: MODEL,
          risk: 'R1',
          allow_high_risk: false,
          web: true,
          contrarian: true,
          tools: TOOLS,
          status: 'pending',
        })
        .select('id')
        .single()

      if (ins.error) throw ins.error

      fired++
      log('tetiklendi', { product: r.product, current_stock: Number(r.current_stock), reorder_quantity: reorderQty, run_request_id: ins.data?.id })
    } catch (e) {
      log('tetik hatası', { product: r.product, error: (e as Error).message })
    }
  }

  return { scanned: rows.length, low: low.length, fired }
}

// Direkt CLI'dan çalıştırma desteği
import { fileURLToPath } from 'url'
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  tick()
    .then((r) => { console.log('OK', r); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
