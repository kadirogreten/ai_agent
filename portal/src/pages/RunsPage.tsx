import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

type RunRow = {
  id: string
  external_id: string | null
  title: string | null
  status: 'running' | 'success' | 'fail'
  started_at: string | null
  finished_at: string | null
  created_at: string
}

function statusTone(s: RunRow['status']): 'green' | 'red' | 'yellow' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  return 'yellow'
}

export default function RunsPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<RunRow[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | RunRow['status']>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const canQuery = initialized && !!user

  const filters = useMemo(() => ({ q, status, from, to }), [q, status, from, to])

  const load = useCallback(async () => {
    if (!canQuery || !user) return
    setLoading(true)
    setErr(null)
    let query = supabase
      .from('runs')
      .select('id,external_id,title,status,started_at,finished_at,created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.from) query = query.gte('created_at', filters.from)
    if (filters.to) query = query.lte('created_at', filters.to)
    if (filters.q.trim()) {
      const term = `%${filters.q.trim()}%`
      query = query.or(`title.ilike.${term},external_id.ilike.${term}`)
    }

    const res = await query
    if (res.error) {
      setErr(res.error.message)
      setRows([])
    } else {
      setRows((res.data ?? []) as RunRow[])
    }
    setLoading(false)
  }, [canQuery, filters.from, filters.q, filters.status, filters.to, user])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Arama (title/external id)</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="2026..., mi-weekly-brief..." />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'all' | 'success' | 'fail' | 'running')}
              className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="all">all</option>
              <option value="success">success</option>
              <option value="fail">fail</option>
              <option value="running">running</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={() => { setQ(''); setStatus('all'); setFrom(''); setTo(''); }}>
              Temizle
            </Button>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">From (ISO)</div>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2026-04-01" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">To (ISO)</div>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026-04-30" />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Runs</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">External</th>
                <th className="px-4 py-2">Created</th>
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
                    <td className="px-4 py-2"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-4 py-2">
                      <Link to={`/app/runs/${r.id}`} className="text-blue-200 hover:underline">
                        {r.title ?? '(untitled)'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-white/60">{r.external_id ?? '-'}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{new Date(r.created_at).toLocaleString()}</td>
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
