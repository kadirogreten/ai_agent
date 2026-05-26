import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { ChevronDown, ChevronRight, Cpu } from 'lucide-react'

type JobStatus = 'pending' | 'running' | 'success' | 'fail' | 'cancelled'

type JobRow = {
  id: string
  status: JobStatus
  mode: string
  domain_pack: string | null
  request_text: string | null
  answers_json: unknown | null
  selected_agents: string[] | null
  model: string | null
  web: boolean
  contrarian: boolean
  risk: string
  allow_high_risk: boolean
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  result_json: {
    run_id?: string
    playbook_run_ids?: string[]
    metrics?: Record<string, unknown>
    sla?: Record<string, unknown>
  } | null
  created_at: string
  updated_at: string
}

type RunOutput = {
  id: string
  run_id: string
  step_id: string | null
  agent_id: string | null
  artifact_name: string | null
  output_type: string
  content_md: string | null
  content_json: unknown | null
  created_at: string
}

type RunEvent = {
  id: string
  event_type: string
  payload: Record<string, unknown>
  created_at: string
}

function statusTone(s: JobStatus): 'green' | 'red' | 'yellow' | 'gray' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  if (s === 'running') return 'yellow'
  return 'gray'
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function collectRunIds(job: JobRow | null): string[] {
  if (!job?.result_json) return []
  const ids = new Set<string>()
  if (job.result_json.run_id) ids.add(job.result_json.run_id)
  for (const id of job.result_json.playbook_run_ids ?? []) {
    if (id) ids.add(id)
  }
  return [...ids]
}

function outputBody(o: RunOutput): string | null {
  if (o.content_md?.trim()) return o.content_md
  if (o.content_json != null) {
    try {
      return JSON.stringify(o.content_json, null, 2)
    } catch {
      return String(o.content_json)
    }
  }
  return null
}

function eventIcon(type: string) {
  if (type === 'step_end') return <span className="text-emerald-400">✓</span>
  if (type === 'step_start') return <span className="text-blue-400">▶</span>
  if (type === 'run_metrics') return <span className="text-amber-400">◈</span>
  if (type === 'facts_extract') return <span className="text-purple-400">◆</span>
  return <span className="text-white/30">·</span>
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-xs text-white/40 shrink-0">{label}</span>
      <span className="text-xs text-white/80 text-right font-mono">{value}</span>
    </div>
  )
}

