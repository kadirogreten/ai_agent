import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { listPlaybooks, listDomainPacks, type PlaybookRow } from '@/lib/playbooks'
import { BookOpen, Plus } from 'lucide-react'

const RISK_TONE: Record<string, 'green' | 'blue' | 'yellow' | 'red'> = {
  R0: 'green', R1: 'blue', R2: 'yellow', R3: 'red',
}

export default function PlaybooksPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<PlaybookRow[]>([])
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
    const res = await listPlaybooks({ q: filters.q, packId: filters.packId || undefined })
    if (res.error) { setErr(res.error); setRows([]) }
    else           { setRows(res.data) }
    setLoading(false)
  }, [canQuery, filters.q, filters.packId])

  useEffect(() => {
    if (!canQuery) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canQuery])

  useEffect(() => { load() }, [load])

  const columns: Column<PlaybookRow>[] = [
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
      key: 'steps', header: 'Adım', width: '70px',
      render: (r) => <Badge tone="gray">{String(r.steps?.length ?? 0)}</Badge>,
    },
    {
      key: 'default_risk', header: 'Risk', width: '80px',
      render: (r) => r.default_risk
        ? <Badge tone={RISK_TONE[r.default_risk] ?? 'gray'}>{r.default_risk}</Badge>
        : <span className="text-white/25">—</span>,
    },
    {
      key: 'version', header: 'v', width: '55px',
      render: (r) => <span className="text-xs text-white/30">v{r.version}</span>,
    },
    {
      key: 'actions', header: '', width: '80px',
      render: (r) => (
        <Link to={`/app/playbooks/${r.id}/edit`} onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm">Düzenle</Button>
        </Link>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Playbook'lar"
        description="Ajan çalıştırma şablonları"
        icon={<BookOpen size={18} />}
        actions={
          <Link to="/app/playbooks/new"><Button size="sm"><Plus size={13} className="mr-1" />Yeni Playbook</Button></Link>
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya slug ara…" className="w-56" />
          <Select
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
            className="w-44"
          >
            <option value="">Tüm pack'ler</option>
            {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setPackId('') }}>Temizle</Button>
        </div>
      </Card>

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card className="overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
            {rows.length} playbook
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            onRowClick={(r) => navigate(`/app/playbooks/${r.id}/edit`)}
            empty={<EmptyState icon={<BookOpen size={24} />} title="Playbook bulunamadı" />}
          />
        </Card>
      </motion.div>
    </div>
  )
}
