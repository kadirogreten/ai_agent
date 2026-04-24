import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

type RunRow = {
  id: string
  title: string | null
  status: 'running' | 'success' | 'fail'
  created_at: string
}

type ReportSection = {
  id: string
  title: string
  format: 'markdown' | string
  content: string
}

type ReportJson = {
  runId: string
  playbook: { id: string; title: string }
  contract: {
    Persona: string
    Goal: string
    Topic: string
    Deliverables: string
    Scope: string
    OutOfScope: string
    QualityCriteria: string
    Risk: string
    ToolPermissions: string
    Deadline: string
  }
  selectedAgents: string[]
  generatedAt: string
  sections: ReportSection[]
}

type RunArtifactRow = {
  id: string
  file_name: string
  storage_bucket: string
  storage_path: string
}

function statusTone(s: RunRow['status']): 'green' | 'red' | 'yellow' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  return 'yellow'
}

export default function ReportPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState<RunRow | null>(null)
  const [report, setReport] = useState<ReportJson | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function load() {
      if (!runId) return
      setLoading(true)
      setErr(null)

      const r = await supabase.from('runs').select('id,title,status,created_at').eq('id', runId).maybeSingle()
      if (r.error) {
        setErr(r.error.message)
        setLoading(false)
        return
      }
      setRun((r.data ?? null) as unknown as RunRow | null)

      const a = await supabase
        .from('run_artifacts')
        .select('id,file_name,storage_bucket,storage_path')
        .eq('run_id', runId)
        .eq('file_name', 'report.json')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (a.error || !a.data) {
        setReport(null)
        setLoading(false)
        return
      }

      const artifact = a.data as unknown as RunArtifactRow
      const signed = await supabase.storage.from(artifact.storage_bucket).createSignedUrl(artifact.storage_path, 60 * 60)
      const url = signed.data?.signedUrl
      if (!url) {
        setErr('report.json URL alınamadı')
        setLoading(false)
        return
      }

      const res = await fetch(url)
      if (!res.ok) {
        setErr(`report.json indirilemedi (${res.status})`)
        setLoading(false)
        return
      }
      const json = (await res.json()) as ReportJson
      setReport(json)
      setLoading(false)
    }
    load()
  }, [runId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
        {runId ? <Link className="text-xs text-blue-200 hover:underline" to={`/app/runs/${runId}`}>Run’a git</Link> : null}
      </div>

      {err ? <div className="text-sm text-red-200">{err}</div> : null}

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Genel Rapor</div>
            <div className="mt-1 text-xs text-white/60">{run?.title ?? runId ?? '-'}</div>
          </div>
          {run ? <Badge tone={statusTone(run.status)}>{run.status}</Badge> : null}
        </div>
        {run ? <div className="mt-2 text-xs text-white/60">Created: {new Date(run.created_at).toLocaleString()}</div> : null}
      </Card>

      {loading ? <div className="text-sm text-white/60">Yükleniyor...</div> : null}

      {!loading && !report ? (
        <Card className="p-4">
          <div className="text-sm text-white/70">report.json bulunamadı</div>
          <div className="mt-2 text-xs text-white/60">Run tamamlandıysa importer’ın report.json dosyasını yüklediğinden emin ol.</div>
        </Card>
      ) : null}

      {report ? (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-medium">Meta</div>
            <div className="mt-3 grid gap-2 text-xs text-white/70 md:grid-cols-2">
              <div>Playbook: {report.playbook.id} ({report.playbook.title})</div>
              <div>Generated: {new Date(report.generatedAt).toLocaleString()}</div>
              <div>Topic: {report.contract.Topic}</div>
              <div>Risk: {report.contract.Risk}</div>
              <div className="md:col-span-2">Seçili ajanlar: {Array.isArray(report.selectedAgents) && report.selectedAgents.length > 0 ? report.selectedAgents.join(', ') : '(tümü)'}</div>
            </div>
          </Card>

          {report.sections.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="text-sm font-medium">{s.title}</div>
              <pre className="mt-3 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
                {s.content ?? ''}
              </pre>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}

