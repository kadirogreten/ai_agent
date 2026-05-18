import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { List, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'

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
  if (s === 'fail')    return 'red'
  return 'yellow'
}

function StatusIcon({ status }: { status: RunRow['status'] }) {
  if (status === 'success') return <CheckCircle size={13} className="text-emerald-400" />
  if (status === 'fail')    return <XCircle size={13} className="text-red-400" />
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
    </span>
  )
}

export default function RunsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const navigate    = useNavigate()

  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<RunRow[]>([])
  const [q,       setQ]       = useState('')
  const [status,  setStatus]  = useState<'all' | RunRow['status']>('all')
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const canQuery = initialized && !!user
  const filters  = useMemo(() => ({ q, status, from, to }), [q, status, from, to])

  const load = useCallback(async () => {
    if (!canQuery || !user) return
    setLoading(true); setErr(null)
    let query = supabase
      .from('runs')
      .select('id,external_id,title,status,started_at,finished_at,created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.from)             query = query.gte('created_at', filters.from)
    if (filters.to)               query = query.lte('created_at', filters.to)
    if (filters.q.trim()) {
      const t = `%${filters.q.trim()}%`
      query = query.or(`title.ilike.${t},external_id.ilike.${t}`)
    }

    const res = await query
    if (res.error) { setErr(res.error.message); setRows([]) }
    else           { setRows((res.data ?? []) as RunRow[]) }
    setLoading(false)
  }, [canQuery, filters.from, filters.q, filters.status, filters.to, user])

  useEffect(() => { load() }, [load])

  const columns: Column<RunRow>[] = [
    {
      key: 'status', header: 'Durum', width: '100px',
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusIcon status={r.status} />
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
        </div>
      ),
    },
    {
      key: 'title', header: 'Başlık',
      render: (r) => (
        <span className="font-medium text-white/80">{r.title ?? r.external_id ?? r.id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'external_id', header: 'External ID', width: '180px',
      render: (r) => <span className="font-mono text-xs text-white/35">{r.external_id ?? '—'}</span>,
    },
    {
      key: 'created_at', header: 'Tarih', width: '140px',
      render: (r) => <span className="text-xs text-white/35">{new Date(r.created_at).toLocaleString('tr-TR')}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Runs"
        description="Tüm agent çalıştırmaları"
        actions={
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
            <RefreshCw size={12} /> Yenile
          </button>
        }
      />

      {/* Filtreler */}
      <Card className="p-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Başlık veya external ID ara…" />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-blue-500/60"
          >
            <option value="all">Tüm durumlar</option>
            <option value="success">success</option>
            <option value="fail">fail</option>
            <option value="running">running</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus('all'); setFrom(''); setTo('') }}>
            Temizle
          </Button>
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Başlangıç (2026-01-01)" />
          <Input value={to}   onChange={(e) => setTo(e.target.value)}   placeholder="Bitiş (2026-12-31)" />
        </div>
      </Card>

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white/70">
            <List size={14} />
            <span>{rows.length} kayıt</span>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={(r) => navigate(`/app/runs/${r.id}`)}
          empty={<EmptyState icon={<List size={24} />} title="Run bulunamadı" description="Filtrelerinizi değiştirmeyi deneyin" />}
        />
      </Card>
    </div>
  )
}
