import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { Target } from 'lucide-react'

// ── tipler ────────────────────────────────────────────────────────────────────

type OpStatus = 'active' | 'paused' | 'escalated' | 'done' | 'failed'
type EventKind = 'observe' | 'decide' | 'act' | 'escalate'

type Operation = {
  id:               string
  goal_text:        string
  domain_pack:      string
  status:           OpStatus
  risk:             string
  step_count:       number
  max_steps:        number
  cooldown_minutes: number
  last_tick_at:     string | null
  escalation_reason: string | null
  created_at:       string
  updated_at:       string
}

type OpEvent = {
  id:         string
  kind:       EventKind
  payload:    Record<string, unknown>
  created_at: string
}

// ── renk yardımcıları ─────────────────────────────────────────────────────────

type Tone = 'blue' | 'yellow' | 'red' | 'green' | 'gray'

function statusColor(s: OpStatus): Tone {
  switch (s) {
    case 'active':    return 'blue'
    case 'paused':    return 'yellow'
    case 'escalated': return 'red'
    case 'done':      return 'green'
    case 'failed':    return 'red'
    default:          return 'gray' as Tone
  }
}

function statusLabel(s: OpStatus): string {
  switch (s) {
    case 'active':    return 'Aktif'
    case 'paused':    return 'Duraklatıldı'
    case 'escalated': return 'Eskalasyon'
    case 'done':      return 'Tamamlandı'
    case 'failed':    return 'Başarısız'
    default:          return s
  }
}

