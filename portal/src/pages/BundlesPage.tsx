import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

type BundleRow = {
  id: string
  external_id: string | null
  run_id: string | null
  name: string
  tags: string | null
  created_at: string
}

export default function BundlesPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<BundleRow[]>([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q, tag, from, to }), [q, tag, from, to])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)

    let query = supabase
      .from('bundles')
      .select('id,external_id,run_id,name,tags,created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.from) query = query.gte('created_at', filters.from)
    if (filters.to) query = query.lte('created_at', filters.to)
    if (filters.q.trim()) {
      const term = `%${filters.q.trim()}%`
      query = query.or(`name.ilike.${term},external_id.ilike.${term}`)
    }
    if (filters.tag.trim()) {
      query = query.ilike('tags', `%${filters.tag.trim()}%`)
    }

    const res = await query
    if (res.error) {
      setErr(res.error.message)
      setRows([])
    } else {
      setRows((res.data ?? []) as BundleRow[])
    }
    setLoading(false)
  }, [canQuery, filters.from, filters.q, filters.tag, filters.to])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Arama</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="weekly, market-intel..." />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Tag</div>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="market-intel" />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={() => { setQ(''); setTag(''); setFrom(''); setTo(''); }}>
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
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Bundles</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">External</th>
                <th className="px-4 py-2">Tags</th>
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
                    <td className="px-4 py-2">
                      <Link to={`/app/bundles/${r.id}`} className="text-blue-200 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-white/60">{r.external_id ?? '-'}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{r.tags ?? '-'}</td>
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
