import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import Office3DScene from '@/components/Office3DScene'
import type { OfficeCameraControls } from '@/hooks/useOfficeCamera'
import OfficeGeometry from '@/components/office/OfficeGeometry'
import OfficeAssets from '@/components/office/OfficeAssets'
import { useOfficeSimulation } from '@/hooks/useOfficeSimulation'
import { supabase } from '@/lib/supabaseClient'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Activity, Users, Cpu, Zap, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import * as THREE from 'three'

type Agent     = { id: string; name: string | null; code: string | null; role: string | null }
type Run       = { id: string; status: string; created_at: string }
type Job       = { id: string; agent_id: string | null; status: string; created_at: string }
type Operation = { id: string; goal_text: string; status: string; step_count: number; max_steps: number }
export type StepEvent = { agentId: string; createdAt: string }

async function fetchPendingApprovalCount(userId: string): Promise<number> {
  const { data } = await supabase
    .from('approval_queue')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('status', 'pending')
  return (data ?? []).length
}

const ROLE_COLORS: Record<string, string> = {
  research:     '#3b82f6',
  analysis:     '#8b5cf6',
  writing:      '#06b6d4',
  code:         '#10b981',
  verification: '#f59e0b',
  operation:    '#ef4444',
  contrarian:   '#f97316',
  design:       '#ec4899',
  editing:      '#84cc16',
}

function StatusDot({ status }: { status: string }) {
  if (status === 'running') return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
    </span>
  )
  if (status === 'success' || status === 'completed') return <CheckCircle2 size={12} className="text-emerald-400" />
  if (status === 'fail'    || status === 'failed')    return <AlertCircle  size={12} className="text-red-400" />
  return <Clock size={12} className="text-amber-400" />
}

