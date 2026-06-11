import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { Target } from 'lucide-react'

// ── tipler ────────────────────────────────────────────────────────────────────

type OpStatus = 'active' | 'paused' | 'escalated' | 'done' | 'failed'
type EventKind = 'observe' | 'decide' | 'act' | 'escalate' | 'kpi_summary'

type IntentJson = {
  beneficiary:      string
  success_criteria: string
  forbidden_tools?: string[]
  forbidden_topics?: string[]
  max_total_spend?: number
  expires_at?:      string
}

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
  intent_json:      IntentJson | null
  created_at:       string
  updated_at:       string
}

type OpEvent = {
  id:         string
  kind:       EventKind
  payload:    Record<string, unknown>
  created_at: string
}

type KpiSummary = {
  tick_count:        number
  human_touch_count: number
  error_count:       number
  total_duration_min: number
  playbooks_run:     string[]
}

type DomainPack = { id: string; name: string }
type BudgetScope = { id: string; scope: string; period: string }

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
    case 'observe':     return 'gray'
    case 'decide':      return 'blue'
    case 'act':         return 'green'
    case 'escalate':    return 'red'
    case 'kpi_summary': return 'yellow'
    default:            return 'gray' as Tone
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
    .select('id, goal_text, domain_pack, status, risk, step_count, max_steps, cooldown_minutes, last_tick_at, escalation_reason, intent_json, created_at, updated_at')
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

/** Escalated operasyonu active'e döndürür ve event yazar. */
async function resumeFromEscalated(opId: string) {
  const { error } = await supabase
    .from('operations')
    .update({ status: 'active', escalation_reason: null, updated_at: new Date().toISOString() })
    .eq('id', opId)
  if (error) throw error

  await supabase.from('operation_events').insert({
    operation_id: opId,
    kind:         'act',
    payload:      { action: 'resumed_by_user' },
  })
}

/** Tüm kullanıcının bekleyen onaylarını yükler; operation_id → [approvalId] haritası döner. */
async function fetchPendingByOp(userId: string): Promise<Record<string, string[]>> {
  // 1) pending approval_queue satırları
  const { data: aqRows } = await supabase
    .from('approval_queue')
    .select('id, run_request_id')
    .eq('owner_user_id', userId)
    .eq('status', 'pending')

  if (!aqRows || aqRows.length === 0) return {}

  const runIds = (aqRows as Array<{ id: string; run_request_id: string | null }>)
    .map((r) => r.run_request_id)
    .filter((id): id is string => !!id)

  if (runIds.length === 0) return {}

  // 2) run_requests.operation_id bağı (run_requests.operation_id kolonu — PR3)
  const { data: runRows } = await supabase
    .from('run_requests')
    .select('id, operation_id')
    .in('id', runIds)

  if (!runRows) return {}

  const runToOp: Record<string, string> = {}
  for (const rr of runRows as Array<{ id: string; operation_id: string | null }>) {
    if (rr.operation_id) runToOp[rr.id] = rr.operation_id
  }

  const map: Record<string, string[]> = {}
  for (const aq of aqRows as Array<{ id: string; run_request_id: string | null }>) {
    const opId = aq.run_request_id ? runToOp[aq.run_request_id] : undefined
    if (!opId) continue
    if (!map[opId]) map[opId] = []
    map[opId].push(aq.id)
  }
  return map
}

// ── KPI Kartı ─────────────────────────────────────────────────────────────────

function KpiCard({ kpi }: { kpi: KpiSummary }) {
  return (
    <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30">KPI Özeti</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Süre', value: `${kpi.total_duration_min.toFixed(0)} dk` },
          { label: 'Tick',  value: String(kpi.tick_count) },
          { label: 'İnsan Dokunuşu', value: String(kpi.human_touch_count) },
          { label: 'Hata', value: String(kpi.error_count) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded bg-white/[0.04] px-3 py-2">
            <p className="text-[10px] text-white/40">{label}</p>
            <p className="text-sm font-semibold text-white/90">{value}</p>
          </div>
        ))}
      </div>
      {kpi.playbooks_run.length > 0 && (
        <p className="text-xs text-white/40">
          Playbook'lar: <span className="text-white/60">{kpi.playbooks_run.join(' → ')}</span>
        </p>
      )}
    </div>
  )
}

// ── EventTimeline ─────────────────────────────────────────────────────────────

