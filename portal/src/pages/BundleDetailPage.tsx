import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type BundleRow = {
  id: string
  external_id: string | null
  run_id: string | null
  name: string
  tags: string | null
  payload_json: unknown
  created_at: string
}

type FactRow = { id: string; title: string; state: string; updated_at: string }

export default function BundleDetailPage() {
  const { bundleId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<BundleRow | null>(null)
  const [facts, setFacts] = useState<FactRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!bundleId) return
      setErr(null)
      const r = await supabase
        .from('bundles')
        .select('id,external_id,run_id,name,tags,payload_json,created_at')
        .eq('id', bundleId)
        .maybeSingle()
      if (r.error) {
        setErr(r.error.message)
        return
      }
      setRow((r.data ?? null) as unknown as BundleRow | null)

      const f = await supabase
        .from('knowledge_facts')
        .select('id,title,state,updated_at')
        .eq('source_bundle_id', bundleId)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (!f.error) setFacts((f.data ?? []) as unknown as FactRow[])
    }
    load()
  }, [bundleId])

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
            <div className="text-sm font-medium">Bundle</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/60">Name</div>
                <div className="text-right">{row.name}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/60">Tags</div>
                <div className="text-right text-xs text-white/70">{row.tags ?? '-'}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-white/60">Created</div>
                <div className="text-right text-xs text-white/70">{new Date(row.created_at).toLocaleString()}</div>
              </div>
              {row.run_id ? (
                <div className="text-xs text-white/70">
                  Kaynak run: <Link className="text-blue-200 hover:underline" to={`/app/runs/${row.run_id}`}>{row.run_id}</Link>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Payload JSON</div>
            <pre className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
              {JSON.stringify(row.payload_json, null, 2)}
            </pre>
          </Card>

          <Card className="p-4 md:col-span-3">
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
