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
import { Layers } from 'lucide-react'

type BundleRow = { id: string; external_id: string | null; name: string | null; run_count: number | null; created_at: string }

export default function BundlesPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<BundleRow[]>([])
  const [q,       setQ]       = useState('')
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
    let query = supabase.from('bundles').select('id,external_id,name,run_count,created_at').order('created_at', { ascending: false }).limit(200)
    if (q.trim()) { const t = `%${q.trim()}%`; query = query.or(`name.ilike.${t},external_id.ilike.${t}`) }
    const res = await query
    if (res.error) { setErr(res.error.message); setRows([]) }
    else           { setRows((res.data ?? []) as BundleRow[]) }
    setLoading(false)
  }, [initialized, user, q])

  useEffect(() => { load() }, [load])

  const columns: Column<BundleRow>[] = [
    {
      key: 'name', header: 'Başlık',
      render: (r) => <span className="font-medium text-white/80">{r.name ?? r.external_id ?? r.id.slice(0, 8)}</span>,
    },
    {
      key: 'external_id', header: 'External ID', width: '180px',
      render: (r) => <span className="font-mono text-xs text-white/35">{r.external_id ?? '—'}</span>,
    },
    {
      key: 'run_count', header: 'Run', width: '80px',
      render: (r) => r.run_count != null ? <Badge tone="blue">{String(r.run_count)}</Badge> : <span className="text-white/25">—</span>,
    },
    {
      key: 'created_at', header: 'Tarih', width: '140px',
      render: (r) => <span className="text-xs text-white/30">{new Date(r.created_at).toLocaleDateString('tr-TR')}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Run Bundles" description="Gruplanmış run koleksiyonları" />
      <Card className="p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Başlık veya ID ara…" className="max-w-sm" />
      </Card>
      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}
      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">{rows.length} bundle</div>
        <DataTable columns={columns} rows={rows} loading={loading}
          onRowClick={(r) => navigate(`/app/bundles/${r.id}`)}
          empty={<EmptyState icon={<Layers size={24} />} title="Bundle bulunamadı" />}
        />
      </Card>
    </div>
  )
}
