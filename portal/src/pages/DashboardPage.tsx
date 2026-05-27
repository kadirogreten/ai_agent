import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { motion, type Variants } from 'framer-motion'
import OnboardingCard from '@/components/OnboardingCard'
import {
  CheckCircle, XCircle, Clock, DollarSign,
  Zap, AlertTriangle, RefreshCw, ArrowRight,
  TrendingUp, Package, Brain,
} from 'lucide-react'

const KPI_COST_USD   = 0.40
const KPI_LATENCY_MS = 8 * 60_000
const KPI_FAIL_RATE  = 0.15

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

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 28 } },
}

function StatCard({
  label, value, sub, icon, accent, href,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  accent?: string
  href?: string
}) {
  const inner = (
    <motion.div variants={item} whileHover={{ y: -4, scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Card className="relative overflow-hidden p-4 transition-shadow hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {/* Subtle top gradient accent */}
        <div className="absolute inset-x-0 top-0 h-px opacity-60"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)' }}
        />
        <div className={`absolute right-3 top-3 rounded-xl p-2 ${accent ?? 'bg-white/[0.06]'}`}>
          {icon}
        </div>
        <div className="text-xs font-medium text-white/40 tracking-wide">{label}</div>
        <div className={`mt-2 text-2xl font-bold tracking-tight ${accent ? '' : 'text-white'}`}>
          {value}
        </div>
        {sub && <div className="mt-1.5 text-[11px] text-white/28">{sub}</div>}
      </Card>
    </motion.div>
  )
  return href ? <Link to={href}>{inner}</Link> : inner
}

function RunStatusDot({ status }: { status: RunRow['status'] }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
      </span>
    )
  }
  if (status === 'success') return <CheckCircle size={14} className="text-emerald-400 shrink-0" />
  return <XCircle size={14} className="text-red-400 shrink-0" />
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-24 animate-pulse bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="h-20 animate-pulse bg-white/[0.04]" />
        ))}
      </div>
    </div>
  )
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
      const [runsRes, bundlesRes, factsRes, jobsRes, approvalRes] = await Promise.all([
        supabase
          .from('runs')
          .select('id,external_id,title,status,cost_usd,latency_ms,verifier_outcome,created_at')
          .eq('owner_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('bundles').select('*', { count: 'exact', head: true }).eq('owner_user_id', uid),
        supabase.from('knowledge_facts').select('*', { count: 'exact', head: true }).eq('owner_user_id', uid),
        supabase
          .from('run_requests')
          .select('id,mode,status,request_text,created_at')
          .eq('owner_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase.from('approval_queue').select('*', { count: 'exact', head: true }).eq('owner_user_id', uid).eq('status', 'pending'),
      ])

      if (runsRes.error)    throw runsRes.error
      if (bundlesRes.error) throw bundlesRes.error
      if (factsRes.error)   throw factsRes.error
      if (jobsRes.error)    throw jobsRes.error

      const runs      = (runsRes.data ?? []) as RunRow[]
      const withCost  = runs.filter((r) => r.cost_usd != null)
      const withLat   = runs.filter((r) => r.latency_ms != null)
      const verRuns   = runs.filter((r) => r.verifier_outcome != null)
      const failCount = verRuns.filter((r) => r.verifier_outcome === 'fail').length

      setStats({
        totalRuns:        runs.length,
        successfulRuns:   runs.filter((r) => r.status === 'success').length,
        failedRuns:       runs.filter((r) => r.status === 'fail').length,
        totalBundles:     bundlesRes.count ?? 0,
        totalFacts:       factsRes.count   ?? 0,
        pendingApprovals: !approvalRes.error ? (approvalRes.count ?? 0) : 0,
        avgCostUsd:       withCost.length ? withCost.reduce((s, r) => s + (r.cost_usd ?? 0), 0) / withCost.length : null,
        avgLatencyMs:     withLat.length  ? withLat.reduce((s,  r) => s + (r.latency_ms ?? 0), 0) / withLat.length : null,
        verifierFailRate: verRuns.length  ? failCount / verRuns.length : null,
        recentRuns:       runs.slice(0, 5),
        recentJobs:       (jobsRes.data ?? []) as JobRow[],
      })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Veri yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  if (loading) return <Skeleton />

  if (!stats) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-white/40">
        {err && <p className="text-sm text-red-400">{err}</p>}
        <Button variant="outline" onClick={load}>Tekrar Dene</Button>
      </div>
    )
  }

  const successRate = stats.totalRuns > 0
    ? Math.round((stats.successfulRuns / stats.totalRuns) * 100)
    : 0

  return (
    <div className="space-y-6">
      <OnboardingCard />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Dashboard</h1>
          <p className="text-xs text-white/40">Hedefler: maliyet &lt;$0.40 · süre &lt;8 dk · Verifier FAIL &lt;%15</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:border-white/20 hover:text-white/80"
        >
          <RefreshCw size={12} />
          Yenile
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Ana sayaçlar */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label="Toplam Run"
          value={stats.totalRuns}
          sub={`${stats.successfulRuns} başarılı · ${stats.failedRuns} başarısız`}
          icon={<TrendingUp size={14} className="text-blue-400" />}
          accent="bg-blue-500/10"
          href="/app/runs"
        />
        <StatCard
          label="Başarı Oranı"
          value={`%${successRate}`}
          sub="Hedef: >%85"
          icon={<CheckCircle size={14} className={kpiColor(successRate / 100, 1, false)} />}
          accent="bg-emerald-500/10"
        />
        <StatCard
          label="Bundle / Fact"
          value={stats.totalBundles}
          sub={`${stats.totalFacts} knowledge fact`}
          icon={<Package size={14} className="text-purple-400" />}
          accent="bg-purple-500/10"
          href="/app/bundles"
        />
        <StatCard
          label="Bekleyen Onay"
          value={stats.pendingApprovals}
          sub="Approval kuyruğu →"
          icon={<AlertTriangle size={14} className={stats.pendingApprovals > 0 ? 'text-amber-400' : 'text-white/20'} />}
          accent={stats.pendingApprovals > 0 ? 'bg-amber-500/10' : 'bg-white/5'}
          href="/app/approval-queue"
        />
      </motion.div>

      {/* KPI kartları */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-3 sm:grid-cols-3"
      >
        <motion.div variants={item} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <Link to="/app/cost-ledger">
            <Card className="p-4 transition-all hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-2 text-xs font-medium text-white/40">
                <DollarSign size={12} />
                Ort. Maliyet / Run
              </div>
              {stats.avgCostUsd != null ? (
                <>
                  <div className={`mt-1.5 text-2xl font-bold font-mono ${kpiColor(stats.avgCostUsd, KPI_COST_USD)}`}>
                    ${stats.avgCostUsd.toFixed(4)}
                  </div>
                  <div className="mt-1 text-xs text-white/30">Hedef: &lt;${KPI_COST_USD}</div>
                </>
              ) : (
                <div className="mt-1.5 text-lg text-white/20">Veri yok</div>
              )}
            </Card>
          </Link>
        </motion.div>

        <motion.div variants={item} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <Link to="/app/cost-ledger">
            <Card className="p-4 transition-all hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-2 text-xs font-medium text-white/40">
                <Clock size={12} />
                Ort. Süre / Run
              </div>
              {stats.avgLatencyMs != null ? (
                <>
                  <div className={`mt-1.5 text-2xl font-bold ${kpiColor(stats.avgLatencyMs, KPI_LATENCY_MS)}`}>
                    {fmtMs(stats.avgLatencyMs)}
                  </div>
                  <div className="mt-1 text-xs text-white/30">Hedef: &lt;8 dk</div>
                </>
              ) : (
                <div className="mt-1.5 text-lg text-white/20">Veri yok</div>
              )}
            </Card>
          </Link>
        </motion.div>

        <motion.div variants={item} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <Link to="/app/cost-ledger">
            <Card className="p-4 transition-all hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-2 text-xs font-medium text-white/40">
                <Zap size={12} />
                Verifier FAIL
              </div>
              {stats.verifierFailRate != null ? (
                <>
                  <div className={`mt-1.5 text-2xl font-bold ${kpiColor(stats.verifierFailRate, KPI_FAIL_RATE)}`}>
                    %{Math.round(stats.verifierFailRate * 100)}
                  </div>
                  <div className="mt-1 text-xs text-white/30">Hedef: &lt;%15</div>
                </>
              ) : (
                <div className="mt-1.5 text-lg text-white/20">Veri yok</div>
              )}
            </Card>
          </Link>
        </motion.div>
      </motion.div>

      {/* Son aktivite */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className="grid gap-4 lg:grid-cols-2"
      >
        {/* Son Runlar */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-sm font-medium">Son Runlar</span>
            <Link to="/app/runs" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
              Tümü <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {stats.recentRuns.length === 0 ? (
              <EmptyFeed icon={<Brain size={20} />} text="Henüz run yok" />
            ) : (
              stats.recentRuns.map((run, i) => (
                <motion.div
                  key={run.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                >
                  <Link
                    to={`/app/runs/${run.id}`}
                    className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <RunStatusDot status={run.status} />
                      <span className="truncate text-sm text-white/70">
                        {run.title ?? run.external_id ?? run.id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      {run.cost_usd != null && (
                        <span className={`block font-mono text-xs ${kpiColor(run.cost_usd, KPI_COST_USD)}`}>
                          ${run.cost_usd.toFixed(4)}
                        </span>
                      )}
                      <span className="text-xs text-white/25">
                        {new Date(run.created_at).toLocaleDateString('tr-TR')}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))
            )}
          </div>
        </Card>

        {/* Son Joblar */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-sm font-medium">Son Joblar</span>
            <Link to="/app/jobs" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
              Tümü <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {stats.recentJobs.length === 0 ? (
              <EmptyFeed icon={<Zap size={20} />} text="Henüz job yok" />
            ) : (
              stats.recentJobs.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                >
                  <Link
                    to={`/app/jobs/${job.id}`}
                    className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                        {job.mode.toUpperCase()}
                      </Badge>
                      <span className="truncate text-sm text-white/60">
                        {job.request_text?.slice(0, 42) ?? '—'}
                      </span>
                    </div>
                    <Badge tone={job.status === 'success' ? 'green' : job.status === 'fail' ? 'red' : 'yellow'}>
                      {job.status}
                    </Badge>
                  </Link>
                </motion.div>
              ))
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  )
}

function EmptyFeed({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-white/20">
      {icon}
      <span className="text-xs">{text}</span>
    </div>
  )
}
