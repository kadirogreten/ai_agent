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
  model: string | null
  web: boolean
  contrarian: boolean
  risk: string
  allow_high_risk: boolean
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  result_json: unknown | null
  created_at: string
  updated_at: string
}

function statusTone(s: JobStatus): 'green' | 'red' | 'yellow' | 'gray' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  if (s === 'running') return 'yellow'
  if (s === 'pending') return 'gray'
  return 'gray'
}

export default function JobDetailPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<JobRow | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobId) return
    setErr(null)
    const r = await supabase
      .from('run_requests')
      .select(
        'id,status,mode,domain_pack,request_text,answers_json,model,web,contrarian,risk,allow_high_risk,started_at,finished_at,error_message,result_json,created_at,updated_at',
      )
      .eq('id', jobId)
      .maybeSingle()
    if (r.error) {
      setErr(r.error.message)
      return
    }
    setRow((r.data ?? null) as unknown as JobRow | null)
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

  const shouldPoll = useMemo(() => row?.status === 'pending' || row?.status === 'running', [row?.status])

  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => {
      load()
    }, 5000)
    return () => window.clearInterval(id)
  }, [load, shouldPoll])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
        <Button variant="secondary" onClick={() => load()}>Yenile</Button>
      </div>

      {err ? <div className="text-sm text-red-200">{err}</div> : null}

      {row ? (
        <div className="grid gap-4 md:grid-cols-3">
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
              <div className="text-xs text-white/60">Risk: {row.risk}</div>
              <div className="text-xs text-white/60">web: {row.web ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">contrarian: {row.contrarian ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">allow_high_risk: {row.allow_high_risk ? 'true' : 'false'}</div>
              <div className="text-xs text-white/60">Created: {new Date(row.created_at).toLocaleString()}</div>
              <div className="text-xs text-white/60">Updated: {new Date(row.updated_at).toLocaleString()}</div>
              {row.error_message ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200">{row.error_message}</div>
              ) : null}
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Request</div>
            <pre className="mt-3 max-h-[35vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.request_text ?? '(empty)'}
            </pre>

            <div className="mt-4 text-sm font-medium">Answers</div>
            <pre className="mt-3 max-h-[35vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.answers_json ? JSON.stringify(row.answers_json, null, 2) : '(empty)'}
            </pre>
          </Card>

          <Card className="p-4 md:col-span-3">
            <div className="text-sm font-medium">Result</div>
            <pre className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.result_json ? JSON.stringify(row.result_json, null, 2) : '(empty)'}
            </pre>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

