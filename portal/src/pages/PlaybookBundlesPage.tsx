import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { listPlaybookBundles, type PlaybookBundleRow } from '@/lib/bundles'
import { listDomainPacks } from '@/lib/playbooks'
import { Package } from 'lucide-react'

export default function PlaybookBundlesPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<PlaybookBundleRow[]>([])
  const [packs,   setPacks]   = useState<{ id: string; name: string }[]>([])
  const [q,       setQ]       = useState('')
  const [packId,  setPackId]  = useState('')
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])
  const canQuery = initialized && !!user
  const filters  = useMemo(() => ({ q, packId }), [q, packId])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    const res = await listPlaybookBundles({ q: filters.q, packId: filters.packId || undefined })
    if (res.error) { setErr(res.error); setRows([]) }
    else           { setRows(res.data) }
    setLoading(false)
  }, [canQuery, filters.q, filters.packId])

  useEffect(() => {
    if (!canQuery) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canQuery])
  useEffect(() => { load() }, [load])

  const columns: Column<PlaybookBundleRow>[] = [
    {
      key: 'name', header: 'Ad',
      render: (r) => <span className="font-medium text-white/80">{r.name}</span>,
    },
    {
      key: 'slug', header: 'Slug', width: '180px',
      render: (r) => <span className="font-mono text-xs text-white/35">{r.slug}</span>,
    },
    {
      key: 'pack_id', header: 'Pack', width: '140px',
      render: (r) => <span className="text-xs text-white/50">{r.pack_id}</span>,
    },
    {
      key: 'playbook_slugs', header: 'Playbook', width: '90px',
      render: (r) => <Badge tone="blue">{String(r.playbook_slugs?.length ?? 0)}</Badge>,
    },
    {
      key: 'version', header: 'v', width: '55px',
      render: (r) => <span className="text-xs text-white/30">v{r.version}</span>,
    },
    {
      key: 'updated_at', header: 'Güncelleme', width: '140px',
      render: (r) => <span className="text-xs text-white/30">{new Date(r.updated_at).toLocaleDateString('tr-TR')}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Playbook Paketleri" description="Bundle koleksiyonları" />

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya slug ara…" className="w-56" />
          <select
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
            className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-blue-500/60"
          >
            <option value="">Tüm pack'ler</option>
            {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setPackId('') }}>Temizle</Button>
        </div>
      </Card>

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
          {rows.length} bundle
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={(r) => navigate(`/app/playbook-bundles/${r.id}`)}
          empty={<EmptyState icon={<Package size={24} />} title="Bundle bulunamadı" />}
        />
      </Card>
    </div>
  )
}
