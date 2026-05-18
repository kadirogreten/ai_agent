import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { listPersonas, type PersonaRow } from '@/lib/personas'
import { listDomainPacks } from '@/lib/playbooks'
import { UserCircle, Plus } from 'lucide-react'

const RISK_TONE: Record<string, 'green' | 'blue' | 'yellow' | 'red'> = {
  R0: 'green', R1: 'blue', R2: 'yellow', R3: 'red',
}

export default function PersonasPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<PersonaRow[]>([])
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
    const res = await listPersonas({ q: filters.q, packId: filters.packId || undefined })
    if (res.error) { setErr(res.error); setRows([]) }
    else           { setRows(res.data) }
    setLoading(false)
  }, [canQuery, filters.q, filters.packId])

  useEffect(() => {
    if (!canQuery) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canQuery])

  useEffect(() => { load() }, [load])

  const columns: Column<PersonaRow>[] = [
    {
      key: 'name', header: 'Ad',
      render: (r) => <span className="font-medium text-white/80">{r.name ?? '—'}</span>,
    },
    {
      key: 'slug', header: 'Slug', width: '160px',
      render: (r) => <span className="font-mono text-xs text-white/35">{r.slug ?? '—'}</span>,
    },
    {
      key: 'risk_ceiling', header: 'Risk', width: '80px',
      render: (r) => <Badge tone={RISK_TONE[r.risk_ceiling] ?? 'gray'}>{r.risk_ceiling}</Badge>,
    },
    {
      key: 'cost_class', header: 'Maliyet', width: '90px',
      render: (r) => <Badge tone="gray">{r.cost_class ?? '—'}</Badge>,
    },
    {
      key: 'behaviors', header: 'Davranışlar', width: '120px',
      render: (r) => {
        const active = Object.entries(r.behaviors ?? {}).filter(([, v]) => v === true).length
        return active > 0
          ? <Badge tone="blue">{active} aktif</Badge>
          : <span className="text-xs text-white/25">—</span>
      },
    },
    {
      key: 'updated_at', header: 'Güncelleme', width: '140px',
      render: (r) => <span className="text-xs text-white/30">{new Date(r.updated_at).toLocaleDateString('tr-TR')}</span>,
    },
    {
      key: 'actions', header: '', width: '80px',
      render: (r) => (
        <Link to={`/app/personas/${r.id}/edit`} onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm">Düzenle</Button>
        </Link>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Personalar"
        description="Ajan davranış overlay'leri"
        actions={
          <Link to="/app/personas/new"><Button size="sm"><Plus size={13} className="mr-1" />Yeni Persona</Button></Link>
        }
      />

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
          {rows.length} persona
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={(r) => navigate(`/app/personas/${r.id}/edit`)}
          empty={<EmptyState icon={<UserCircle size={24} />} title="Persona bulunamadı" />}
        />
      </Card>
    </div>
  )
}
