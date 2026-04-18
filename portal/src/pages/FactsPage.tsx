import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

type FactRow = {
  id: string
  external_id: string | null
  title: string
  tags: string | null
  state: 'draft' | 'verified' | 'rejected'
  source_type: 'run' | 'bundle' | 'manual'
  created_at: string
  updated_at: string
}

function stateTone(s: FactRow['state']): 'green' | 'red' | 'yellow' | 'gray' {
  if (s === 'verified') return 'green'
  if (s === 'rejected') return 'red'
  return 'yellow'
}

export default function FactsPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FactRow[]>([])
  const [q, setQ] = useState('')
  const [state, setState] = useState<'all' | FactRow['state']>('all')
  const [err, setErr] = useState<string | null>(null)

  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newState, setNewState] = useState<FactRow['state']>('draft')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    init()
  }, [init])

  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q, state }), [q, state])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    let query = supabase
      .from('knowledge_facts')
      .select('id,external_id,title,tags,state,source_type,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200)

    if (filters.state !== 'all') query = query.eq('state', filters.state)
    if (filters.q.trim()) {
      const term = `%${filters.q.trim()}%`
      query = query.or(`title.ilike.${term},tags.ilike.${term}`)
    }

    const res = await query
    if (res.error) {
      setErr(res.error.message)
      setRows([])
    } else {
      setRows((res.data ?? []) as FactRow[])
    }
    setLoading(false)
  }, [canQuery, filters.q, filters.state])

  useEffect(() => {
    load()
  }, [load])

  async function createFact() {
    if (!user) return
    setSaving(true)
    setErr(null)
    const inserted = await supabase.from('knowledge_facts').insert({
      owner_user_id: user.id,
      title: newTitle.trim(),
      content: newContent.trim(),
      tags: newTags.trim() || null,
      state: newState,
      source_type: 'manual',
    })
    if (inserted.error) {
      setErr(inserted.error.message)
      setSaving(false)
      return
    }
    setNewOpen(false)
    setNewTitle('')
    setNewContent('')
    setNewTags('')
    setNewState('draft')
    setSaving(false)
    load()
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">Arama</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="claim, domain, tags..." />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">State</div>
              <select
                value={state}
                onChange={(e) => setState(e.target.value as 'all' | 'draft' | 'verified' | 'rejected')}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="all">all</option>
                <option value="draft">draft</option>
                <option value="verified">verified</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setQ(''); setState('all'); }}>
              Temizle
            </Button>
            <Button onClick={() => setNewOpen(true)}>Yeni Fact</Button>
          </div>
        </div>
      </Card>

      {newOpen ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Yeni Fact</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">Title</div>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">Content</div>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="min-h-28 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Tags</div>
              <Input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="market-intel,techcrunch" />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">State</div>
              <select
                value={newState}
                onChange={(e) => setNewState(e.target.value as 'draft' | 'verified' | 'rejected')}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="draft">draft</option>
                <option value="verified">verified</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setNewOpen(false)} disabled={saving}>
              İptal
            </Button>
            <Button onClick={createFact} disabled={saving || !newTitle.trim() || !newContent.trim()}>
              Kaydet
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Knowledge Facts</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Tags</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={4}>
                    Yükleniyor...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={4}>
                    Kayıt yok
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2"><Badge tone={stateTone(r.state)}>{r.state}</Badge></td>
                    <td className="px-4 py-2">
                      <Link to={`/app/facts/${r.id}`} className="text-blue-200 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-white/60">{r.tags ?? '-'}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
