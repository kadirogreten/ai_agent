/**
 * Tedarik otomasyonu — Stok İzleyici (PR6: operations tablosuna geç)
 *
 * Stok kaynağını DB'deki `stock_levels` tablosundan okur (DB-first; statik fixture yok).
 * Eşik altına düşen (current_stock <= threshold) ve enabled her ürün için bir `operations`
 * kaydı açar. operationLoopTick bu operasyonu döngüye alır; ilk tick araştırma playbook'unu,
 * ardından sipariş, ardından kargo fazını yönetir.
 *
 * Çift tetik koruması: aynı ürün için zaten aktif/duraklatılmış bir operasyon varsa
 * (context_json->>'stock_trigger_product' eşleşmesi) yenisini açma.
 *
 * Playbook slug'ları: 'tedarik-arastirma' (faz 1), 'tedarik-siparis' (faz 2), 'tedarik-kargo' (faz 3).
 * LLM bu slug'ları DECIDE yanıtında kullanır; migration'da seed edilmiştir.
 *
 * Manuel test: `npx tsx portal/api/lib/stockMonitorTick.ts`
 * Deploy: GitHub Actions cron (10 dk) bunu çağırır.
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

const DOMAIN_PACK      = process.env.STOCK_DOMAIN_PACK ?? 'e-ticaret'
const PERSONA          = process.env.STOCK_PERSONA     ?? 'satin-alma-uzmani'
const MODEL            = process.env.STOCK_MODEL       ?? 'gpt-4.1'
const MAX_STEPS        = parseInt(process.env.STOCK_MAX_STEPS        ?? '12',  10)
const COOLDOWN_MINUTES = parseInt(process.env.STOCK_COOLDOWN_MINUTES ?? '30',  10)

// Aktif sayılan operasyon durumları — bu durumlarda aynı ürün için yeni operasyon açılmaz.
const ACTIVE_OP_STATUSES = ['active', 'paused']

type StockRow = {
  id:            string
  owner_user_id: string
  product:       string
  current_stock: number
  threshold:     number
  target_stock:  number
}

export async function tick() {
  const supabase = getSupabase()

  // Eşik altındaki, izlenen tüm satırlar.
  const res = await supabase
    .from('stock_levels')
    .select('id, owner_user_id, product, current_stock, threshold, target_stock')
    .eq('enabled', true)

  if (res.error) throw res.error
  const rows = (res.data ?? []) as StockRow[]
  const low  = rows.filter((r) => Number(r.current_stock) <= Number(r.threshold))

  log(`stok tarandı: ${rows.length} izlenen ürün, eşik altı=${low.length}`)

  let fired = 0
  for (const r of low) {
    try {
      // ── Çift tetik koruması: aynı sahip + ürün için açık operasyon var mı? ──
      // context_json->>'stock_trigger_product' eşleşmesi (migration Adım 1'de eklendi).
      const existing = await supabase
        .from('operations')
        .select('id, status')
        .eq('owner_user_id', r.owner_user_id)
        .in('status', ACTIVE_OP_STATUSES)
        .filter('context_json->>\'stock_trigger_product\'', 'eq', r.product)
        .limit(1)

      if (existing.error) throw existing.error
      if (existing.data && existing.data.length > 0) {
        log('atlandı — zaten açık operasyon var', {
          product:      r.product,
          operation_id: existing.data[0].id,
          status:       existing.data[0].status,
        })
        continue
      }

      const target     = Number(r.target_stock) > 0 ? Number(r.target_stock) : Number(r.threshold) * 10
      const reorderQty = Math.max(target - Number(r.current_stock), 1)

      const goalText =
        `${r.product} ürününün stoğunu ${target} adede çıkar. ` +
        `Mevcut stok: ${r.current_stock} (eşik: ${r.threshold}). ` +
        `Tedarik edilecek adet: ${reorderQty}.`

      // ── Operasyon aç ──────────────────────────────────────────────────────────
      // İlk playbook operationLoopTick'in DECIDE fazında belirlenir (tedarik-arastirma).
      // context_json çift tetik koruması + KPI raporlaması için kullanılır.
      const ins = await supabase
        .from('operations')
        .insert({
          owner_user_id:    r.owner_user_id,
          goal_text:        goalText,
          domain_pack:      DOMAIN_PACK,
          persona:          PERSONA,
          model:            MODEL,
          risk:             'R1',
          status:           'active',
          max_steps:        MAX_STEPS,
          cooldown_minutes: COOLDOWN_MINUTES,
          context_json: {
            stock_trigger_product:    r.product,
            reorder_quantity:         reorderQty,
            target_stock:             target,
            current_stock_at_trigger: Number(r.current_stock),
            first_playbook:           'tedarik-arastirma',
          },
          intent_json: {
            beneficiary:      'system/stock-monitor',
            success_criteria: `${r.product} stok seviyesini hedef eşiğin (${target}) üzerine çıkar`,
            forbidden_tools:  [],
          },
        })
        .select('id')
        .single()

      if (ins.error) throw ins.error

      fired++
      log('operasyon açıldı', {
        product:          r.product,
        current_stock:    Number(r.current_stock),
        reorder_quantity: reorderQty,
        operation_id:     ins.data?.id,
      })
    } catch (e) {
      log('operasyon açma hatası', { product: r.product, error: (e as Error).message })
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
