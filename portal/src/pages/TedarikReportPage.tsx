import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { motion } from 'framer-motion'
import { PackageSearch } from 'lucide-react'
import { fetchTedarikReport, decideApproval, fetchApprovalSteps, type TedarikReport, type ApprovalStep } from '@/lib/tedarikReport'

type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'gray'

function statusTone(s: string): Tone {
  const v = (s || '').toLowerCase()
  if (['success', 'succeeded', 'approved'].includes(v)) return 'green'
  if (['fail', 'failed', 'blocked', 'rejected'].includes(v)) return 'red'
  if (['waiting_approval', 'pending', 'running'].includes(v)) return 'yellow'
  return 'gray'
}

function fmtMoney(v: number | null, cur: string | null): string {
  if (v == null) return '—'
  return `${v.toLocaleString('tr-TR')} ${cur ?? 'TRY'}`
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('tr-TR')
}

const SectionHead = ({ children }: { children: React.ReactNode }) => (
  <div className="border-b border-white/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-white/30">
    {children}
  </div>
)

export default function TedarikReportPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [data,    setData]    = useState<TedarikReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [acting,  setActing]  = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [stepsCache, setStepsCache] = useState<Record<string, ApprovalStep[]>>({})

  async function toggleSteps(approvalId: string, runId: string | null) {
    if (expandedId === approvalId) { setExpandedId(null); return }
    setExpandedId(approvalId)
    if (runId && !stepsCache[approvalId]) {
      const steps = await fetchApprovalSteps(runId)
      setStepsCache((prev) => ({ ...prev, [approvalId]: steps }))
    }
  }

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setData(await fetchTedarikReport())
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  // Canlı: açıkken 10 sn'de bir sessizce yenile.
  useEffect(() => {
    if (!autoRefresh || !initialized || !user) return
    const t = setInterval(() => { fetchTedarikReport().then(setData) }, 10000)
    return () => clearInterval(t)
  }, [autoRefresh, initialized, user])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setActing(id)
    await decideApproval(id, decision)
    await load()
    setActing(null)
  }

  const triggers = data?.triggers ?? []
  const orders   = data?.orders ?? []
  const cargo    = data?.cargo ?? []
  const pending  = data?.pendingApprovals ?? []

  const placed = orders.filter((o) => o.status === 'succeeded')
  const spend  = placed.reduce((acc, o) => acc + (o.total ?? 0), 0)

  const kpis = [
    { label: 'Stok Tetikleri', value: triggers.length, color: 'text-white/90' },
    { label: 'Bekleyen Onay', value: pending.length, color: pending.length > 0 ? 'text-amber-400' : 'text-white/50' },
    { label: 'Geçen Sipariş', value: placed.length, color: 'text-emerald-400' },
    { label: 'Toplam Harcama', value: fmtMoney(spend, 'TRY'), color: 'text-blue-400' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tedarik Raporu"
        description="Stok tetikleri → öneri → onaylı sipariş → kargo — uçtan uca tedarik akışı"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                autoRefresh
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/[0.04] text-white/50'
              }`}
              title="10 sn'de bir otomatik yenile"
            >
              {autoRefresh ? '● Canlı' : 'Canlı kapalı'}
            </button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>Yenile</Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-4">
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-white/40">{k.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {data?.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{data.error}</div>
      )}

      {loading && !data ? (
        <div className="py-12 text-center text-sm text-white/40">Yükleniyor…</div>
      ) : (
        <>
          {/* Bekleyen onaylar */}
          {pending.length > 0 && (
            <Card className="overflow-hidden border border-amber-500/20">
              <SectionHead>Bekleyen satın alma onayları</SectionHead>
              <div className="divide-y divide-white/[0.06]">
                {pending.map((p) => {
                  const a = p.args ?? {}
                  const qty = typeof a.quantity === 'number' ? a.quantity : null
                  const unit = typeof a.unit_price === 'number' ? a.unit_price : null
                  const total = qty != null && unit != null ? qty * unit : null
                  const cur = typeof a.currency === 'string' ? a.currency : 'TRY'
                  const steps = stepsCache[p.id]
                  return (
                    <div key={p.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-white/50">tool:purchase_order</span>
                          {p.risk_level && <Badge tone="red">{p.risk_level}</Badge>}
                          <span className="text-xs text-white/30">{fmtDate(p.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => decide(p.id, 'approved')} disabled={acting === p.id}>
                            {acting === p.id ? '…' : 'Onayla'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => decide(p.id, 'rejected')} disabled={acting === p.id}>
                            Reddet
                          </Button>
                        </div>
                      </div>

                      {/* Sipariş özeti — onaylanacak somut karar */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-white/80">
                        <span className="font-medium">{typeof a.product === 'string' ? a.product : '—'}</span>
                        {qty != null && <span>{qty.toLocaleString('tr-TR')} adet</span>}
                        {typeof a.supplier === 'string' && <span>· {a.supplier}</span>}
                        {unit != null && <span className="text-white/50">{unit} {cur}/adet</span>}
                        {total != null && <span className="font-semibold text-emerald-300">Toplam {total.toLocaleString('tr-TR')} {cur}</span>}
                      </div>

                      {/* Ürün detayı: marka/model/kod/özellik + gerçek link */}
                      {(typeof a.brand === 'string' || typeof a.model === 'string' || typeof a.product_code === 'string' || typeof a.specs === 'string') && (
                        <div className="mt-1 space-y-0.5 text-xs text-white/55">
                          {(typeof a.brand === 'string' || typeof a.model === 'string') && (
                            <div>
                              <span className="text-white/35">Model: </span>
                              {[typeof a.brand === 'string' ? a.brand : '', typeof a.model === 'string' ? a.model : ''].filter(Boolean).join(' ')}
                            </div>
                          )}
                          {typeof a.product_code === 'string' && a.product_code && (
                            <div><span className="text-white/35">Ürün kodu: </span><span className="font-mono">{a.product_code}</span></div>
                          )}
                          {typeof a.specs === 'string' && a.specs && (
                            <div><span className="text-white/35">Özellikler: </span>{a.specs}</div>
                          )}
                        </div>
                      )}
                      {typeof a.product_url === 'string' && a.product_url && (
                        <a href={a.product_url} target="_blank" rel="noreferrer"
                          className="mt-1 inline-block text-xs text-blue-300 underline decoration-dotted hover:text-blue-200">
                          Ürün sayfası ↗
                        </a>
                      )}
                      {typeof a.note === 'string' && a.note && (
                        <div className="mt-0.5 text-xs text-white/40">{a.note}</div>
                      )}

                      {/* Gerekçe: araştırma + tedarikçi karşılaştırması (run adım çıktıları) */}
                      <button
                        type="button"
                        onClick={() => toggleSteps(p.id, p.run_id)}
                        className="mt-2 text-xs text-blue-300 hover:text-blue-200"
                      >
                        {expandedId === p.id ? '▾ Gerekçeyi gizle' : '▸ Gerekçe & tedarikçi karşılaştırması'}
                      </button>
                      {expandedId === p.id && (
                        <div className="mt-2 space-y-2 rounded-lg border border-white/[0.06] bg-black/20 p-3">
                          {!p.run_id ? (
                            <div className="text-xs text-white/30">Bu onaya bağlı run bulunamadı.</div>
                          ) : steps === undefined ? (
                            <div className="text-xs text-white/30">Yükleniyor…</div>
                          ) : steps.length === 0 ? (
                            <div className="text-xs text-white/30">Adım çıktısı bulunamadı.</div>
                          ) : (
                            steps.map((s, i) => (
                              <div key={i}>
                                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">{s.agent}</div>
                                <pre className="whitespace-pre-wrap break-words text-xs text-white/70">{s.content}</pre>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Stok tetikleri / araştırma */}
          <Card className="overflow-hidden">
            <SectionHead>Stok tetikleri & araştırma</SectionHead>
            {triggers.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-white/30">Henüz stok tetikli araştırma yok.</div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {triggers.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="max-w-[28rem] truncate text-sm font-medium text-white/90">{t.product}</span>
                        {t.current_stock != null ? (
                          <Badge tone="red">stok {t.current_stock} / eşik {t.threshold ?? '—'}</Badge>
                        ) : (
                          <Badge tone="gray">manuel araştırma</Badge>
                        )}
                        {t.reorder_quantity != null && <span className="text-xs text-white/40">öneri {t.reorder_quantity} adet</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-white/30">{fmtDate(t.created_at)}</div>
                    </div>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Siparişler */}
          <Card className="overflow-hidden">
            <SectionHead>Satın alma siparişleri</SectionHead>
            {orders.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-white/30">Henüz sipariş yok.</div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-white/70">{o.order_id ?? '—'}</span>
                        <span className="text-sm text-white/90">{o.product ?? '—'}</span>
                        {o.quantity != null && <span className="text-xs text-white/40">×{o.quantity}</span>}
                        {o.supplier && <span className="text-xs text-white/40">· {o.supplier}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-white/30">
                        <span>{fmtMoney(o.total, o.currency)}</span>
                        {o.tracking_number && <span className="font-mono">takip: {o.tracking_number}</span>}
                        {o.carrier && <span>{o.carrier}</span>}
                        {o.estimated_delivery && <span>teslim ~{o.estimated_delivery}</span>}
                      </div>
                    </div>
                    <Badge tone={statusTone(o.status)}>{o.status === 'succeeded' ? 'sipariş geçti' : o.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Kargo */}
          <Card className="overflow-hidden">
            <SectionHead>Kargo takibi</SectionHead>
            {cargo.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-white/30">Henüz kargo kaydı yok.</div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {cargo.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-white/70">{c.tracking_number ?? '—'}</span>
                        {c.carrier && <span className="text-xs text-white/40">{c.carrier}</span>}
                        {c.estimated_delivery && <span className="text-xs text-white/30">teslim ~{c.estimated_delivery}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-white/30">{fmtDate(c.created_at)}</div>
                    </div>
                    <Badge tone="blue">{c.status ?? '—'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {triggers.length === 0 && orders.length === 0 && cargo.length === 0 && (
            <div className="py-8 text-center">
              <PackageSearch size={24} className="mx-auto mb-2 text-white/20" />
              <p className="text-sm text-white/40">Henüz tedarik aktivitesi yok. Stok ekle, araştırma + satın alma çalıştır.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
