import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

// Strateji §6.6: "Step başına metrik: tokens_in, tokens_out, latency_ms, model, cost_usd, verifier_outcome"
// Strateji §11.1 Ürün KPI hedefleri:
//   Verifier FAIL oranı < %15
//   Görev başına süre   < 8 dk (P50)
//   Görev başına maliyet < $0.40 (P50)

type RunCost = {
  id: string
  title: string | null
  external_id: string | null
  status: string
  model: string | null
  domain_pack: string | null
  risk_level: string | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  latency_ms: number | null
  verifier_outcome: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

type Summary = {
  totalRuns: number
  totalCostUsd: number
  totalTokensIn: number
  totalTokensOut: number
  avgLatencyMs: number | null
  verifierFailRate: number | null
  runsWithCost: number
}

const TARGET_COST_USD = 0.40
const TARGET_LATENCY_MS = 8 * 60 * 1000 // 8 dakika

function kpiColor(value: number, target: number, lowerIsBetter = true) {
  const ratio = value / target
  if (lowerIsBetter) {
    if (ratio <= 0.8) return 'text-emerald-400'
    if (ratio <= 1.0) return 'text-amber-400'
    return 'text-red-400'
  }
  if (ratio >= 1.0) return 'text-emerald-400'
  if (ratio >= 0.8) return 'text-amber-400'
  return 'text-red-400'
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${(ms / 60_000).toFixed(1)} dk`
}

function fmtCost(usd: number | null) {
  if (usd == null) return '—'
  return `$${usd.toFixed(4)}`
}

function verifierBadge(outcome: string | null) {
  if (!outcome) return <span className="text-white/30">—</span>
  const tone = outcome === 'pass' ? 'green' : outcome === 'fail' ? 'red' : 'yellow'
  return <Badge tone={tone}>{outcome.toUpperCase()}</Badge>
}

export default function CostLedgerPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows, setRows] = useState<RunCost[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('runs')
      .select('id,title,external_id,status,model,domain_pack,risk_level,tokens_in,tokens_out,cost_usd,latency_ms,verifier_outcome,started_at,finished_at,created_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) { setErr(error.message); setLoading(false); return }

    const r = (data ?? []) as RunCost[]
    setRows(r)

    const withCost = r.filter((x) => x.cost_usd != null)
    const withLatency = r.filter((x) => x.latency_ms != null)
    const verifierRuns = r.filter((x) => x.verifier_outcome != null)
    const failCount = verifierRuns.filter((x) => x.verifier_outcome === 'fail').length

    setSummary({
      totalRuns: r.length,
      runsWithCost: withCost.length,
      totalCostUsd: withCost.reduce((s, x) => s + (x.cost_usd ?? 0), 0),
      totalTokensIn: r.reduce((s, x) => s + (x.tokens_in ?? 0), 0),
      totalTokensOut: r.reduce((s, x) => s + (x.tokens_out ?? 0), 0),
      avgLatencyMs: withLatency.length
        ? withLatency.reduce((s, x) => s + (x.latency_ms ?? 0), 0) / withLatency.length
        : null,
      verifierFailRate: verifierRuns.length ? failCount / verifierRuns.length : null,
    })
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Cost Ledger</div>
          <div className="text-xs text-white/50">
            Run başına token / maliyet / süre — KPI hedefleri: maliyet &lt;$0.40, süre &lt;8 dk, Verifier FAIL &lt;%15
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>Yenile</Button>
      </div>

      {/* KPI Kartları */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-white/50">Toplam Maliyet</div>
            <div className="mt-1 text-2xl font-bold">${summary.totalCostUsd.toFixed(4)}</div>
            <div className="mt-1 text-xs text-white/40">{summary.runsWithCost} run kayıtlı</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-white/50">Ort. Maliyet / Run</div>
            {summary.runsWithCost > 0 ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(summary.totalCostUsd / summary.runsWithCost, TARGET_COST_USD)}`}>
                  {fmtCost(summary.totalCostUsd / summary.runsWithCost)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;${TARGET_COST_USD}</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok</div>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-xs text-white/50">Ort. Süre / Run</div>
            {summary.avgLatencyMs != null ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(summary.avgLatencyMs, TARGET_LATENCY_MS)}`}>
                  {fmtMs(summary.avgLatencyMs)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;8 dk</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok</div>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-xs text-white/50">Verifier FAIL oranı</div>
            {summary.verifierFailRate != null ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(summary.verifierFailRate, 0.15)}`}>
                  %{Math.round(summary.verifierFailRate * 100)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;%15</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok</div>
            )}
          </Card>
        </div>
      )}

      {/* Token Özeti */}
      {summary && (summary.totalTokensIn > 0 || summary.totalTokensOut > 0) && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Token Tüketimi</div>
          <div className="flex gap-6 text-sm">
            <div><span className="text-white/50">Giriş:</span> <span className="font-mono">{summary.totalTokensIn.toLocaleString()}</span></div>
            <div><span className="text-white/50">Çıkış:</span> <span className="font-mono">{summary.totalTokensOut.toLocaleString()}</span></div>
            <div><span className="text-white/50">Toplam:</span> <span className="font-mono">{(summary.totalTokensIn + summary.totalTokensOut).toLocaleString()}</span></div>
          </div>
        </Card>
      )}

      {/* Hata */}
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      {/* Run Tablosu */}
      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Run Detayları</div>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/50">
                <th className="px-4 py-2">Run</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Domain</th>
                <th className="px-4 py-2">Risk</th>
                <th className="px-4 py-2 text-right">Token (in/out)</th>
                <th className="px-4 py-2 text-right">Maliyet</th>
                <th className="px-4 py-2 text-right">Süre</th>
                <th className="px-4 py-2">Verifier</th>
                <th className="px-4 py-2">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-3 text-white/50" colSpan={9}>Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-3 text-white/50" colSpan={9}>Henüz run yok</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 text-xs">
                      <div className="font-medium text-white/90">{r.title?.slice(0, 30) ?? r.external_id ?? r.id.slice(0, 8)}</div>
                      <div className={`text-white/40 ${r.status === 'success' ? 'text-emerald-400/70' : r.status === 'fail' ? 'text-red-400/70' : ''}`}>{r.status}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-white/60">{r.model ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{r.domain_pack ?? '—'}</td>
                    <td className="px-4 py-2 text-xs font-mono text-white/60">{r.risk_level ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-white/70">
                      {r.tokens_in != null ? r.tokens_in.toLocaleString() : '—'} / {r.tokens_out != null ? r.tokens_out.toLocaleString() : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${r.cost_usd != null ? kpiColor(r.cost_usd, TARGET_COST_USD) : 'text-white/30'}`}>
                      {fmtCost(r.cost_usd)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${r.latency_ms != null ? kpiColor(r.latency_ms, TARGET_LATENCY_MS) : 'text-white/30'}`}>
                      {fmtMs(r.latency_ms)}
                    </td>
                    <td className="px-4 py-2">{verifierBadge(r.verifier_outcome)}</td>
                    <td className="px-4 py-2 text-xs text-white/40">{new Date(r.created_at).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