function EventTimeline({ events }: { events: OpEvent[] }) {
  const visible = events.filter((e) => e.kind !== 'kpi_summary')
  if (visible.length === 0)
    return <p className="px-4 py-3 text-xs text-white/30">Event yok</p>

  return (
    <ul className="divide-y divide-white/[0.04]">
      {visible.map((ev) => {
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

// ── OpRow ─────────────────────────────────────────────────────────────────────

function OpRow({
  op,
  expanded,
  events,
  acting,
  pendingApprovals,
  onToggle,
  onPause,
  onResume,
  onEnd,
  onResumeEscalated,
  onReload,
}: {
  op:               Operation
  expanded:         boolean
  events:           OpEvent[]
  acting:           string | null
  pendingApprovals: string[]
  onToggle:         () => void
  onPause:          () => void
  onResume:         () => void
  onEnd:            () => void
  onResumeEscalated: () => void
  onReload:         () => void
}) {
  const navigate = useNavigate()

  const kpiEvent = events.find((e) => e.kind === 'kpi_summary')
  const kpi: KpiSummary | null = kpiEvent
    ? (kpiEvent.payload as unknown as KpiSummary)
    : null

  const pendingCount = pendingApprovals.length

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

        {/* Bekleyen onay rozeti */}
        {pendingCount > 0 && (
          <button
            className="ml-1 mt-0.5 shrink-0 rounded bg-yellow-500/20 px-2 py-0.5 text-[11px] font-semibold text-yellow-300 hover:bg-yellow-500/30 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              const firstId = pendingApprovals[0]
              navigate(`/app/approval-queue?highlight=${firstId}`)
            }}
          >
            {pendingCount} onay ⟶
          </button>
        )}

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
            {op.status === 'escalated' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={acting === op.id}
                onClick={onResumeEscalated}
              >
                Düzelt ve devam et
              </Button>
            )}
            {(op.status === 'active' || op.status === 'paused') && (
              <Button size="sm" variant="danger" disabled={acting === op.id} onClick={onEnd}>
                Sonlandır
              </Button>
            )}
          </div>

          {/* Intent kartı — intent_json varsa göster */}
          {op.intent_json && (
            <div className="mx-4 mb-3 rounded border border-white/[0.08] bg-white/[0.03] p-3 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Intent Sözleşmesi</p>
              <p className="text-xs text-white/70"><span className="text-white/40">Yararlanıcı:</span> {op.intent_json.beneficiary}</p>
              <p className="text-xs text-white/70"><span className="text-white/40">Başarı kriteri:</span> {op.intent_json.success_criteria}</p>
              {op.intent_json.forbidden_tools?.length ? (
                <p className="text-xs text-white/70"><span className="text-white/40">Yasak araçlar:</span> {op.intent_json.forbidden_tools.join(', ')}</p>
              ) : null}
              {op.intent_json.max_total_spend != null && (
                <p className="text-xs text-white/70"><span className="text-white/40">Harcama tavanı:</span> ${op.intent_json.max_total_spend}</p>
              )}
              {op.intent_json.expires_at && (
                <p className="text-xs text-white/70"><span className="text-white/40">Vade:</span> {new Date(op.intent_json.expires_at).toLocaleString('tr-TR')}</p>
              )}
            </div>
          )}

          {/* KPI kartı — done veya escalated + kpi_summary event varsa */}
          {kpi && (op.status === 'done' || op.status === 'escalated' || op.status === 'failed') && (
            <KpiCard kpi={kpi} />
          )}

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

const EMPTY_FORM = {
  goal_text:        '',
  domain_pack:      '',
  max_steps:        10,
  cooldown_minutes: 30,
  budget_scope:     '',
  // intent alanları
  intent_beneficiary:      '',
  intent_success_criteria: '',
  intent_expires_at:       '',
}

function NewOpForm({ onCreated }: { onCreated: () => void }) {
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [open,    setOpen]    = useState(false)
  const [packs,   setPacks]   = useState<DomainPack[]>([])
  const [budgets, setBudgets] = useState<BudgetScope[]>([])

  useEffect(() => {
    if (!open) return
    // domain_packs tablosundan seçici
    supabase.from('domain_packs').select('id, name').order('name').then(({ data }) => {
      if (data) setPacks(data as DomainPack[])
    })
    // mevcut bütçe scope'ları
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('operation_budgets')
        .select('id, scope, period')
        .eq('owner_user_id', user.id)
        .then(({ data }) => { if (data) setBudgets(data as BudgetScope[]) })
    })
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.goal_text.trim() || !form.domain_pack) return
    if (!form.intent_beneficiary.trim() || !form.intent_success_criteria.trim()) {
      setError('Intent yararlanıcı ve başarı kriteri zorunlu')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Oturum bulunamadı')

      const contextJson = form.budget_scope ? { budget_scope: form.budget_scope } : undefined
      const intentJson: IntentJson = {
        beneficiary:      form.intent_beneficiary.trim(),
        success_criteria: form.intent_success_criteria.trim(),
        ...(form.intent_expires_at ? { expires_at: new Date(form.intent_expires_at).toISOString() } : {}),
      }

      const resp = await fetch('/api/operations', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          goal_text:        form.goal_text.trim(),
          domain_pack:      form.domain_pack,
          max_steps:        form.max_steps,
          cooldown_minutes: form.cooldown_minutes,
          risk:             'R1',
          intent_json:      intentJson,
          ...(contextJson ? { context_json: contextJson } : {}),
        }),
      })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Operasyon oluşturulamadı')
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
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <label className="mb-1 block text-xs text-white/50">Domain paketi</label>
            <select
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.domain_pack}
              onChange={(e) => setForm((f) => ({ ...f, domain_pack: e.target.value }))}
              required
            >
              <option value="" disabled>Seç…</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
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
        {budgets.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-white/50">Bütçe bağla (opsiyonel)</label>
            <select
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.budget_scope}
              onChange={(e) => setForm((f) => ({ ...f, budget_scope: e.target.value }))}
            >
              <option value="">— bütçe yok —</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.scope}>{b.scope} ({b.period})</option>
              ))}
            </select>
          </div>
        )}
        {/* PR9 Intent sözleşmesi */}
        <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
          <p className="text-xs font-semibold text-white/50">Intent Sözleşmesi</p>
          <div>
            <label className="mb-1 block text-xs text-white/50">Yararlanıcı *</label>
            <input
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder="ör. tedarik-ekibi, ceo@firma.com"
              value={form.intent_beneficiary}
              onChange={(e) => setForm((f) => ({ ...f, intent_beneficiary: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Başarı kriteri *</label>
            <input
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder="ör. 3 tedarikçi teklifi alınmış"
              value={form.intent_success_criteria}
              onChange={(e) => setForm((f) => ({ ...f, intent_success_criteria: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Vade tarihi (opsiyonel)</label>
            <input
              type="datetime-local"
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-white/20"
              value={form.intent_expires_at}
              onChange={(e) => setForm((f) => ({ ...f, intent_expires_at: e.target.value }))}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !form.domain_pack || !form.intent_beneficiary || !form.intent_success_criteria}>
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

  const [ops,          setOps]          = useState<Operation[]>([])
  const [loading,      setLoading]      = useState(false)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [eventsCache,  setEventsCache]  = useState<Record<string, OpEvent[]>>({})
  const [acting,       setActing]       = useState<string | null>(null)
  const [autoRefresh,  setAutoRefresh]  = useState(true)
  const [pendingByOp,  setPendingByOp]  = useState<Record<string, string[]>>({})

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    try {
      const [newOps, pending] = await Promise.all([
        fetchOps(),
        fetchPendingByOp(user.id),
      ])
      setOps(newOps)
      setPendingByOp(pending)
    } catch { /* sessiz */ }
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!autoRefresh || !initialized || !user) return
    const t = setInterval(() => {
      Promise.all([fetchOps(), fetchPendingByOp(user.id)])
        .then(([newOps, pending]) => { setOps(newOps); setPendingByOp(pending) })
        .catch(() => {})
    }, 10_000)
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

  async function handleResumeEscalated(id: string) {
    setActing(id)
    try {
      await resumeFromEscalated(id)
      setOps((prev) => prev.map((o) => o.id === id ? { ...o, status: 'active', escalation_reason: null } : o))
      // Events cache'ini temizle — yeni event yazıldı
      setEventsCache((prev) => { const next = { ...prev }; delete next[id]; return next })
      // Yeni events yükle
      const evts = await fetchEvents(id).catch(() => [])
      setEventsCache((prev) => ({ ...prev, [id]: evts }))
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
            pendingApprovals={pendingByOp[op.id] ?? []}
            onToggle={() => toggleExpand(op.id)}
            onPause={() => handleStatus(op.id, 'paused')}
            onResume={() => handleStatus(op.id, 'active')}
            onEnd={() => handleStatus(op.id, 'done')}
            onResumeEscalated={() => handleResumeEscalated(op.id)}
            onReload={load}
          />
        ))}
      </div>
    </div>
  )
}