export default function OfficePage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [scene,                setScene]               = useState<THREE.Scene | null>(null)
  const [agents,               setAgents]              = useState<Agent[]>([])
  const [runs,                 setRuns]                = useState<Run[]>([])
  const [jobs,                 setJobs]                = useState<Job[]>([])
  const [operations,           setOperations]          = useState<Operation[]>([])
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0)
  const [stepEvents,           setStepEvents]          = useState<StepEvent[]>([])
  const [err,                  setErr]                 = useState<string | null>(null)
  const [panel,                setPanel]               = useState<'agents' | 'jobs' | 'ops'>('agents')
  const [camControls,          setCamControls]         = useState<OfficeCameraControls | null>(null)

  const { agents: officeAgents, moveAgentToCeoZone, returnAgentToDesk, updateAgentStatus } =
    useOfficeSimulation({ scene, dbAgents: agents, stepEvents })

  useEffect(() => { init() }, [init])

  // run_events polling — step_start events last 15 min, yalnız initialized iken
  useEffect(() => {
    if (!initialized || !user) return
    const poll = async () => {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('run_events')
        .select('payload, created_at')
        .eq('event_type', 'step_start')
        .gt('created_at', cutoff)
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30)
      if (data && data.length > 0) {
        setStepEvents(
          (data as Array<{ payload: Record<string, string>; created_at: string }>).map((e) => ({
            agentId:   e.payload.agent ?? '',
            createdAt: e.created_at,
          }))
        )
      }
    }
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [initialized, user])

  // Job-driven agent animation
  useEffect(() => {
    if (!moveAgentToCeoZone || !returnAgentToDesk || !updateAgentStatus) return
    jobs.forEach((job) => {
      if (!job.agent_id) return
      const deskIdx = agents.findIndex((a) => a.id === job.agent_id)
      if (deskIdx < 0) return
      if (job.status === 'running' || job.status === 'pending') {
        moveAgentToCeoZone(job.agent_id)
        updateAgentStatus(job.agent_id, job.status)
      } else {
        returnAgentToDesk(job.agent_id, deskIdx)
        updateAgentStatus(job.agent_id, job.status)
      }
    })
  }, [jobs, agents, moveAgentToCeoZone, returnAgentToDesk, updateAgentStatus])

  // Data load
  useEffect(() => {
    const load = async () => {
      if (!initialized || !user) return
      try {
        const [{ data: agentsData }, { data: runsData }, { data: opsData }, pending] = await Promise.all([
          supabase.from('agents').select('id,name,code,role').limit(20),
          supabase.from('runs').select('id,status,created_at').order('created_at', { ascending: false }).limit(10),
          supabase
            .from('operations')
            .select('id, goal_text, status, step_count, max_steps')
            .in('status', ['active', 'escalated'])
            .order('created_at', { ascending: false })
            .limit(20),
          fetchPendingApprovalCount(user.id),
        ])
        setAgents((agentsData ?? []) as Agent[])
        setRuns((runsData ?? []) as Run[])
        setOperations((opsData ?? []) as Operation[])
        setPendingApprovalCount(pending)
        setJobs(
          (runsData ?? []).map((r) => {
            const row = r as Record<string, unknown>
            return {
              id:         String(row.id ?? ''),
              agent_id:   null,
              status:     String(row.status ?? ''),
              created_at: String(row.created_at ?? ''),
            }
          })
        )
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : 'Load error')
      }
    }
    load()
  }, [initialized, user])

  const activeJobs    = jobs.filter((j) => j.status === 'running').length
  const completedJobs = jobs.filter((j) => j.status === 'success' || j.status === 'completed').length
  // R5.2: CEO tespiti rol + kod + ad üzerinden (rol seçeneklerinde 'ceo' yok — form kısıtı)
  const isCeoAgent    = (a: Agent) =>
    a.role?.toLowerCase() === 'ceo' || a.code?.toUpperCase() === 'CEO' || a.name?.toUpperCase() === 'CEO'
  const nonCeoAgents  = agents.filter((a) => !isCeoAgent(a))
  const deskCount     = nonCeoAgents.length || 5

  // Desk indices with running jobs (maps agent position in list → desk index)
  const runningDeskIndices = agents
    .map((a, idx) => ({ idx, running: jobs.some((j) => j.agent_id === a.id && j.status === 'running') }))
    .filter((x) => x.running)
    .map((x) => x.idx)

  const hasEscalation = operations.some((o) => o.status === 'escalated')

  return (
    <div className="relative h-[calc(100vh-3rem)] overflow-hidden rounded-2xl">

      {/* ── 3D Canvas (full bleed) ─────────────────────────────────── */}
      <div className="absolute inset-0">
        <Office3DScene onSceneReady={setScene} onCameraControls={setCamControls}>
          {scene && (
            <>
              <OfficeGeometry
                scene={scene}
                deskCount={deskCount}
                runningDeskIndices={runningDeskIndices}
                pendingApprovalCount={pendingApprovalCount}
                totalOps={operations.length}
                hasEscalation={hasEscalation}
              />
              <OfficeAssets scene={scene} deskCount={deskCount} />
            </>
          )}
        </Office3DScene>
      </div>

      {/* ── Top bar overlay ────────────────────────────────────────── */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(4,8,15,0.85) 0%, transparent 100%)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(37,99,235,0.15))',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.3), 0 4px 12px rgba(59,130,246,0.2)',
            }}
          >
            <Bot size={15} className="text-blue-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">3D Office</div>
            <div className="text-[10px] text-white/40">Agent workflow visualization</div>
          </div>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-emerald-400">LIVE</span>
        </div>
      </div>

      {/* ── KPI bar overlay (bottom-left) ─────────────────────────── */}
      <div className="absolute bottom-5 left-5 flex gap-2">
        {[
          { label: 'Agents',  value: agents.length,       icon: <Users size={12} />,    color: 'blue' },
          { label: 'Active',  value: activeJobs,           icon: <Activity size={12} />, color: 'emerald' },
          { label: 'Runs',    value: runs.length,          icon: <Cpu size={12} />,      color: 'purple' },
          { label: 'Ops',     value: operations.length,    icon: <Zap size={12} />,      color: 'cyan' },
          { label: 'Done',    value: completedJobs,        icon: <CheckCircle2 size={12} />, color: 'slate' },
        ].map((kpi) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/50 px-3 py-2 backdrop-blur-md"
          >
            <span className={`text-${kpi.color}-400`}>{kpi.icon}</span>
            <div>
              <div className={`text-base font-bold leading-none text-${kpi.color}-300`}>{kpi.value}</div>
              <div className="mt-0.5 text-[10px] text-white/40">{kpi.label}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Zoom kontrolleri (sağ-alt) ─────────────────────────────── */}
      {camControls && (
        <div className="absolute bottom-5 right-72 flex flex-col gap-1.5">
          {[
            { label: '+', title: 'Yakınlaş (tekerlek yukarı)', onClick: camControls.zoomIn },
            { label: '−', title: 'Uzaklaş (tekerlek aşağı)',   onClick: camControls.zoomOut },
            { label: '⟳', title: 'Görünümü sıfırla (R)',       onClick: camControls.resetView },
          ].map((b) => (
            <button
              key={b.label}
              title={b.title}
              onClick={b.onClick}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-black/50 text-lg font-bold text-white/80 backdrop-blur-md transition hover:bg-white/10 hover:text-white"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Right panel (agents / jobs) ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 }}
        className="absolute right-5 top-16 bottom-5 w-60 flex flex-col gap-2"
      >
        {/* Panel toggle */}
        <div className="flex rounded-xl border border-white/[0.07] bg-black/60 p-1 backdrop-blur-md">
          {(['agents', 'jobs', 'ops'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPanel(p)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all ${
                panel === p
                  ? 'bg-blue-600/30 text-blue-300 shadow-sm'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {p === 'agents' ? 'Agents' : p === 'jobs' ? 'Runs' : 'Ops'}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden rounded-xl border border-white/[0.07] bg-black/60 backdrop-blur-md">
          <div className="h-full overflow-y-auto scrollbar-none p-2 space-y-1">
            <AnimatePresence mode="wait">
              {panel === 'agents' ? (
                <motion.div key="agents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                  {officeAgents.length === 0 ? (
                    <p className="py-8 text-center text-xs text-white/30">Initializing…</p>
                  ) : officeAgents.map((a, i) => (
                    <motion.div
                      key={a.agentId}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
                    >
                      <div className="h-6 w-6 shrink-0 rounded-lg flex items-center justify-center text-[9px] font-bold"
                        style={{ background: `${ROLE_COLORS[a.role ?? ''] ?? '#3b82f6'}22`, color: ROLE_COLORS[a.role ?? ''] ?? '#60a5fa' }}
                      >
                        {a.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-white/80">{a.name}</div>
                        <div className="text-[10px] text-white/35 capitalize">{a.role ?? 'general'}</div>
                      </div>
                      <div className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: ROLE_COLORS[a.role ?? ''] ?? '#3b82f6', boxShadow: `0 0 4px ${ROLE_COLORS[a.role ?? ''] ?? '#3b82f6'}` }}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              ) : panel === 'jobs' ? (
                <motion.div key="jobs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                  {jobs.length === 0 ? (
                    <p className="py-8 text-center text-xs text-white/30">No runs yet</p>
                  ) : jobs.slice(0, 12).map((job, i) => (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
                    >
                      <StatusDot status={job.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[10px] text-white/60">{job.id.slice(0, 12)}…</div>
                        <div className="text-[10px] capitalize text-white/35">{job.status}</div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div key="ops" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                  {operations.length === 0 ? (
                    <p className="py-8 text-center text-xs text-white/30">Aktif operasyon yok</p>
                  ) : operations.map((op, i) => (
                    <motion.div
                      key={op.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
                    >
                      <div className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        op.status === 'escalated' ? 'bg-red-400' : 'bg-emerald-400'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium text-white/80">{op.goal_text}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                            op.status === 'escalated'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {op.status === 'escalated' ? 'Eskalasyon' : 'Aktif'}
                          </span>
                          <span className="text-[9px] text-white/30">{op.step_count}/{op.max_steps}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {pendingApprovalCount > 0 && (
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                      <span className="text-[10px] text-amber-300">⏳ {pendingApprovalCount} onay bekliyor</span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Error toast */}
      {err && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300 backdrop-blur-sm">
          {err}
        </div>
      )}
    </div>
  )
}
