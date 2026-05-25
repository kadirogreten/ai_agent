import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/Button'

// ── Types ────────────────────────────────────────────────────────────────────

type JobRow = {
  id: string
  status: string
  mode: string
  domain_pack: string | null
  request_text: string | null
  result_json: {
    run_id?: string
    playbook_run_ids?: string[]
  } | null
  created_at: string
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    try { return JSON.stringify(o.content_json, null, 2) }
    catch { return String(o.content_json) }
  }
  return null
}

// Minimal markdown → React: handles #/##/### headings, **bold**, - bullets, blank lines
function renderMd(md: string) {
  return md.split('\n').map((raw, i) => {
    const line = raw.trimEnd()
    if (/^### /.test(line)) return <h3 key={i} className="text-base font-semibold mt-4 mb-1 text-white">{line.slice(4)}</h3>
    if (/^## /.test(line))  return <h2 key={i} className="text-lg font-bold mt-6 mb-2 text-white">{line.slice(3)}</h2>
    if (/^# /.test(line))   return <h1 key={i} className="text-xl font-extrabold mt-8 mb-3 text-white">{line.slice(2)}</h1>
    if (/^[-*] /.test(line)) return <li key={i} className="ml-5 list-disc text-sm text-white/80">{inlineBold(line.slice(2))}</li>
    if (!line.trim()) return <div key={i} className="h-2" />
    return <p key={i} className="text-sm text-white/80 leading-relaxed">{inlineBold(line)}</p>
  })
}

function inlineBold(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
  )
}

// ── Print styles injected into <head> ────────────────────────────────────────

const PRINT_CSS = `
@media print {
  body { background: white !important; color: black !important; }
  .no-print { display: none !important; }
  .print-page { background: white !important; color: black !important; padding: 0 !important; }
  .print-card { background: white !important; border-color: #e5e7eb !important; color: black !important; }
  .print-card h1, .print-card h2, .print-card h3 { color: black !important; }
  .print-card p, .print-card li { color: #374151 !important; }
  .print-card pre { background: #f9fafb !important; color: black !important; border-color: #d1d5db !important; }
  .print-divider { border-color: #d1d5db !important; }
  @page { margin: 2cm; }
}
`

// ── Component ────────────────────────────────────────────────────────────────

export default function JobReportPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)

  const [job, setJob] = useState<JobRow | null>(null)
  const [outputs, setOutputs] = useState<RunOutput[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  // Inject print CSS once
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = PRINT_CSS
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  const load = useCallback(async () => {
    if (!jobId) return
    setErr(null)
    setLoading(true)

    const jobRes = await supabase
      .from('run_requests')
      .select('id,status,mode,domain_pack,request_text,result_json,created_at')
      .eq('id', jobId)
      .maybeSingle()

    if (jobRes.error) { setErr(jobRes.error.message); setLoading(false); return }
    const row = (jobRes.data ?? null) as unknown as JobRow | null
    setJob(row)

    const runIds = collectRunIds(row)
    if (runIds.length > 0) {
      const outRes = await supabase
        .from('run_outputs')
        .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_md,content_json,created_at')
        .in('run_id', runIds)
        .order('created_at', { ascending: true })
      if (!outRes.error) setOutputs((outRes.data ?? []) as RunOutput[])
    } else {
      setOutputs([])
    }

    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  const shouldPoll = useMemo(() => job?.status === 'pending' || job?.status === 'running', [job?.status])
  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => load(), 5000)
    return () => window.clearInterval(id)
  }, [load, shouldPoll])

  // ── Word download ──────────────────────────────────────────────────────────
  async function downloadDocx() {
    if (!session?.access_token || !jobId) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/report.docx`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agentarmy-raporu-${jobId.slice(0, 8)}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Word indirme hatası: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDownloading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-white/40 text-sm">Yükleniyor…</div>
    )
  }

  if (!job) {
    return (
      <div className="text-sm text-red-200 p-4">{err ?? 'Job bulunamadı.'}</div>
    )
  }

  return (
    <div className="print-page min-h-screen bg-[#0d0d1a] text-white px-4 py-6 max-w-4xl mx-auto space-y-6">

      {/* Toolbar — hidden on print */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>← Geri</Button>
        <Button variant="secondary" onClick={() => window.print()}>🖨 PDF Olarak Yazdır</Button>
        <Button
          variant="outline"
          onClick={downloadDocx}
          disabled={downloading}
        >
          {downloading ? 'İndiriliyor…' : '⬇ Word (.docx) İndir'}
        </Button>
        <Button variant="secondary" onClick={load}>Yenile</Button>
      </div>

      {err ? <div className="no-print text-sm text-red-200">{err}</div> : null}

      {/* ── Job meta header ── */}
      <div className="print-card rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-extrabold tracking-tight mb-4">AgentArmy Raporu</h1>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <span className="text-white/50">Job ID</span>
          <span className="font-mono text-xs text-white/80 break-all">{job.id}</span>
          <span className="text-white/50">Mod</span>
          <span>{job.mode}</span>
          <span className="text-white/50">Domain Pack</span>
          <span>{job.domain_pack ?? '-'}</span>
          <span className="text-white/50">Durum</span>
          <span>{job.status}</span>
          <span className="text-white/50">Oluşturuldu</span>
          <span>{new Date(job.created_at).toLocaleString('tr-TR')}</span>
        </div>

        {job.request_text ? (
          <>
            <hr className="print-divider my-4 border-white/10" />
            <div className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">İstek</div>
            <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{job.request_text}</p>
          </>
        ) : null}
      </div>

      {/* ── Outputs ── */}
      {outputs.length === 0 ? (
        <div className="print-card rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/50">
          {job.status === 'running' || job.status === 'pending'
            ? 'Job henüz çalışıyor, çıktılar bekleniyor…'
            : 'Bu job için kayıtlı çıktı yok.'}
        </div>
      ) : (
        outputs.map((o) => {
          const heading = o.artifact_name ?? o.step_id ?? o.output_type
          const agentLabel = o.agent_id ? ` — ${o.agent_id}` : ''
          const body = outputBody(o)

          return (
            <div key={o.id} className="print-card rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-start justify-between gap-2 mb-3">
                <h2 className="text-base font-bold leading-snug">{heading}{agentLabel}</h2>
                <span className="shrink-0 text-xs text-white/30 mt-0.5">
                  {new Date(o.created_at).toLocaleTimeString('tr-TR')}
                </span>
              </div>
              <div className="text-[11px] text-white/30 font-mono mb-3">{o.run_id} · {o.output_type}</div>

              {body ? (
                /^```/.test(body) ? (
                  <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80">
                    {body.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')}
                  </pre>
                ) : (
                  <div className="space-y-1">
                    {renderMd(body)}
                  </div>
                )
              ) : (
                <span className="text-xs text-white/30 italic">Boş içerik</span>
              )}
            </div>
          )
        })
      )}

      {/* Footer */}
      <div className="text-center text-xs text-white/20 pb-4">
        AgentArmy · {new Date().toLocaleDateString('tr-TR')}
      </div>
    </div>
  )
}
