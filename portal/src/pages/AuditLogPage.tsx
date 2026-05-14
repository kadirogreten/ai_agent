import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

// IP1.6 Audit Log — Yol Haritası Faz 1
// 90 gün immutable retention; query latency P95 < 500 ms
// Strateji §2.4: "loglama, denetim, geri alma mekanizmaları"

const PAGE_SIZE = 100

type AuditRow = {
  id: string
  owner_user_id: string
  actor_type: 'user' | 'worker' | 'system' | 'agent'
  actor_id: string
  action: string
  resource_type: string | null
  resource_id: string | null
  risk_level: 'R0' | 'R1' | 'R2' | 'R3' | null
  severity: 'info' | 'warn' | 'error'
  detail: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

const SEVERITY_TONE: Record<string, 'green' | 'yellow' | 'red'> = {
  info:  'green',
  warn:  'yellow',
  error: 'red',
}

const RISK_COLORS: Record<string, string> = {
  R0: 'text-white/40',
  R1: 'text-blue-300',
  R2: 'text-amber-300',
  R3: 'text-red-300',
}

const ACTOR_COLORS: Record<string, string> = {
  user:   'bg-blue-500/10 text-blue-300 border-blue-500/20',
  worker: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  agent:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  system: 'bg-white/5 text-white/50 border-white/10',
}

type Filters = {
  q: string
  resourceType: string
  severity: string
  riskLevel: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = {
  q: '', resourceType: 'all', severity: 'all', riskLevel: 'all', from: '', to: '',
}

function ExpandableDetail({ detail }: { detail: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false)
  if (!detail) return <span className="text-white/20">—</span>
  return (
    <span>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-blue-400 hover:underline"
      >
        {open ? 'kapat ▲' : 'detay ▼'}
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded border border-white/10 bg-black/20 p-2 text-xs text-white/60">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </span>
  )
}

export default function AuditLogPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows,    setRows]    = useState<AuditRow[]>([])
  const [total,   setTotal]   = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [cursor,  setCursor]  = useState<string | null>(null)   // created_at of last row
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => { init() }, [init])

  const stableFilters = useMemo(() => filters, [filters])

  const load = useCallback(async (afterCursor?: string) => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)

    let q = supabase
      .from('audit_log')
      .select('*', afterCursor ? undefined : { count: 'exact' })
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE + 1)  // +1 để detect hasMore

    if (stableFilters.resourceType !== 'all') q = q.eq('resource_type', stableFilters.resourceType)
    if (stableFilters.severity    !== 'all') q = q.eq('severity',      stableFilters.severity)
    if (stableFilters.riskLevel   !== 'all') q = q.eq('risk_level',    stableFilters.riskLevel)
    if (stableFilters.from)                  q = q.gte('created_at',   stableFilters.from)
    if (stableFilters.to)                    q = q.lte('created_at',   stableFilters.to)
    if (stableFilters.q.trim()) {
      const term = `%${stableFilters.q.trim()}%`
      q = q.or(`action.ilike.${term},actor_id.ilike.${term},resource_type.ilike.${term}`)
    }
    if (afterCursor) {
      q = q.lt('created_at', afterCursor)
    }

    const { data, error, count } = await q

    if (error) {
      setErr(error.message)
      setLoading(false)
      return
    }

    const fetched = (data ?? []) as AuditRow[]
    const more    = fetched.length > PAGE_SIZE
    const page    = more ? fetched.slice(0, PAGE_SIZE) : fetched

    if (afterCursor) {
      setRows((prev) => [...prev, ...page])
    } else {
      setRows(page)
      if (count !== null) setTotal(count)
    }
    setHasMore(more)
    setCursor(page.length > 0 ? page[page.length - 1].created_at : null)
    setLoading(false)
  }, [initialized, user, stableFilters])

  // filtre değişince sıfırdan yükle
  useEffect(() => {
    setCursor(null)
    setRows([])
    load()
  }, [load])

  function handleExport() {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function setFilter<K extends keyof Filters>(key: K, val: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: val }))
  }

  const errorCount = rows.filter((r) => r.severity === 'error').length
  const warnCount  = rows.filter((r) => r.severity === 'warn').length
  const r3Count    = rows.filter((r) => r.risk_level === 'R3').length

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Audit Log</div>
          <div className="text-xs text-white/50">
            90 gün immutable denetim kaydı — tüm R0–R3 eylemler
            {total !== null && <span className="ml-2 text-white/30">toplam {total.toLocaleString()} kayıt</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} disabled={loading}>Yenile</Button>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>Dışa Aktar</Button>
        </div>
      </div>

      {/* Özet rozetler */}
      {(errorCount > 0 || warnCount > 0 || r3Count > 0) && (
        <div className="flex gap-2 flex-wrap">
          {errorCount > 0 && (
            <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
              {errorCount} error
            </span>
          )}
          {warnCount > 0 && (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
              {warnCount} warn
            </span>
          )}
          {r3Count > 0 && (
            <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
              {r3Count} R3 eylem
            </span>
          )}
        </div>
      )}

      {/* Filtreler */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/50">Arama (eylem / aktör / kaynak)</div>
            <Input
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="run.start, approval…"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-white/50">Kaynak Türü</div>
            <select
              value={filters.resourceType}
              onChange={(e) => setFilter('resourceType', e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="all">Tümü</option>
              <option value="run">run</option>
              <option value="run_request">run_request</option>
              <option value="agent">agent</option>
              <option value="bundle">bundle</option>
              <option value="fact">fact</option>
              <option value="approval_queue">approval_queue</option>
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-white/50">Şiddet</div>
            <select
              value={filters.severity}
              onChange={(e) => setFilter('severity', e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="all">Tümü</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-white/50">Risk</div>
            <select
              value={filters.riskLevel}
              onChange={(e) => setFilter('riskLevel', e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="all">Tümü</option>
              <option value="R0">R0</option>
              <option value="R1">R1</option>
              <option value="R2">R2</option>
              <option value="R3">R3</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="w-full"
            >
              Temizle
            </Button>
          </div>

          <div>
            <div className="mb-1 text-xs text-white/50">Başlangıç (ISO)</div>
            <Input
              value={filters.from}
              onChange={(e) => setFilter('from', e.target.value)}
              placeholder="2026-05-01"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/50">Bitiş (ISO)</div>
            <Input
              value={filters.to}
              onChange={(e) => setFilter('to', e.target.value)}
              placeholder="2026-05-31"
            />
          </div>
        </div>
      </Card>

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      )}

      {/* Tablo */}
      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
          Kayıtlar
          {rows.length > 0 && <span className="ml-2 text-xs text-white/40">{rows.length} gösteriliyor</span>}
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-white/50">
                <th className="px-4 py-2 whitespace-nowrap">Zaman</th>
                <th className="px-4 py-2">Aktör</th>
                <th className="px-4 py-2">Eylem</th>
                <th className="px-4 py-2">Kaynak</th>
                <th className="px-4 py-2">Risk</th>
                <th className="px-4 py-2">Şiddet</th>
                <th className="px-4 py-2">Detay</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td className="px-4 py-4 text-white/50" colSpan={7}>Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-4 text-center text-white/40" colSpan={7}>Kayıt yok</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-white/40">
                      {new Date(row.created_at).toLocaleString('tr-TR', {
                        month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono ${ACTOR_COLORS[row.actor_type] ?? ''}`}>
                        {row.actor_type}
                      </span>
                      <div className="mt-0.5 font-mono text-white/50 truncate max-w-[10rem]" title={row.actor_id}>
                        {row.actor_id.length > 16 ? row.actor_id.slice(0, 8) + '…' : row.actor_id}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-white/80">{row.action}</td>
                    <td className="px-4 py-2">
                      {row.resource_type ? (
                        <>
                          <span className="text-white/60">{row.resource_type}</span>
                          {row.resource_id && (
                            <div className="font-mono text-white/30" title={row.resource_id}>
                              {row.resource_id.slice(0, 8)}…
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {row.risk_level ? (
                        <span className={`font-mono font-semibold ${RISK_COLORS[row.risk_level] ?? ''}`}>
                          {row.risk_level}
                        </span>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={SEVERITY_TONE[row.severity] ?? 'yellow'}>
                        {row.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 max-w-[200px]">
                      <ExpandableDetail detail={row.detail} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Daha fazla yükle */}
        {hasMore && (
          <div className="border-t border-white/10 px-4 py-3 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => cursor && load(cursor)}
              disabled={loading}
            >
              {loading ? 'Yükleniyor...' : `Daha fazla yükle (${PAGE_SIZE}'er)`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
