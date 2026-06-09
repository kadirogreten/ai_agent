import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { Boxes, Pencil, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  listStock,
  createStock,
  updateStock,
  toggleStock,
  deleteStock,
  type StockRow,
  type UpsertStockInput,
} from '@/lib/stock'

const EMPTY_FORM: UpsertStockInput = {
  product: '',
  sku: '',
  current_stock: 0,
  threshold: 10,
  target_stock: 1000,
  warehouse: '',
  enabled: true,
}

const inputCls =
  'w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60'

export default function StockPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows,    setRows]    = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form,      setForm]      = useState<UpsertStockInput>(EMPTY_FORM)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
    const { data, error } = await listStock()
    if (error) setErr(error)
    else setRows(data)
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function startEdit(r: StockRow) {
    setEditingId(r.id)
    setForm({
      product: r.product,
      sku: r.sku ?? '',
      current_stock: r.current_stock,
      threshold: r.threshold,
      target_stock: r.target_stock,
      warehouse: r.warehouse ?? '',
      enabled: r.enabled,
    })
  }

  async function save() {
    if (!form.product.trim()) { setErr('Ürün adı zorunlu'); return }
    setBusy(true); setErr(null)
    const res = editingId
      ? await updateStock(editingId, form)
      : await createStock(form)
    if ('error' in res && res.error) setErr(res.error)
    else { resetForm(); await load() }
    setBusy(false)
  }

  async function onToggle(r: StockRow) {
    setBusy(true)
    const res = await toggleStock(r.id, !r.enabled)
    if (res.error) setErr(res.error)
    else setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))
    setBusy(false)
  }

  async function onDelete(r: StockRow) {
    if (!window.confirm(`"${r.product}" stok satırı silinsin mi?`)) return
    setBusy(true)
    const res = await deleteStock(r.id)
    if (res.error) setErr(res.error)
    else { if (editingId === r.id) resetForm(); await load() }
    setBusy(false)
  }

  const belowCount   = rows.filter((r) => r.enabled && r.current_stock <= r.threshold).length
  const watchedCount = rows.filter((r) => r.enabled).length

  const kpiCards = [
    { label: 'Toplam Ürün', value: rows.length, color: 'text-white/90' },
    { label: 'İzlenen', value: watchedCount, color: 'text-blue-400' },
    { label: 'Eşik Altı', value: belowCount, color: belowCount > 0 ? 'text-red-400' : 'text-emerald-400' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stok"
        description="Ürün stok seviyeleri — eşik altına düşen ürünler tedarik araştırmasını tetikler"
        actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}>Yenile</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {kpiCards.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-4">
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-white/40">{k.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>
      )}

      {/* Ekle / Düzenle formu */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
          {editingId ? 'Ürünü düzenle' : 'Yeni ürün ekle'}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-white/40">Ürün adı *</span>
            <input className={inputCls} value={form.product}
              onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} placeholder="kırmızı kalem" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/40">SKU</span>
            <input className={inputCls} value={form.sku ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="KIR-0001" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/40">Depo</span>
            <input className={inputCls} value={form.warehouse ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))} placeholder="Merkez Depo" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/40">Mevcut stok</span>
            <input type="number" className={inputCls} value={form.current_stock}
              onChange={(e) => setForm((f) => ({ ...f, current_stock: Number(e.target.value) }))} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/40">Eşik</span>
            <input type="number" className={inputCls} value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/40">Hedef stok</span>
            <input type="number" className={inputCls} value={form.target_stock ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, target_stock: Number(e.target.value) }))} />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>{editingId ? 'Kaydet' : 'Ekle'}</Button>
          {editingId && <Button variant="outline" size="sm" onClick={resetForm} disabled={busy}>Vazgeç</Button>}
        </div>
      </Card>

      {/* Liste */}
      {loading ? (
        <div className="py-12 text-center text-sm text-white/40">Yükleniyor…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center">
          <Boxes size={24} className="mx-auto mb-2 text-white/20" />
          <p className="text-sm text-white/40">Henüz stok kaydı yok. Yukarıdan ürün ekleyin.</p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-white/[0.06]">
            {rows.map((r) => {
              const below = r.enabled && r.current_stock <= r.threshold
              return (
                <div key={r.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${r.enabled ? '' : 'opacity-50'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white/90">{r.product}</span>
                      {r.sku && <span className="font-mono text-xs text-white/30">{r.sku}</span>}
                      <Badge tone={below ? 'red' : 'green'}>
                        stok {r.current_stock} / eşik {r.threshold}
                      </Badge>
                      {r.target_stock > 0 && <span className="text-xs text-white/30">hedef {r.target_stock}</span>}
                      {below && <Badge tone="red">eşik altı</Badge>}
                      {r.source !== 'manual' && <Badge tone="blue">{r.source}</Badge>}
                    </div>
                    {r.warehouse && <div className="mt-0.5 text-xs text-white/40">{r.warehouse}</div>}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggle(r)}
                      disabled={busy}
                      title={r.enabled ? 'İzlemeyi durdur' : 'İzlemeyi aç'}
                      role="switch"
                      aria-checked={r.enabled}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${r.enabled ? 'bg-emerald-500' : 'bg-white/20'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${r.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <button type="button" onClick={() => startEdit(r)} title="Düzenle" className="text-white/40 hover:text-white/80">
                      <Pencil size={15} />
                    </button>
                    <button type="button" onClick={() => onDelete(r)} title="Sil" className="text-white/40 hover:text-red-400">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card className="border border-white/[0.06] p-4">
        <div className="text-xs text-white/40">
          Eşik altına düşen <span className="text-white/60">izlenen</span> ürünler için stok izleyici
          (cron) otomatik tedarik araştırması başlatır. Satın alma R3 — onay kuyruğuna düşer.
        </div>
      </Card>
    </div>
  )
}
