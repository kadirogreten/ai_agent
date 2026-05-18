import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Brain } from 'lucide-react'

type FactRow = { id: string; title: string | null; scope: string | null; created_at: string }

export default function FactsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<FactRow[]>([])
  const [q,       setQ]       = useState('')
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
    let query = supabase.from('knowledge_facts').select('id,title,scope,created_at').order('created_at', { ascending: false }).limit(300)
    if (q.trim()) { const t = `%${q.trim()}%`; query = query.or(`title.ilike.${t}`) }
    const res = await query
    if (res.error) { setErr(res.error.message); setRows([]) }
    else           { setRows((res.data ?? []) as FactRow[]) }
    setLoading(false)
  }, [initialized, user, q])

  useEffect(() => { load() }, [load])

  const columns: Column<FactRow>[] = [
    {
      key: 'title', header: 'Anahtar', width: '200px',
      render: (r) => <span className="font-mono text-xs text-blue-300">{r.title ?? '—'}</span>,
    },
    {
      key: 'scope', header: 'Kapsam', width: '120px',
      render: (r) => r.scope ? <Badge tone="purple">{r.scope}</Badge> : <span className="text-white/25">—</span>,
    },
    {
      key: 'created_at', header: 'Tarih', width: '140px',
      render: (r) => <span className="text-xs text-white/30">{new Date(r.created_at).toLocaleDateString('tr-TR')}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Knowledge Facts" description="Kurumsal bilgi tabanı" />
      <Card className="p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Anahtar veya değer ara…" className="max-w-sm" />
      </Card>
      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}
      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">{rows.length} fact</div>
        <DataTable columns={columns} rows={rows} loading={loading}
          onRowClick={(r) => navigate(`/app/facts/${r.id}`)}
          empty={<EmptyState icon={<Brain size={24} />} title="Fact bulunamadı" />}
        />
      </Card>
    </div>
  )
}
