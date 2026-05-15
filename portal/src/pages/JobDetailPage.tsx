import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

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
  result_json: { run_id?: string; metrics?: Record<string, unknown>; sla?: Record<string, unknown> } | null
  created_at: string
  updated_at: string
}

type RunOutput = {
  id: string
  step_id: string
  agent_id: string | null
  artifact_name: string | null
  output_type: string
  content_md: string | null
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

    const runId = job?.result_json?.run_id
    if (runId) {
      const [outRes, evtRes] = await Promise.all([
        supabase
          .from('run_outputs')
          .select('id,step_id,agent_id,artifact_name,output_type,content_md,created_at')
          .eq('run_id', runId)
          .order('created_at', { ascending: true }),
        supabase
          .from('run_events')
          .select('id,event_type,payload,created_at')
          .eq('run_id', runId)
          .order('created_at', { ascending: true }),
      ])
      if (!outRes.error) setOutputs((outRes.data ?? []) as RunOutput[])
      if (!evtRes.error) setEvents((evtRes.data ?? []) as RunEvent[])
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
          {row?.mode === 'ceo' ? (
            <Button variant="outline" onClick={() => navigate(`/app/jobs/${row.id}/review`)}>
              CEO Review
            </Button>
          ) : null}
        </div>
        <Button variant="secondary" onClick={() => load()}>Yenile</Button>
      </div>

      {err ? <div className="text-sm text-red-200">{err}</div> : null}

      {row ? (
        <div className="grid gap-4 md:grid-cols-3">
          {/* ── Sol panel: Job meta ── */}
          <Card className="p-4 md:col-span-1">
            <div className="text-sm font-medium">Job</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-white/60">Status</div>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </div>
              <div className="text-xs text-white/60">Mode: {row.mode}</div>
              <div className="text-xs text-white/60">Domain: {row.domain_pack ?? '-'}</div>
              <div className="text-xs text-white/60">Model: {row.model ?? '-'}</div>
              <div className="text-xs text-white/60">
                Agents: {row.selected_agents && row.selected_agents.length > 0 ? row.selected_agents.join(', ') : 'all'}
              </div>
              <div className="text-xs text-white/60">Risk: {row.risk}</div>
              <div className="text-xs text-white/60">web: {row.web ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">contrarian: {row.contrarian ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">allow_high_risk: {row.allow_high_risk ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">Created: {new Date(row.created_at).toLocaleString()}</div>
              <div className="text-xs text-white/60">Updated: {new Date(row.updated_at).toLocaleString()}</div>
              {row.error_message ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200">{row.error_message}</div>
              ) : null}

              {/* Metrik özeti */}
              {metrics ? (
                <div className="mt-3 rounded-md border border-white/10 bg-white/5 p-2 space-y-1">
                  <div className="text-xs font-medium text-white/80">Metrikler</div>
                  {metrics.tokens_in  != null ? <div className="text-xs text-white/60">Tokens in:  {String(metrics.tokens_in)}</div>  : null}
                  {metrics.tokens_out != null ? <div className="text-xs text-white/60">Tokens out: {String(metrics.tokens_out)}</div> : null}
                  {typeof metrics.latency_ms === 'number' ? <div className="text-xs text-white/60">Latency: {fmtDuration(metrics.latency_ms)}</div> : null}
                  {metrics.verifier_outcome ? <div className="text-xs text-white/60">Verifier: {String(metrics.verifier_outcome)}</div> : null}
                </div>
              ) : null}

              {/* SLA */}
              {sla ? (
                <div className="rounded-md border border-white/10 bg-white/5 p-2 space-y-1">
                  <div className="text-xs font-medium text-white/80">SLA</div>
                  {typeof sla.total_ms === 'number' ? <div className="text-xs text-white/60">Toplam: {fmtDuration(sla.total_ms)}</div> : null}
                  {typeof sla.queue_latency_ms === 'number' ? <div className="text-xs text-white/60">Kuyruk: {fmtDuration(sla.queue_latency_ms)}</div> : null}
                </div>
              ) : null}
            </div>
          </Card>

          {/* ── Sağ panel: Request / Answers ── */}
          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Request</div>
            <pre className="mt-3 max-h-[25vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.request_text ?? '(empty)'}
            </pre>

            <div className="mt-4 text-sm font-medium">Answers</div>
            <pre className="mt-3 max-h-[25vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.answers_json ? JSON.stringify(row.answers_json, null, 2) : '(empty)'}
            </pre>
          </Card>

          {/* ── Step Outputs ── */}
          {outputs.length > 0 ? (
            <Card className="p-4 md:col-span-3">
              <div className="text-sm font-medium">Adım Çıktıları ({outputs.length})</div>
              <div className="mt-3 space-y-2">
                {outputs.map((o) => (
                  <div key={o.id} className="rounded-lg border border-white/10">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/5"
                      onClick={() => setExpandedOutput(expandedOutput === o.id ? null : o.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-white/90">{o.step_id}</span>
                        {o.agent_id ? <span className="text-xs text-white/50">{o.agent_id}</span> : null}
                        {o.artifact_name ? <span className="text-xs text-blue-300">{o.artifact_name}</span> : null}
                        <Badge tone="gray">{o.output_type}</Badge>
                      </div>
                      <span className="text-xs text-white/40">{new Date(o.created_at).toLocaleTimeString()}</span>
                    </button>
                    {expandedOutput === o.id && o.content_md ? (
                      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border-t border-white/10 bg-black/20 p-3 text-xs text-white/80">
                        {o.content_md}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* ── Event Timeline ── */}
          {events.length > 0 ? (
            <Card className="p-4 md:col-span-3">
              <div className="text-sm font-medium">Olay Zaman Çizelgesi ({events.length})</div>
              <div className="mt-3 space-y-1">
                {events.map((e) => {
                  const p = e.payload
                  const label = typeof p.step_id === 'string' ? p.step_id : (typeof p.agent === 'string' ? p.agent : '')
                  const durationMs = typeof p.duration_ms === 'number' ? p.duration_ms : null
                  return (
                    <div key={e.id} className="flex items-start gap-3 rounded px-2 py-1 hover:bg-white/5">
                      <span className="mt-0.5 w-5 shrink-0 text-center text-xs">
                        {e.event_type === 'step_end'   ? '✓' :
                         e.event_type === 'step_start' ? '▶' :
                         e.event_type === 'run_metrics' ? '📊' :
                         e.event_type === 'facts_extract' ? '💡' : '·'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-white/80">{e.event_type}</span>
                        {label ? <span className="ml-2 text-xs text-white/50">{label}</span> : null}
                        {durationMs !== null ? <span className="ml-2 text-xs text-white/40">{fmtDuration(durationMs)}</span> : null}
                      </div>
                      <span className="shrink-0 text-xs text-white/30">{new Date(e.created_at).toLocaleTimeString()}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          ) : null}

          {/* ── Raw result_json ── */}
          <Card className="p-4 md:col-span-3">
            <div className="text-sm font-medium">Result JSON</div>
            <pre className="mt-3 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.result_json ? JSON.stringify(row.result_json, null, 2) : '(empty)'}
            </pre>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
