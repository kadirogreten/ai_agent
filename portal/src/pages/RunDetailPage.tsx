import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ArrowLeft, FileText, Clock, CheckCircle, XCircle, Loader2, ImageIcon, FileIcon, Database, Brain, ExternalLink } from 'lucide-react'

type RunRow = {
  id: string
  external_id: string | null
  title: string | null
  status: 'running' | 'success' | 'fail'
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  output_text: string | null
  created_at: string
}

type BundleRow = { id: string; name: string; created_at: string }
type FactRow = { id: string; title: string; state: string; updated_at: string }

type RunArtifactRow = {
  id: string
  kind: 'image' | 'file'
  file_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string
  created_at: string
}

type RunArtifactView = RunArtifactRow & {
  url: string | null
}

function statusTone(s: RunRow['status']): 'green' | 'red' | 'yellow' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  return 'yellow'
}

function StatusIcon({ status }: { status: RunRow['status'] }) {
  if (status === 'success') return <CheckCircle size={16} className="text-emerald-400" />
  if (status === 'fail')    return <XCircle size={16} className="text-red-400" />
  return <Loader2 size={16} className="text-amber-400 animate-spin" />
}

function formatDuration(started: string | null, finished: string | null): string {
  if (!started || !finished) return '—'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export default function RunDetailPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<RunRow | null>(null)
  const [bundles, setBundles] = useState<BundleRow[]>([])
  const [facts, setFacts] = useState<FactRow[]>([])
  const [artifacts, setArtifacts] = useState<RunArtifactView[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!runId) return
      setErr(null)
      setLoading(true)
      const r = await supabase
        .from('runs')
        .select('id,external_id,title,status,started_at,finished_at,error_message,output_text,created_at')
        .eq('id', runId)
        .maybeSingle()
      if (r.error) {
        setErr(r.error.message)
        setLoading(false)
        return
      }
      setRow((r.data ?? null) as unknown as RunRow | null)

      const b = await supabase.from('bundles').select('id,name,created_at').eq('run_id', runId).order('created_at', { ascending: false })
      if (!b.error) setBundles((b.data ?? []) as unknown as BundleRow[])

      const f = await supabase
        .from('knowledge_facts')
        .select('id,title,state,updated_at')
        .eq('source_run_id', runId)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (!f.error) setFacts((f.data ?? []) as unknown as FactRow[])

      const a = await supabase
        .from('run_artifacts')
        .select('id,kind,file_name,storage_bucket,storage_path,mime_type,created_at')
        .eq('run_id', runId)
        .order('created_at', { ascending: true })

      if (!a.error) {
        const rows = (a.data ?? []) as unknown as RunArtifactRow[]
        const withUrls: RunArtifactView[] = []
        for (const ar of rows) {
          const signed = await supabase.storage.from(ar.storage_bucket).createSignedUrl(ar.storage_path, 60 * 60)
          withUrls.push({ ...ar, url: signed.data?.signedUrl ?? null })
        }
        setArtifacts(withUrls)
      }
      setLoading(false)
    }
    load()
  }, [runId])

  const imageArtifacts = artifacts.filter((a) => a.kind === 'image')
  const fileArtifacts  = artifacts.filter((a) => a.kind === 'file')

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} className="mr-1" /> Geri
          </Button>
          {runId && (
            <Link to={`/app/reports/${runId}`} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <FileText size={12} /> Rapor
            </Link>
          )}
        </div>
        {row?.external_id && (
          <span className="font-mono text-xs text-white/40">{row.external_id}</span>
        )}
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {loading && !row && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded-full bg-white/[0.05]" style={{ width: `${30 + i * 15}%` }} />
          ))}
        </div>
      )}

      {row && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Status + Meta */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <StatusIcon status={row.status} />
                  <h2 className="text-base font-semibold text-white">{row.title ?? 'Run'}</h2>
                </div>
                <p className="text-xs text-white/40 font-mono">{row.id}</p>
              </div>
              <Badge tone={statusTone(row.status)} className="shrink-0">{row.status}</Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 divide-x divide-white/[0.05]">
              <div className="pr-3">
                <div className="flex items-center gap-1 text-xs text-white/40 mb-0.5">
                  <Clock size={11} /> Başlangıç
                </div>
                <div className="text-xs text-white/70">
                  {row.started_at ? new Date(row.started_at).toLocaleString('tr-TR') : '—'}
                </div>
              </div>
              <div className="px-3">
                <div className="flex items-center gap-1 text-xs text-white/40 mb-0.5">
                  <Clock size={11} /> Bitiş
                </div>
                <div className="text-xs text-white/70">
                  {row.finished_at ? new Date(row.finished_at).toLocaleString('tr-TR') : '—'}
                </div>
              </div>
              <div className="px-3">
                <div className="text-xs text-white/40 mb-0.5">Süre</div>
                <div className="text-xs text-white/70">{formatDuration(row.started_at, row.finished_at)}</div>
              </div>
              <div className="pl-3">
                <div className="text-xs text-white/40 mb-0.5">Oluşturulma</div>
                <div className="text-xs text-white/70">{new Date(row.created_at).toLocaleDateString('tr-TR')}</div>
              </div>
            </div>

            {row.error_message && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {row.error_message}
              </div>
            )}
          </Card>

          {/* Output */}
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold text-white/80">Output</div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/20 p-3 text-xs text-white/70 scrollbar-none">
              {row.output_text ?? '(empty)'}
            </pre>
          </Card>

          {/* Image Artifacts */}
          {imageArtifacts.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                <ImageIcon size={15} className="text-white/40" /> Görseller
                <Badge tone="gray">{imageArtifacts.length}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {imageArtifacts.map((a) => (
                  <div key={a.id} className="rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#0f1829] to-[#0a1020] overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/[0.05]">
                      <span className="truncate text-xs text-white/60">{a.file_name}</span>
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 shrink-0">
                          <ExternalLink size={11} /> Aç
                        </a>
                      )}
                    </div>
                    {a.url ? (
                      <img src={a.url} alt={a.file_name} className="w-full object-cover bg-black/20" />
                    ) : (
                      <div className="px-3 py-6 text-center text-xs text-white/30">URL alınamadı</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* File Artifacts */}
          {fileArtifacts.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                <FileIcon size={15} className="text-white/40" /> Dosyalar
                <Badge tone="gray">{fileArtifacts.length}</Badge>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {fileArtifacts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileIcon size={13} className="text-white/30 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-xs text-white/70">{a.file_name}</div>
                        <div className="text-[11px] text-white/35">{a.mime_type}</div>
                      </div>
                    </div>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 shrink-0">
                        <ExternalLink size={11} /> İndir
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Bundles + Facts row */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                <Database size={15} className="text-white/40" /> İlişkili Bundles
                {bundles.length > 0 && <Badge tone="gray">{bundles.length}</Badge>}
              </div>
              {bundles.length === 0 ? (
                <p className="text-xs text-white/30">Yok</p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {bundles.map((b) => (
                    <Link key={b.id} to={`/app/bundles/${b.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:text-blue-300 transition-colors group">
                      <span className="truncate text-sm text-white/70 group-hover:text-blue-300">{b.name}</span>
                      <span className="text-xs text-white/30 shrink-0">{new Date(b.created_at).toLocaleDateString('tr-TR')}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                <Brain size={15} className="text-white/40" /> İlişkili Facts
                {facts.length > 0 && <Badge tone="gray">{facts.length}</Badge>}
              </div>
              {facts.length === 0 ? (
                <p className="text-xs text-white/30">Yok</p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {facts.map((f) => (
                    <Link key={f.id} to={`/app/facts/${f.id}`} className="flex items-center justify-between gap-2 py-2.5 group">
                      <span className="truncate text-sm text-white/70 group-hover:text-blue-300 transition-colors">{f.title}</span>
                      <span className="text-xs text-white/30 shrink-0">{f.state}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </motion.div>
      )}
    </div>
  )
}
