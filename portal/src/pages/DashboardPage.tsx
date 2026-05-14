import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

// Strateji §11.1 KPI hedefleri
const KPI_COST_USD   = 0.40   // P50 run başına
const KPI_LATENCY_MS = 8 * 60_000 // 8 dk P50
const KPI_FAIL_RATE  = 0.15   // Verifier FAIL <%15

type RunRow = {
  id: string
  external_id: string | null
  title: string | null
  status: 'running' | 'success' | 'fail'
  cost_usd: number | null
  latency_ms: number | null
  verifier_outcome: string | null
  created_at: string
}

type JobRow = {
  id: string
  mode: string
  status: 'pending' | 'running' | 'success' | 'fail'
  request_text: string | null
  created_at: string
}

type Stats = {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  totalBundles: number
  totalFacts: number
  pendingApprovals: number
  avgCostUsd: number | null
  avgLatencyMs: number | null
  verifierFailRate: number | null
  recentRuns: RunRow[]
  recentJobs: JobRow[]
}

function kpiColor(value: number, target: number, lowerIsBetter = true) {
  const r = value / target
  if (lowerIsBetter) {
    if (r <= 0.8) return 'text-emerald-400'
    if (r <= 1.0) return 'text-amber-400'
    return 'text-red-400'
  }
  if (r >= 1.0) return 'text-emerald-400'
  if (r >= 0.8) return 'text-amber-400'
  return 'text-red-400'
}