export default function JobDetailPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<JobRow | null>(null)
  const [outputs, setOutputs] = useState<RunOutput[]>([])
  const [events, setEvents] = useState<RunEvent[]>([])
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobId) return
    setErr(null)
    const r = await supabase
      .from('run_requests')
      .select(
        'id,status,mode,domain_pack,request_text,answers_json,selected_agents,model,web,contrarian,risk,allow_high_risk,started_at,finished_at,error_message,result_json,created_at,updated_at',
      )
      .eq('id', jobId)
      .maybeSingle()
    if (r.error) { setErr(r.error.message); return }
    const job = (r.data ?? null) as unknown as JobRow | null
    setRow(job)

    const runIds = collectRunIds(job)
    if (runIds.length > 0) {
      const [outRes, evtRes] = await Promise.all([
        supabase
          .from('run_outputs')
          .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_md,content_json,created_at')
          .in('run_id', runIds)
          .order('created_at', { ascending: true }),
        supabase
          .from('run_events')
          .select('id,event_type,payload,created_at')
          .in('run_id', runIds)
          .order('created_at', { ascending: true }),
      ])
      if (!outRes.error) setOutputs((outRes.data ?? []) as RunOutput[])
      if (!evtRes.error) setEvents((evtRes.data ?? []) as RunEvent[])
    } else {
      setOutputs([])
      setEvents([])
    }
  }, [jobId])

  useEffect(() => { load() }, [load])

  const shouldPoll = useMemo(() => row?.status === 'pending' || row?.status === 'running', [row?.status])
  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => { load() }, 5000)
    return () => window.clearInterval(id)
  }, [load, shouldPoll])

  const metrics = row?.result_json?.metrics as Record<string, unknown> | undefined
  const sla     = row?.result_json?.sla     as Record<string, unknown> | undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title="Job Detayı"
        icon={<Cpu size={16} />}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Geri</Button>
            {(row?.mode === 'ceo' || row?.mode === 'ceo-iterate') ? (
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/jobs/${row.id}/review`)}>
                CEO Review
              </Button>
            ) : null}
            {row?.status === 'success' ? (
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/jobs/${row.id}/report`)}>
                Rapor
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => load()}>Yenile</Button>
          </div>
        }
      />

      {/* CEO iterate notice */}
      {row?.status === 'success' && (row.mode === 'ceo' || row.mode === 'ceo-iterate') ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-amber-200">
              <span className="font-semibold">Yeni sorular üretilmiş olabilir.</span>{' '}
              Bu job çalışırken CEO planlayıcısı ek sorular oluşturmuş olabilir.
              Review sayfasında soruları cevaplayıp daha kapsamlı bir rapor için tekrar iterate başlatabilirsiniz.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
              onClick={() => navigate(`/app/jobs/${row.id}/review`)}
            >
              Soruları Gör → İterate
            </Button>
          </div>
        </motion.div>
      ) : null}

      {err ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      ) : null}

      {row ? (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Left: Job meta */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="md:col-span-1"
          >
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Job</div>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </div>

              {row.error_message ? (
                <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {row.error_message}
                </div>
              ) : null}

              <div className="space-y-0">
                <MetaRow label="Mode" value={row.mode} />
                <MetaRow label="Domain" value={row.domain_pack ?? '-'} />
                <MetaRow label="Model" value={row.model ?? '-'} />
                <MetaRow label="Agents" value={row.selected_agents && row.selected_agents.length > 0 ? row.selected_agents.join(', ') : 'all'} />
                <MetaRow label="Risk" value={row.risk} />
                <MetaRow label="web" value={row.web ? 'true' : 'false'} />
                <MetaRow label="contrarian" value={row.contrarian ? 'true' : 'false'} />
                <MetaRow label="allow_high_risk" value={row.allow_high_risk ? 'true' : 'false'} />
                <MetaRow label="Created" value={new Date(row.created_at).toLocaleString()} />
                <MetaRow label="Updated" value={new Date(row.updated_at).toLocaleString()} />
              </div>

              {/* Metrics */}
              {metrics ? (
                <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 space-y-1">
                  <div className="mb-1.5 text-xs font-medium text-white/60">Metrikler</div>
                  {metrics.tokens_in  != null ? <MetaRow label="Tokens in"  value={String(metrics.tokens_in)} /> : null}
                  {metrics.tokens_out != null ? <MetaRow label="Tokens out" value={String(metrics.tokens_out)} /> : null}
                  {typeof metrics.latency_ms === 'number' ? <MetaRow label="Latency" value={fmtDuration(metrics.latency_ms)} /> : null}
                  {metrics.verifier_outcome ? <MetaRow label="Verifier" value={String(metrics.verifier_outcome)} /> : null}
                </div>
              ) : null}

              {/* SLA */}
              {sla ? (
                <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 space-y-1">
                  <div className="mb-1.5 text-xs font-medium text-white/60">SLA</div>
                  {typeof sla.total_ms === 'number' ? <MetaRow label="Toplam" value={fmtDuration(sla.total_ms)} /> : null}
                  {typeof sla.queue_latency_ms === 'number' ? <MetaRow label="Kuyruk" value={fmtDuration(sla.queue_latency_ms)} /> : null}
                </div>
              ) : null}
            </Card>
          </motion.div>

          {/* Right: Request / Answers */}
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="md:col-span-2"
          >
            <Card className="p-4 h-full">
              <div className="text-sm font-semibold text-white mb-2">Request</div>
              <pre className="max-h-[25vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs text-white/75">
                {row.request_text ?? '(empty)'}
              </pre>

              <div className="mt-5 text-sm font-semibold text-white mb-2">Answers</div>
              <pre className="max-h-[25vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs text-white/75">
                {row.answers_json ? JSON.stringify(row.answers_json, null, 2) : '(empty)'}
              </pre>
            </Card>
          </motion.div>

          {row.status === 'success' && outputs.length === 0 ? (
            <Card className="p-4 md:col-span-3">
              <div className="text-sm text-white/60">
                Job tamamlandı ancak bu ekranda çıktı görünmüyor. Eski bundle job'larda yalnızca bundle run id kayıtlı olabilir;
                yeni çalıştırmalarda tüm playbook adımları listelenir. Supabase <code className="text-white/90">run_outputs</code> tablosunu da kontrol edebilirsiniz.
              </div>
            </Card>
          ) : null}

          {/* Step Outputs */}
          {outputs.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className="md:col-span-3"
            >
              <Card className="overflow-hidden">
                <div className="border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">Adım Çıktıları</div>
                  <Badge tone="gray">{outputs.length}</Badge>
                </div>
                <div className="divide-y divide-white/[0.05]">
                  {outputs.map((o) => (
                    <div key={o.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
                        onClick={() => setExpandedOutput(expandedOutput === o.id ? null : o.id)}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-white/25 text-xs">
                            {expandedOutput === o.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </span>
                          <span className="font-mono text-[10px] text-white/30 shrink-0">{o.run_id.slice(0, 8)}</span>
                          <span className="font-mono text-xs font-medium text-white/85 truncate">
                            {o.artifact_name ?? o.step_id ?? o.output_type}
                          </span>
                          {o.step_id && o.artifact_name ? (
                            <span className="text-xs text-white/40 truncate">{o.step_id}</span>
                          ) : null}
                          {o.agent_id ? <span className="text-xs text-white/35 shrink-0">{o.agent_id}</span> : null}
                          <Badge tone="gray">{o.output_type}</Badge>
                        </div>
                        <span className="shrink-0 text-xs text-white/30 ml-2">
                          {new Date(o.created_at).toLocaleTimeString()}
                        </span>
                      </button>
                      <AnimatePresence>
                        {expandedOutput === o.id && outputBody(o) ? (
                          <motion.div
                            key="content"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border-t border-white/[0.06] bg-black/20 p-4 text-xs text-white/75">
                              {outputBody(o)}
                            </pre>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          ) : null}

          {/* Event Timeline */}
          {events.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.15 }}
              className="md:col-span-3"
            >
              <Card className="overflow-hidden">
                <div className="border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">Olay Zaman Çizelgesi</div>
                  <Badge tone="gray">{events.length}</Badge>
                </div>
                <div className="p-4">
                  <div className="relative pl-5">
                    {/* Vertical timeline line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/[0.07]" />
                    <div className="space-y-0">
                      {events.map((e) => {
                        const p = e.payload
                        const label = typeof p.step_id === 'string' ? p.step_id : (typeof p.agent === 'string' ? p.agent : '')
                        const durationMs = typeof p.duration_ms === 'number' ? p.duration_ms : null
                        return (
                          <div key={e.id} className="flex items-start gap-3 group">
                            {/* Timeline dot */}
                            <div className="relative z-10 mt-2 flex h-3.5 w-3.5 shrink-0 -translate-x-[18px] items-center justify-center rounded-full border border-white/[0.12] bg-[#0a1225] text-[9px]">
                              {eventIcon(e.event_type)}
                            </div>
                            <div className="flex flex-1 items-start justify-between gap-3 rounded px-2 py-1.5 -ml-3.5 hover:bg-white/[0.03] transition-colors">
                              <div className="min-w-0">
                                <span className="font-mono text-xs text-white/75">{e.event_type}</span>
                                {label ? <span className="ml-2 text-xs text-white/45">{label}</span> : null}
                                {durationMs !== null ? (
                                  <span className="ml-2 text-xs text-blue-400/60">{fmtDuration(durationMs)}</span>
                                ) : null}
                              </div>
                              <span className="shrink-0 text-xs text-white/25">
                                {new Date(e.created_at).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ) : null}

          {/* Raw result_json */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.2 }}
            className="md:col-span-3"
          >
            <Card className="p-4">
              <div className="text-sm font-semibold text-white mb-3">Result JSON</div>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs text-white/70">
                {row.result_json ? JSON.stringify(row.result_json, null, 2) : '(empty)'}
              </pre>
            </Card>
          </motion.div>
        </div>
      ) : null}
    </div>
  )
}