function eventBadge(k: EventKind): Tone {
  switch (k) {
    case 'observe':  return 'gray'
    case 'decide':   return 'blue'
    case 'act':      return 'green'
    case 'escalate': return 'red'
    default:         return 'gray' as Tone
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('tr-TR')
}

// ── API yardımcıları ─────────────────────────────────────────────────────────

async function fetchOps(): Promise<Operation[]> {
  const { data, error } = await supabase
    .from('operations')
    .select('id, goal_text, domain_pack, status, risk, step_count, max_steps, cooldown_minutes, last_tick_at, escalation_reason, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as Operation[]
}

async function fetchEvents(operationId: string): Promise<OpEvent[]> {
  const { data, error } = await supabase
    .from('operation_events')
    .select('id, kind, payload, created_at')
    .eq('operation_id', operationId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as OpEvent[]
}

async function patchStatus(id: string, status: OpStatus) {
  const { error } = await supabase
    .from('operations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── bileşenler ────────────────────────────────────────────────────────────────

function EventTimeline({ events }: { events: OpEvent[] }) {
  if (events.length === 0)
    return <p className="px-4 py-3 text-xs text-white/30">Event yok</p>

  return (
    <ul className="divide-y divide-white/[0.04]">
      {events.map((ev) => {
        const action  = typeof ev.payload?.action  === 'string' ? ev.payload.action  : null
        const reason  = typeof ev.payload?.reason  === 'string' ? ev.payload.reason  : null
        const summary = action ?? reason ?? ev.kind
        return (
          <li key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
            <Badge tone={eventBadge(ev.kind)} className="mt-0.5 shrink-0 capitalize">
              {ev.kind}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-white/70">{summary}</p>
              <p className="text-[11px] text-white/30">{fmtDate(ev.created_at)}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function OpRow({
  op,
  expanded,
  events,
  acting,
  onToggle,
  onPause,
  onResume,
  onEnd,
}: {
  op:       Operation
  expanded: boolean
  events:   OpEvent[]
  acting:   string | null
  onToggle: () => void
  onPause:  () => void
  onResume: () => void
  onEnd:    () => void
}) {
  return (
    <Card className="overflow-hidden">
      {/* başlık satırı */}
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <Badge tone={statusColor(op.status)} className="mt-0.5 shrink-0">
          {statusLabel(op.status)}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">{op.goal_text}</p>
          <p className="mt-0.5 text-[11px] text-white/40">
            {op.domain_pack} · {op.step_count}/{op.max_steps} adım · {op.risk} · son tick: {fmtDate(op.last_tick_at)}
          </p>
          {op.escalation_reason && (
            <p className="mt-1 text-[11px] text-red-400/80">⚠ {op.escalation_reason}</p>
          )}
        </div>
        <span className="ml-2 text-xs text-white/30">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <>
          {/* aksiyon butonları */}
          <div className="flex gap-2 border-t border-white/[0.06] px-4 py-2">
            {op.status === 'active' && (
              <Button size="sm" variant="secondary" disabled={acting === op.id} onClick={onPause}>
                Duraklat
              </Button>
            )}
            {op.status === 'paused' && (
              <Button size="sm" variant="secondary" disabled={acting === op.id} onClick={onResume}>
                Devam Et
              </Button>
            )}
            {(op.status === 'active' || op.status === 'paused') && (
              <Button size="sm" variant="danger" disabled={acting === op.id} onClick={onEnd}>
                Sonlandır
              </Button>
            )}
          </div>

          {/* event timeline */}
          <div className="border-t border-white/[0.06]">
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-white/30">
              Son olaylar
            </div>
            <EventTimeline events={events} />
          </div>
        </>
      )}
    </Card>
  )
}

// ── yeni operasyon formu ──────────────────────────────────────────────────────

const EMPTY_FORM = { goal_text: '', domain_pack: 'market-intel', max_steps: 10, cooldown_minutes: 30 }

function NewOpForm({ onCreated }: { onCreated: () => void }) {
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [open,    setOpen]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.goal_text.trim()) return
    setSaving(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Oturum bulunamadı')
      const { error: insErr } = await supabase.from('operations').insert({
        owner_user_id:    user.id,
        goal_text:        form.goal_text.trim(),
        domain_pack:      form.domain_pack.trim() || 'market-intel',
        max_steps:        form.max_steps,
        cooldown_minutes: form.cooldown_minutes,
        status:           'active',
        step_count:       0,
        risk:             'R1',
      })
      if (insErr) throw insErr
      setForm(EMPTY_FORM)
      setOpen(false)
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + Yeni operasyon
      </Button>
    )
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-white/50">Hedef</label>
          <textarea
            rows={3}
            className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
            placeholder="Operasyon hedefini yaz…"
            value={form.goal_text}
            onChange={(e) => setForm((f) => ({ ...f, goal_text: e.target.value }))}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-white/50">Domain paketi</label>
            <input
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.domain_pack}
              onChange={(e) => setForm((f) => ({ ...f, domain_pack: e.target.value }))}
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs text-white/50">Max adım</label>
            <input
              type="number" min={1} max={100}
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.max_steps}
              onChange={(e) => setForm((f) => ({ ...f, max_steps: Number(e.target.value) }))}
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs text-white/50">Bekleme (dk)</label>
            <input
              type="number" min={1}
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.cooldown_minutes}
              onChange={(e) => setForm((f) => ({ ...f, cooldown_minutes: Number(e.target.value) }))}
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Oluştur'}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
            İptal
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ── ana sayfa ─────────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [ops,        setOps]        = useState<Operation[]>([])
  const [loading,    setLoading]    = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [eventsCache, setEventsCache] = useState<Record<string, OpEvent[]>>({})
  const [acting,     setActing]     = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    try { setOps(await fetchOps()) } catch { /* sessiz */ }
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  // Canlı yenileme — TedarikReportPage deseni
  useEffect(() => {
    if (!autoRefresh || !initialized || !user) return
    const t = setInterval(() => { fetchOps().then(setOps).catch(() => {}) }, 10_000)
    return () => clearInterval(t)
  }, [autoRefresh, initialized, user])

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!eventsCache[id]) {
      const evts = await fetchEvents(id).catch(() => [])
      setEventsCache((prev) => ({ ...prev, [id]: evts }))
    }
  }

  async function handleStatus(id: string, next: OpStatus) {
    setActing(id)
    try {
      await patchStatus(id, next)
      setOps((prev) => prev.map((o) => o.id === id ? { ...o, status: next } : o))
    } catch (err) {
      console.error(err)
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Operasyonlar"
        description="Kapalı döngü, çok adımlı otonom operasyonlar"
        icon={<Target size={18} />}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? 'Yükleniyor…' : 'Yenile'}
          </Button>
          <Button
            size="sm"
            variant={autoRefresh ? 'primary' : 'secondary'}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? 'Canlı ✓' : 'Canlı'}
          </Button>
        </div>
        <NewOpForm onCreated={load} />
      </div>

      {ops.length === 0 && !loading && (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-white/30">Henüz operasyon yok</p>
          <p className="mt-1 text-xs text-white/20">Yukarıdan yeni bir operasyon oluşturabilirsin.</p>
        </Card>
      )}

      <div className="space-y-3">
        {ops.map((op) => (
          <OpRow
            key={op.id}
            op={op}
            expanded={expandedId === op.id}
            events={eventsCache[op.id] ?? []}
            acting={acting}
            onToggle={() => toggleExpand(op.id)}
            onPause={() => handleStatus(op.id, 'paused')}
            onResume={() => handleStatus(op.id, 'active')}
            onEnd={() => handleStatus(op.id, 'done')}
          />
        ))}
      </div>
    </div>
  )
}
