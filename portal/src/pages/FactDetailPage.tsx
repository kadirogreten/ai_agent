import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'

type FactRow = {
  id: string
  external_id: string | null
  title: string
  content: string
  tags: string | null
  state: 'draft' | 'verified' | 'rejected'
  source_type: 'run' | 'bundle' | 'manual'
  source_run_id: string | null
  source_bundle_id: string | null
  confidence: number | null
  created_at: string
  updated_at: string
}

function stateTone(s: FactRow['state']): 'green' | 'red' | 'yellow' | 'gray' {
  if (s === 'verified') return 'green'
  if (s === 'rejected') return 'red'
  return 'yellow'
}

export default function FactDetailPage() {
  const { factId } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState<FactRow | null>(null)
  const [edit, setEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [state, setState] = useState<FactRow['state']>('draft')
  const [confidence, setConfidence] = useState('')

  useEffect(() => {
    async function load() {
      if (!factId) return
      setErr(null)
      const r = await supabase
        .from('knowledge_facts')
        .select('id,external_id,title,content,tags,state,source_type,source_run_id,source_bundle_id,confidence,created_at,updated_at')
        .eq('id', factId)
        .maybeSingle()
      if (r.error) {
        setErr(r.error.message)
        return
      }
      const data = (r.data ?? null) as unknown as FactRow | null
      setRow(data)
      if (data) {
        setTitle(data.title)
        setContent(data.content)
        setTags(data.tags ?? '')
        setState(data.state)
        setConfidence(data.confidence === null || data.confidence === undefined ? '' : String(data.confidence))
      }
    }
    load()
  }, [factId])

  async function save() {
    if (!factId) return
    setSaving(true)
    setErr(null)
    const conf = confidence.trim() ? Number(confidence) : null
    const u = await supabase
      .from('knowledge_facts')
      .update({
        title: title.trim(),
        content: content.trim(),
        tags: tags.trim() || null,
        state,
        confidence: conf !== null && Number.isFinite(conf) ? conf : null,
      })
      .eq('id', factId)
    if (u.error) {
      setErr(u.error.message)
      setSaving(false)
      return
    }
    setEdit(false)
    setSaving(false)
    const r = await supabase
      .from('knowledge_facts')
      .select('id,external_id,title,content,tags,state,source_type,source_run_id,source_bundle_id,confidence,created_at,updated_at')
      .eq('id', factId)
      .maybeSingle()
    if (!r.error) setRow((r.data ?? null) as unknown as FactRow | null)
  }

  async function remove() {
    if (!factId) return
    const ok = window.confirm('Silmek istiyor musun?')
    if (!ok) return
    setErr(null)
    const d = await supabase.from('knowledge_facts').delete().eq('id', factId)
    if (d.error) {
      setErr(d.error.message)
      return
    }
    navigate('/app/facts')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
        <div className="flex gap-2">
          <Button variant="danger" onClick={remove}>Sil</Button>
          <Button variant="secondary" onClick={() => setEdit((x) => !x)}>
            {edit ? 'Vazgeç' : 'Düzenle'}
          </Button>
          {edit ? <Button onClick={save} disabled={saving || !title.trim() || !content.trim()}>Kaydet</Button> : null}
        </div>
      </div>

      {err ? <div className="text-sm text-red-200">{err}</div> : null}

      {row ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4 md:col-span-1">
            <div className="text-sm font-medium">Meta</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-white/60">State</div>
                <Badge tone={stateTone(row.state)}>{row.state}</Badge>
              </div>
              <div className="text-xs text-white/60">Created: {new Date(row.created_at).toLocaleString()}</div>
              <div className="text-xs text-white/60">Updated: {new Date(row.updated_at).toLocaleString()}</div>
              {row.external_id ? <div className="text-xs text-white/60">External: {row.external_id}</div> : null}
              <div className="text-xs text-white/60">Source: {row.source_type}</div>
              {row.source_run_id ? <div className="text-xs text-white/60">Run: {row.source_run_id}</div> : null}
              {row.source_bundle_id ? <div className="text-xs text-white/60">Bundle: {row.source_bundle_id}</div> : null}
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            {edit ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-white/60">Title</div>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-white/60">Content</div>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-56 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <div className="mb-1 text-xs text-white/60">Tags</div>
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-white/60">State</div>
                    <select
                      value={state}
                      onChange={(e) => setState(e.target.value as 'draft' | 'verified' | 'rejected')}
                      className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
                    >
                      <option value="draft">draft</option>
                      <option value="verified">verified</option>
                      <option value="rejected">rejected</option>
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-white/60">Confidence</div>
                    <Input value={confidence} onChange={(e) => setConfidence(e.target.value)} placeholder="0.95" />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium">{row.title}</div>
                <div className="mt-1 text-xs text-white/60">{row.tags ?? '-'}</div>
                <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
                  {row.content}
                </pre>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