function fmtMs(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${(ms / 60_000).toFixed(1)} dk`
}

export default function DashboardPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [stats,   setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)

    try {
      const uid = user.id

      const [
        runsRes,
        bundlesRes,
        factsRes,
        jobsRes,
        approvalRes,
      ] = await Promise.all([
        supabase
          .from('runs')
          .select('id,external_id,title,status,cost_usd,latency_ms,verifier_outcome,created_at')
          .eq('owner_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('bundles')
          .select('*', { count: 'exact', head: true })
          .eq('owner_user_id', uid),
        supabase
          .from('knowledge_facts')
          .select('*', { count: 'exact', head: true })
          .eq('owner_user_id', uid),
        supabase
          .from('run_requests')
          .select('id,mode,status,request_text,created_at')
          .eq('owner_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('approval_queue')
          .select('*', { count: 'exact', head: true })
          .eq('owner_user_id', uid)
          .eq('status', 'pending'),
      ])

      if (runsRes.error)    throw runsRes.error
      if (bundlesRes.error) throw bundlesRes.error
      if (factsRes.error)   throw factsRes.error
      if (jobsRes.error)    throw jobsRes.error
      // approval_queue henüz yoksa hata görmezden gel

      const runs = (runsRes.data ?? []) as RunRow[]

      const withCost    = runs.filter((r) => r.cost_usd != null)
      const withLatency = runs.filter((r) => r.latency_ms != null)
      const verRuns     = runs.filter((r) => r.verifier_outcome != null)
      const failCount   = verRuns.filter((r) => r.verifier_outcome === 'fail').length

      setStats({
        totalRuns:       runs.length,
        successfulRuns:  runs.filter((r) => r.status === 'success').length,
        failedRuns:      runs.filter((r) => r.status === 'fail').length,
        totalBundles:    bundlesRes.count ?? 0,
        totalFacts:      factsRes.count   ?? 0,
        pendingApprovals: !approvalRes.error ? (approvalRes.count ?? 0) : 0,
        avgCostUsd:      withCost.length    ? withCost.reduce((s, r) => s + (r.cost_usd ?? 0), 0) / withCost.length : null,
        avgLatencyMs:    withLatency.length ? withLatency.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / withLatency.length : null,
        verifierFailRate: verRuns.length    ? failCount / verRuns.length : null,
        recentRuns:      runs.slice(0, 5),
        recentJobs:      (jobsRes.data ?? []) as JobRow[],
      })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Veri yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-400" />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="space-y-2 text-center text-sm text-white/50 py-12">
        {err && <p className="text-red-400">{err}</p>}
        <Button variant="outline" onClick={load}>Tekrar Dene</Button>
      </div>
    )
  }

  const successRate = stats.totalRuns > 0
    ? Math.round((stats.successfulRuns / stats.totalRuns) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">CEO Dashboard</div>
          <div className="text-xs text-white/50">AgentArmy genel görünüm — KPI hedefleri: maliyet &lt;$0.40, süre &lt;8 dk, Verifier FAIL &lt;%15</div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>Yenile</Button>
      </div>

      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      {/* Temel Sayaçlar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-white/50">Toplam Run</div>
          <div className="mt-1 text-2xl font-bold">{stats.totalRuns}</div>
          <div className="mt-1 text-xs text-white/40">{stats.successfulRuns} başarılı / {stats.failedRuns} başarısız</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-white/50">Başarı Oranı</div>
          <div className={`mt-1 text-2xl font-bold ${kpiColor(successRate / 100, 1, false)}`}>
            %{successRate}
          </div>
          <div className="mt-1 text-xs text-white/40">Hedef: &gt;%85</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-white/50">Bundle / Fact</div>
          <div className="mt-1 text-2xl font-bold">{stats.totalBundles}</div>
          <div className="mt-1 text-xs text-white/40">{stats.totalFacts} knowledge fact</div>
        </Card>

        <Link to="/app/approval-queue" className="block">
          <Card className={`p-4 transition-colors hover:bg-white/5 ${stats.pendingApprovals > 0 ? 'border-amber-500/30' : ''}`}>
            <div className="text-xs text-white/50">Bekleyen Onay</div>
            <div className={`mt-1 text-2xl font-bold ${stats.pendingApprovals > 0 ? 'text-amber-400' : 'text-white/30'}`}>
              {stats.pendingApprovals}
            </div>
            <div className="mt-1 text-xs text-white/40">R2/R3 onay kuyruğu →</div>
          </Card>
        </Link>
      </div>

      {/* KPI Kartları (Cost Ledger özet) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/app/cost-ledger" className="block">
          <Card className="p-4 transition-colors hover:bg-white/5">
            <div className="text-xs text-white/50">Ort. Maliyet / Run</div>
            {stats.avgCostUsd != null ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(stats.avgCostUsd, KPI_COST_USD)}`}>
                  ${stats.avgCostUsd.toFixed(4)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;${KPI_COST_USD} → Cost Ledger →</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok →</div>
            )}
          </Card>
        </Link>

        <Link to="/app/cost-ledger" className="block">
          <Card className="p-4 transition-colors hover:bg-white/5">
            <div className="text-xs text-white/50">Ort. Süre / Run</div>
            {stats.avgLatencyMs != null ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(stats.avgLatencyMs, KPI_LATENCY_MS)}`}>
                  {fmtMs(stats.avgLatencyMs)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;8 dk →</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok →</div>
            )}
          </Card>
        </Link>

        <Link to="/app/cost-ledger" className="block">
          <Card className="p-4 transition-colors hover:bg-white/5">
            <div className="text-xs text-white/50">Verifier FAIL</div>
            {stats.verifierFailRate != null ? (
              <>
                <div className={`mt-1 text-2xl font-bold ${kpiColor(stats.verifierFailRate, KPI_FAIL_RATE)}`}>
                  %{Math.round(stats.verifierFailRate * 100)}
                </div>
                <div className="mt-1 text-xs text-white/40">Hedef: &lt;%15 →</div>
              </>
            ) : (
              <div className="mt-1 text-xl text-white/30">Veri yok →</div>
            )}
          </Card>
        </Link>
      </div>

      {/* Son Aktivite */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Son Runlar */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-medium">Son Runlar</span>
            <Link to="/app/runs" className="text-xs text-blue-400 hover:underline">Tümü →</Link>
          </div>
          <div className="divide-y divide-white/5">
            {stats.recentRuns.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-white/40">Henüz run yok</div>
            ) : (
              stats.recentRuns.map((run) => (
                <Link key={run.id} to={`/app/runs/${run.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge tone={run.status === 'success' ? 'green' : run.status === 'fail' ? 'red' : 'yellow'}>
                      {run.status === 'success' ? '✓' : run.status === 'fail' ? '✗' : '⏳'}
                    </Badge>
                    <span className="text-sm truncate text-white/80">{run.title || run.external_id || run.id.slice(0, 8)}</span>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {run.cost_usd != null && (
                      <span className={`text-xs font-mono ${kpiColor(run.cost_usd, KPI_COST_USD)}`}>${run.cost_usd.toFixed(4)}</span>
                    )}
                    <div className="text-xs text-white/30">{new Date(run.created_at).toLocaleDateString('tr-TR')}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Son Joblar */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-medium">Son Joblar</span>
            <Link to="/app/jobs" className="text-xs text-blue-400 hover:underline">Tümü →</Link>
          </div>
          <div className="divide-y divide-white/5">
            {stats.recentJobs.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-white/40">Henüz job yok</div>
            ) : (
              stats.recentJobs.map((job) => (
                <Link key={job.id} to={`/app/jobs/${job.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                      {job.mode.toUpperCase()}
                    </Badge>
                    <span className="text-sm truncate text-white/70">
                      {job.request_text?.slice(0, 45) ?? '—'}
                    </span>
                  </div>
                  <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                    {job.status}
                  </Badge>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Hızlı Navigasyon */}
      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-3">Hızlı Erişim</div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/cost-ledger">
            <Button variant="outline" size="sm">Cost Ledger</Button>
          </Link>
          <Link to="/app/approval-queue">
            <Button variant={stats.pendingApprovals > 0 ? 'primary' : 'outline'} size="sm">
              Approval Queue {stats.pendingApprovals > 0 && `(${stats.pendingApprovals})`}
            </Button>
          </Link>
          <Link to="/app/agents">
            <Button variant="outline" size="sm">Agents</Button>
          </Link>
          <Link to="/app/bundles">
            <Button variant="outline" size="sm">Bundles</Button>
          </Link>
          <Link to="/app/facts">
            <Button variant="outline" size="sm">Knowledge Facts</Button>
          </Link>
          <Link to="/app/audit-log">
            <Button variant="outline" size="sm">Audit Log</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
