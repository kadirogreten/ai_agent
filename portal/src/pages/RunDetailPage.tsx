import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

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

export default function RunDetailPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<RunRow | null>(null)
  const [bundles, setBundles] = useState<BundleRow[]>([])
  const [facts, setFacts] = useState<FactRow[]>([])
  const [artifacts, setArtifacts] = useState<RunArtifactView[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!runId) return
      setErr(null)
      const r = await supabase
        .from('runs')
        .select('id,external_id,title,status,started_at,finished_at,error_message,output_text,created_at')
        .eq('id', runId)
        .maybeSingle()
      if (r.error) {
        setErr(r.error.message)
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
    }
    load()
  }, [runId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
        {row?.external_id ? <div className="text-xs text-white/60">{row.external_id}</div> : null}
      </div>

      {err ? <div className="text-sm text-red-200">{err}</div> : null}

      {row ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4 md:col-span-1">
            <div className="text-sm font-medium">Run</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-white/60">Status</div>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/60">Title</div>
                <div className="text-right">{row.title ?? '-'}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/60">Created</div>
                <div className="text-right text-xs text-white/70">{new Date(row.created_at).toLocaleString()}</div>
              </div>
              {row.error_message ? <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200">{row.error_message}</div> : null}
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Output</div>
            <pre className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {row.output_text ?? '(empty)'}
            </pre>
          </Card>

          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Görseller</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {artifacts.filter((a) => a.kind === 'image').length === 0 ? <div className="text-xs text-white/60">Yok</div> : null}
              {artifacts.filter((a) => a.kind === 'image').map((a) => (
                <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-xs text-white/70">{a.file_name}</div>
                    {a.url ? (
                      <a
                        className="text-xs text-blue-200 hover:underline"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Aç
                      </a>
                    ) : null}
                  </div>
                  {a.url ? (
                    <img
                      src={a.url}
                      alt={a.file_name}
                      className="mt-2 w-full rounded-md border border-white/10 bg-black/20"
                    />
                  ) : (
                    <div className="mt-2 text-xs text-white/60">URL alınamadı</div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 md:col-span-1">
            <div className="text-sm font-medium">Dosyalar</div>
            <div className="mt-3 space-y-2">
              {artifacts.filter((a) => a.kind === 'file').length === 0 ? <div className="text-xs text-white/60">Yok</div> : null}
              {artifacts.filter((a) => a.kind === 'file').map((a) => (
                <div key={a.id} className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-xs text-white/70">{a.file_name}</div>
                    {a.url ? (
                      <a className="text-xs text-blue-200 hover:underline" href={a.url} target="_blank" rel="noreferrer">
                        İndir
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] text-white/50">{a.mime_type}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 md:col-span-1">
            <div className="text-sm font-medium">İlişkili Bundles</div>
            <div className="mt-3 space-y-2">
              {bundles.length === 0 ? <div className="text-xs text-white/60">Yok</div> : null}
              {bundles.map((b) => (
                <Link key={b.id} to={`/app/bundles/${b.id}`} className="block rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                  <div className="truncate">{b.name}</div>
                  <div className="text-xs text-white/60">{new Date(b.created_at).toLocaleString()}</div>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">İlişkili Facts</div>
            <div className="mt-3 space-y-2">
              {facts.length === 0 ? <div className="text-xs text-white/60">Yok</div> : null}
              {facts.map((f) => (
                <Link key={f.id} to={`/app/facts/${f.id}`} className="block rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                  <div className="truncate">{f.title}</div>
                  <div className="text-xs text-white/60">{f.state} • {new Date(f.updated_at).toLocaleString()}</div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
