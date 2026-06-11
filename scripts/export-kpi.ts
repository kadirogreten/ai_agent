/**
 * Tedarik KPI ihracı — `docs/dogfood-tedarik-kpi.md`'ye satır ekler.
 *
 * Kullanım:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/export-kpi.ts <operation_id>
 *
 * Operasyonun kpi_summary event'ini okur; cost_ledger'dan toplam maliyet hesaplar;
 * docs/dogfood-tedarik-kpi.md'nin tablo bölümüne yeni satır append eder.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KPI_DOC   = resolve(__dirname, '../docs/dogfood-tedarik-kpi.md')

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  const operationId = process.argv[2]
  if (!operationId) {
    console.error('Kullanım: npx tsx scripts/export-kpi.ts <operation_id>')
    process.exit(1)
  }

  const supabase = getSupabase()

  // KPI summary event
  const { data: kpiEvent, error: kpiErr } = await supabase
    .from('operation_events')
    .select('payload, created_at')
    .eq('operation_id', operationId)
    .eq('kind', 'kpi_summary')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (kpiErr) throw kpiErr
  if (!kpiEvent) {
    console.error('KPI event bulunamadı. Operasyon henüz tamamlanmamış veya id yanlış.')
    process.exit(1)
  }

  const kpi = kpiEvent.payload as Record<string, unknown>

  // Toplam maliyet: bu operasyonun run'larına bağlı cost_ledger satırları
  const { data: runIds } = await supabase
    .from('run_requests')
    .select('id')
    .eq('operation_id', operationId)
  const ids = ((runIds ?? []) as { id: string }[]).map((r) => r.id)

  let totalCostTRY = 0
  if (ids.length > 0) {
    const { data: costs } = await supabase
      .from('cost_ledger')
      .select('amount_usd')
      .in('run_id', ids)
    totalCostTRY = ((costs ?? []) as { amount_usd: number }[])
      .reduce((sum, r) => sum + (r.amount_usd ?? 0), 0)
  }

  // Tablo satırı
  const product     = (kpi.context_json as Record<string, unknown> | null)?.stock_trigger_product as string ?? '—'
  const date        = new Date(kpi.completed_at as string).toLocaleDateString('tr-TR')
  const duration    = kpi.total_duration_min ?? '—'
  const ticks       = kpi.tick_count ?? '—'
  const humanTouch  = kpi.human_touch_count ?? '—'
  const errors      = kpi.error_count ?? '—'
  const steps       = `${kpi.step_count}/${kpi.max_steps}`
  const playbooks   = Array.isArray(kpi.playbooks_run) ? (kpi.playbooks_run as string[]).join(' → ') : '—'
  const cost        = totalCostTRY > 0 ? `$${totalCostTRY.toFixed(4)}` : '—'

  const row = `| ${date} | ${operationId.slice(0, 8)} | ${product} | ${duration} dk | ${ticks} | ${humanTouch} | ${errors} | ${steps} | ${playbooks} | ${cost} |`

  // Dosya oluştur/güncelle
  const header = `# Tedarik Dogfood KPI

> Otomatik: \`npx tsx scripts/export-kpi.ts <op-id>\` — operasyon kapanınca çalıştırın.

## Hedef
- Tek insan dokunuşu: PO onayı (human_touch_count = 1)
- Hata sayısı: 0 (temiz akış)
- Süre: operations cooldown'a bağlı (30 dk × adım sayısı)

## Sonuçlar

| Tarih | Op-ID | Ürün | Süre | Tick | İnsan | Hata | Adım | Playbook sırası | Maliyet |
|-------|-------|------|------|------|-------|------|------|-----------------|---------|
`

  let content: string
  if (!existsSync(KPI_DOC)) {
    content = header + row + '\n'
  } else {
    const existing = readFileSync(KPI_DOC, 'utf8')
    // Tablo sonuna ekle (son | satırından sonra)
    const lastPipe = existing.lastIndexOf('\n|')
    if (lastPipe >= 0) {
      content = existing.slice(0, lastPipe + 1) + existing.slice(lastPipe + 1).trimEnd() + '\n' + row + '\n'
    } else {
      content = existing.trimEnd() + '\n' + row + '\n'
    }
  }

  writeFileSync(KPI_DOC, content, 'utf8')
  console.log(`✓ KPI satırı eklendi → docs/dogfood-tedarik-kpi.md`)
  console.log(`  Ürün: ${product} | Süre: ${duration} dk | Tick: ${ticks} | İnsan: ${humanTouch} | Maliyet: ${cost}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
