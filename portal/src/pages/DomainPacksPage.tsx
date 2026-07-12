import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Globe } from 'lucide-react'

type DomainPackRow = {
  id: string
  name: string
  description: string | null
  tenant_id: string | null
  status: 'active' | 'draft' | 'archived'
  allowed_domains: string[]
  glossary_md: string | null
  regulatory_notes_md: string | null
  verifier_rubric_md: string | null
  meta: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

const STATUS_TONE: Record<string, 'green' | 'yellow' | 'gray'> = {
  active: 'green', draft: 'yellow', archived: 'gray',
}

export default function DomainPacksPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading,  setLoading]  = useState(false)
  const [rows,     setRows]     = useState<DomainPackRow[]>([])
  const [q,        setQ]        = useState('')
  const [err,      setErr]      = useState<string | null>(null)
  const [selected, setSelected] = useState<DomainPackRow | null>(null)
  const [togglingA2a, setTogglingA2a] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { init() }, [init])
  const canQuery = initialized && !!user

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    let query = supabase
      .from('domain_packs')
      .select('id,name,description,tenant_id,status,allowed_domains,glossary_md,regulatory_notes_md,verifier_rubric_md,meta,created_at,updated_at')
      .order('name')
    if (q.trim()) {
      const term = `%${q.trim()}%`
      query = query.or(`name.ilike.${term},id.ilike.${term}`)
    }
    const res = await query
    if (res.error) { setErr(res.error.message); setRows([]) }
    else setRows((res.data ?? []) as DomainPackRow[])
    setLoading(false)
  }, [canQuery, q])

  useEffect(() => { load() }, [load])

  async function toggleA2aPublic(pack: DomainPackRow) {
    setTogglingA2a(true); setErr(null)
    const next = !(pack.meta?.a2a_public === true)
    const meta = { ...(pack.meta ?? {}), a2a_public: next }
    const { error } = await supabase
      .from('domain_packs')
      .update({ meta, updated_at: new Date().toISOString() })
      .eq('id', pack.id)
    if (error) setErr(error.message)
    else {
      const updated = { ...pack, meta }
      setSelected(updated)
      setRows((prev) => prev.map((r) => (r.id === pack.id ? updated : r)))
    }
    setTogglingA2a(false)
  }

  function cardUrl(packId: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/.well-known/agent-card.json?pack=${encodeURIComponent(packId)}`
  }

  async function copyCardUrl(packId: string) {
    try {
      await navigator.clipboard.writeText(cardUrl(packId))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr('Panoya kopyalanamadı')
    }
  }

  const columns: Column<DomainPackRow>[] = [
    {
      key: 'name', header: 'Ad',
      render: (r) => <span className="font-medium text-white/80">{r.name}</span>,
    },
    {
      key: 'id', header: 'ID', width: '160px',
      render: (r) => <span className="font-mono text-xs text-white/35">{r.id}</span>,
    },
    {
      key: 'status', header: 'Durum', width: '90px',
      render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{r.status}</Badge>,
    },
    {
      key: 'allowed_domains', header: 'Domain', width: '80px',
      render: (r) => <Badge tone="blue">{String(r.allowed_domains?.length ?? 0)}</Badge>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Domain Pack'ler" description="Kurumsal alan tanımları" />

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pack ID veya ad ara…" className="w-64" />
          <Button variant="ghost" size="sm" onClick={() => setQ('')}>Temizle</Button>
        </div>
      </Card>

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
              {rows.length} pack
            </div>
            <DataTable
              columns={columns}
              rows={rows}
              loading={loading}
              onRowClick={(r) => setSelected(r)}
              empty={<EmptyState icon={<Globe size={24} />} title="Pack bulunamadı" />}
            />
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="p-4">
            {selected ? (
              <div className="space-y-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-white/90">{selected.name}</h2>
                    <p className="mt-0.5 font-mono text-xs text-white/35">{selected.id}</p>
                  </div>
                  <Badge tone={STATUS_TONE[selected.status] ?? 'gray'}>{selected.status}</Badge>
                </div>

                {selected.description && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-white/40">Açıklama</div>
                    <p className="text-white/65 leading-relaxed">{selected.description}</p>
                  </div>
                )}

                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 space-y-2">
                  <div className="text-xs font-medium text-white/50">A2A Agent Card (D4b)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={selected.meta?.a2a_public === true ? 'green' : 'gray'}>
                      {selected.meta?.a2a_public === true ? 'a2a_public' : 'gizli'}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={togglingA2a || selected.status !== 'active'}
                      onClick={() => void toggleA2aPublic(selected)}
                    >
                      {selected.meta?.a2a_public === true ? 'Kartı kapat' : 'Kartı yayınla'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyCardUrl(selected.id)}>
                      {copied ? 'Kopyalandı' : 'Card URL'}
                    </Button>
                  </div>
                  <p className="font-mono text-[11px] text-white/35 break-all">
                    {cardUrl(selected.id)}
                  </p>
                  <p className="text-[11px] text-white/35">
                    Keşif-only — POST /api/a2a şimdilik 501 (D4c).
                  </p>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-white/40">
                    İzinli Domain'ler ({selected.allowed_domains?.length ?? 0})
                  </div>
                  <div className="max-h-32 overflow-auto rounded-lg border border-white/[0.06] bg-black/20 p-2 font-mono text-xs text-white/50">
                    {(selected.allowed_domains ?? []).slice(0, 50).join('\n') || '—'}
                    {(selected.allowed_domains?.length ?? 0) > 50
                      ? '\n... +' + (selected.allowed_domains.length - 50)
                      : ''}
                  </div>
                </div>

                {selected.verifier_rubric_md && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-white/40">Verifier Rubric</div>
                    <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/20 p-2 text-xs text-white/50">
                      {selected.verifier_rubric_md}
                    </div>
                  </div>
                )}

                {selected.glossary_md && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-white/40">Glossary</div>
                    <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/20 p-2 text-xs text-white/50">
                      {selected.glossary_md}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                <Globe size={24} className="text-white/20" />
                <p className="text-sm text-white/35">Detay için sol listeden bir pack seç</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
