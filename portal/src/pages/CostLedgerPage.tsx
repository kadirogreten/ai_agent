import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { DollarSign, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

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
  meta?: { eval?: boolean } | null
}

function isEvalRun(r: { meta?: { eval?: boolean } | null }) {
  return r.meta?.eval === true
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

type UsageCurrent = {
  period_month: string
  llm_cost_usd: number
  tokens_in: number
  tokens_out: number
  run_count: number
  unlimited: boolean
  budget_usd: number | null
  used_pct: number | null
  remaining_usd: number | null
  tone: 'ok' | 'amber' | 'red' | 'unlimited'
  alert_threshold_pct: number
}

type LlmMonthRow = {
  period_month: string
  domain_pack: string | null
  run_count: number
  llm_cost_usd: number
  tokens_in: number
  tokens_out: number
}

type AdsMonthRow = {
  period_month: string
  platform: string
  currency: string
  spent: number
  campaign_count: number
}

const TARGET_COST_USD   = 0.40
const TARGET_LATENCY_MS = 8 * 60 * 1000

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

function budgetBannerClass(tone: UsageCurrent['tone']) {
  if (tone === 'red') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (tone === 'amber') return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
  return 'border-white/10 bg-white/[0.03] text-white/70'
}

export default function CostLedgerPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows,    setRows]    = useState<RunCost[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [usageCurrent, setUsageCurrent] = useState<UsageCurrent | null>(null)
  const [llmMonths, setLlmMonths] = useState<LlmMonthRow[]>([])
  const [adsMonths, setAdsMonths] = useState<AdsMonthRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    const runsP = supabase
      .from('runs')
      .select('id,title,external_id,status,model,domain_pack,risk_level,tokens_in,tokens_out,cost_usd,latency_ms,verifier_outcome,started_at,finished_at,created_at,meta')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)

    const usageP = token
      ? Promise.all([
          fetch('/api/usage/current', {
            headers: { Authorization: `Bearer ${token}` },
          }).then(async (r) => {
            const j = await r.json()
            if (!r.ok) throw new Error(j.error ?? 'usage/current failed')
            return j as UsageCurrent
          }),
          fetch('/api/usage/summary?months=6', {
            headers: { Authorization: `Bearer ${token}` },
          }).then(async (r) => {
            const j = await r.json()
            if (!r.ok) throw new Error(j.error ?? 'usage/summary failed')
            return j as { llm: LlmMonthRow[]; ads: AdsMonthRow[] }
          }),
        ])
      : Promise.resolve(null)

    const [{ data, error }, usage] = await Promise.all([runsP, usageP])

    if (error) { setErr(error.message); setLoading(false); return }

    const r = ((data ?? []) as RunCost[]).filter((x) => !isEvalRun(x))
    setRows(r)

    const withCost    = r.filter((x) => x.cost_usd != null)
    const withLatency = r.filter((x) => x.latency_ms != null)
    const verifierRuns = r.filter((x) => x.verifier_outcome != null)
    const failCount   = verifierRuns.filter((x) => x.verifier_outcome === 'fail').length

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

    if (usage) {
      setUsageCurrent(usage[0])
      setLlmMonths(usage[1].llm ?? [])
      setAdsMonths(usage[1].ads ?? [])
    }

    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  const monthlyChart = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const row of llmMonths) {
      const k = row.period_month.slice(0, 7)
      byMonth.set(k, (byMonth.get(k) ?? 0) + Number(row.llm_cost_usd ?? 0))
    }
    const labels = [...byMonth.keys()].sort()
    return {
      labels,
      datasets: [{
        label: 'LLM maliyet (USD)',
        data: labels.map((l) => byMonth.get(l) ?? 0),
        backgroundColor: 'rgba(33, 150, 243, 0.65)',
        borderColor: 'rgba(33, 150, 243, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [llmMonths])

  const packBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of llmMonths) {
      const k = row.domain_pack ?? '(pack yok)'
      map.set(k, (map.get(k) ?? 0) + Number(row.llm_cost_usd ?? 0))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [llmMonths])

  const kpiCards = summary ? [
    {
      label: 'Toplam Maliyet',
      value: `$${summary.totalCostUsd.toFixed(4)}`,
      sub: `${summary.runsWithCost} run kayıtlı`,
      color: 'text-white/90',
    },
    {
      label: 'Ort. Maliyet / Run',
      value: summary.runsWithCost > 0 ? fmtCost(summary.totalCostUsd / summary.runsWithCost) : '—',
      sub: `Hedef: <$${TARGET_COST_USD}`,
      color: summary.runsWithCost > 0 ? kpiColor(summary.totalCostUsd / summary.runsWithCost, TARGET_COST_USD) : 'text-white/30',
    },
    {
      label: 'Ort. Süre / Run',
      value: fmtMs(summary.avgLatencyMs),
      sub: 'Hedef: <8 dk',
      color: summary.avgLatencyMs != null ? kpiColor(summary.avgLatencyMs, TARGET_LATENCY_MS) : 'text-white/30',
    },
    {
      label: 'Verifier FAIL',
      value: summary.verifierFailRate != null ? `%${Math.round(summary.verifierFailRate * 100)}` : '—',
      sub: 'Hedef: <%15',
      color: summary.verifierFailRate != null ? kpiColor(summary.verifierFailRate, 0.15) : 'text-white/30',
    },
  ] : []

  const columns: Column<RunCost>[] = [
    {
      key: 'title', header: 'Run',
      render: (r) => (
        <div>
          <div className="font-medium text-white/80 text-xs">{r.title?.slice(0, 30) ?? r.external_id ?? r.id.slice(0, 8)}</div>
          <div className={`text-xs mt-0.5 ${r.status === 'success' ? 'text-emerald-400/70' : r.status === 'fail' ? 'text-red-400/70' : 'text-white/40'}`}>
            {r.status}
          </div>
        </div>
      ),
    },
    {
      key: 'model', header: 'Model', width: '120px',
      render: (r) => <span className="font-mono text-xs text-white/50">{r.model ?? '—'}</span>,
    },
    {
      key: 'domain_pack', header: 'Domain', width: '120px',
      render: (r) => <span className="text-xs text-white/50">{r.domain_pack ?? '—'}</span>,
    },
    {
      key: 'cost_usd', header: 'Maliyet', width: '90px',
      render: (r) => (
        <span className={`font-mono text-xs ${r.cost_usd != null ? kpiColor(r.cost_usd, TARGET_COST_USD) : 'text-white/30'}`}>
          {fmtCost(r.cost_usd)}
        </span>
      ),
    },
    {
      key: 'latency_ms', header: 'Süre', width: '80px',
      render: (r) => (
        <span className={`font-mono text-xs ${r.latency_ms != null ? kpiColor(r.latency_ms, TARGET_LATENCY_MS) : 'text-white/30'}`}>
          {fmtMs(r.latency_ms)}
        </span>
      ),
    },
    {
      key: 'tokens_in', header: 'Tokenlar', width: '120px',
      render: (r) => (
        <span className="font-mono text-xs text-white/40">
          {r.tokens_in != null ? r.tokens_in.toLocaleString() : '—'} / {r.tokens_out != null ? r.tokens_out.toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'verifier_outcome', header: 'Verifier', width: '90px',
      render: (r) => {
        if (!r.verifier_outcome) return <span className="text-white/25">—</span>
        const tone = r.verifier_outcome === 'pass' ? 'green' : r.verifier_outcome === 'fail' ? 'red' : 'yellow'
        return <Badge tone={tone}>{r.verifier_outcome.toUpperCase()}</Badge>
      },
    },
    {
      key: 'created_at', header: 'Tarih', width: '100px',
      render: (r) => <span className="text-xs text-white/30">{new Date(r.created_at).toLocaleDateString('tr-TR')}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cost Ledger"
        description="Run başına token / maliyet / süre — KPI: <$0.40, <8 dk, FAIL <%15"
        actions={
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors disabled:opacity-50">
            <RefreshCw size={12} /> Yenile
          </button>
        }
      />

      {/* D4d — Aylık kullanım */}
      <Card className="p-4 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-widest text-white/30">Aylık Kullanım</div>

        {usageCurrent && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${budgetBannerClass(usageCurrent.tone)}`}>
            <div className="font-medium">Bu ay (LLM, USD)</div>
            <div className="mt-1 flex flex-wrap gap-4 font-mono text-xs">
              <span>Harcanan: ${usageCurrent.llm_cost_usd.toFixed(4)}</span>
              <span>
                Bütçe:{' '}
                {usageCurrent.unlimited
                  ? 'limitsiz'
                  : `$${(usageCurrent.budget_usd ?? 0).toFixed(2)}`}
              </span>
              {!usageCurrent.unlimited && (
                <>
                  <span>Kalan: ${(usageCurrent.remaining_usd ?? 0).toFixed(4)}</span>
                  <span>%{(usageCurrent.used_pct ?? 0).toFixed(0)} kullanıldı</span>
                </>
              )}
              <span>{usageCurrent.run_count} run · {usageCurrent.tokens_in + usageCurrent.tokens_out} token</span>
            </div>
            <div className="mt-1 text-[11px] opacity-70">
              Eval koşumları özete dahil edilmez. Soft uyarı eşiği %{usageCurrent.alert_threshold_pct}.
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-h-[220px]">
            <div className="mb-2 text-xs text-white/40">Son 6 ay LLM maliyeti (USD)</div>
            {monthlyChart.labels.length > 0 ? (
              <Bar
                data={monthlyChart}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { display: false },
                    title: { display: false },
                  },
                  scales: {
                    x: { ticks: { color: 'rgba(255,255,255,0.45)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: 'rgba(255,255,255,0.45)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true },
                  },
                }}
              />
            ) : (
              <p className="text-xs text-white/35">Henüz aylık LLM verisi yok.</p>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs text-white/40">Pack kırılımı (USD)</div>
            <ul className="space-y-1.5">
              {packBreakdown.map(([pack, cost]) => (
                <li key={pack} className="flex justify-between text-xs border-b border-white/[0.05] py-1">
                  <span className="text-white/70 truncate mr-2">{pack}</span>
                  <span className="font-mono text-white/50">${cost.toFixed(4)}</span>
                </li>
              ))}
              {packBreakdown.length === 0 && (
                <li className="text-xs text-white/35">Pack kırılımı yok.</li>
              )}
            </ul>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-white/40">Reklam harcaması (LLM ile toplanmaz)</div>
          {adsMonths.length === 0 ? (
            <p className="text-xs text-white/35">Reklam kaydı yok.</p>
          ) : (
            <ul className="space-y-1.5">
              {adsMonths.map((a, i) => (
                <li key={`${a.period_month}-${a.platform}-${a.currency}-${i}`} className="flex justify-between text-xs border-b border-white/[0.05] py-1">
                  <span className="text-white/70">
                    {a.period_month.slice(0, 7)} · {a.platform}
                  </span>
                  <span className="font-mono text-white/50">
                    {a.spent.toFixed(2)} {a.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {kpiCards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="p-4">
                <div className="text-xs text-white/40">{k.label}</div>
                <div className={`mt-1 text-2xl font-bold ${k.color}`}>{k.value}</div>
                <div className="mt-0.5 text-xs text-white/30">{k.sub}</div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {summary && (summary.totalTokensIn > 0 || summary.totalTokensOut > 0) && (
        <Card className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/30">Token Tüketimi</div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-white/40">Giriş:</span> <span className="font-mono text-white/70">{summary.totalTokensIn.toLocaleString()}</span></div>
            <div><span className="text-white/40">Çıkış:</span> <span className="font-mono text-white/70">{summary.totalTokensOut.toLocaleString()}</span></div>
            <div><span className="text-white/40">Toplam:</span> <span className="font-mono text-white/70">{(summary.totalTokensIn + summary.totalTokensOut).toLocaleString()}</span></div>
          </div>
        </Card>
      )}

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
          {rows.length} run
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          empty={<EmptyState icon={<DollarSign size={24} />} title="Henüz run yok" />}
        />
      </Card>
    </div>
  )
}
