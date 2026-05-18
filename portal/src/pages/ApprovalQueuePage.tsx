import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Clock } from 'lucide-react'

type ApprovalItem = {
  id: string
  run_request_id: string | null
  step_index: number
  step_name: string | null
  agent_code: string | null
  risk_level: 'R2' | 'R3'
  action_summary: string
  action_detail: Record<string, unknown> | null
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  reviewer_note: string | null
  decided_at: string | null
  expires_at: string
  created_at: string
}

const RISK_COLORS: Record<string, string> = {
  R2: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  R3: 'bg-red-500/20 text-red-300 border-red-500/30',
}

function timeUntilExpiry(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'Süresi doldu'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return `${h}s ${m}d kaldı`
}

export default function ApprovalQueuePage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [pending,  setPending]  = useState<ApprovalItem[]>([])
  const [history,  setHistory]  = useState<ApprovalItem[]>([])
  const [loading,  setLoading]  = useState(false)
  const [acting,   setActing]   = useState<string | null>(null)
  const [notes,    setNotes]    = useState<Record<string, string>>({})
  const [err,      setErr]      = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
    const { data, error } = await supabase
      .from('approval_queue')
      .select('*')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) { setErr(error.message); setLoading(false); return }
    const all = (data ?? []) as ApprovalItem[]
    setPending(all.filter((x) => x.status === 'pending'))
    setHistory(all.filter((x) => x.status !== 'pending'))
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setActing(id)
    setErr(null)
    const rpc = decision === 'approved' ? 'approve_run_request' : 'reject_run_request'
    const { error } = await supabase.rpc(rpc, {
      p_approval_id:   id,
      p_reviewer_id:   user?.id,
      p_reviewer_note: notes[id] ?? null,
    })
    if (error) { setErr(error.message) }
    else { await load() }
    setActing(null)
  }

  const historyColumns: Column<ApprovalItem>[] = [
    {
      key: 'risk_level', header: 'Risk', width: '70px',
      render: (r) => (
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono ${RISK_COLORS[r.risk_level]}`}>
          {r.risk_level}
        </span>
      ),
    },
    {
      key: 'agent_code', header: 'Ajan', width: '100px',
      render: (r) => <span className="font-mono text-xs text-white/50">{r.agent_code ?? '—'}</span>,
    },
    {
      key: 'action_summary', header: 'Özet',
      render: (r) => <span className="text-xs text-white/70">{r.action_summary.slice(0, 60)}</span>,
    },
    {
      key: 'status', header: 'Karar', width: '90px',
      render: (r) => (
        <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'reviewer_note', header: 'Not', width: '120px',
      render: (r) => <span className="text-xs text-white/40">{r.reviewer_note ?? '—'}</span>,
    },
    {
      key: 'decided_at', header: 'Tarih', width: '100px',
      render: (r) => <span className="text-xs text-white/30">{r.decided_at ? new Date(r.decided_at).toLocaleDateString('tr-TR') : '—'}</span>,
    },
  ]

  const pendingCount = pending.length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approval Queue"
        description="R2/R3 adımları onay bekliyor — KPI hedefi: P50 <4 saat"
        actions={
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
            Yenile
          </button>
        }
      />

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      {/* Bekleyen Onaylar */}
      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
          Bekleyen Onaylar
          {pendingCount > 0 && <span className="ml-2 text-amber-400">({pendingCount})</span>}
        </div>

        {loading && pending.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-white/40">Yükleniyor...</div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <CheckCircle size={24} className="text-emerald-400/40" />
              <span className="text-sm font-medium text-emerald-400">Bekleyen onay yok</span>
              <span className="text-xs text-white/40">Tüm R2/R3 adımlar onaylandı veya henüz tetiklenmedi.</span>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {pending.map((item) => (
              <div key={item.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono ${RISK_COLORS[item.risk_level]}`}>
                        {item.risk_level}
                      </span>
                      {item.agent_code && (
                        <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-xs text-white/50">{item.agent_code}</span>
                      )}
                      {item.step_name && <span className="text-xs text-white/40">Adım: {item.step_name}</span>}
                    </div>
                    <div className="mt-1 text-sm text-white/80">{item.action_summary}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-1 text-xs text-amber-400/70">
                      <Clock size={12} /> {timeUntilExpiry(item.expires_at)}
                    </div>
                    <div className="mt-0.5 text-xs text-white/25">{new Date(item.created_at).toLocaleString('tr-TR')}</div>
                  </div>
                </div>

                {item.action_detail && (
                  <pre className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-white/40">
                    {JSON.stringify(item.action_detail, null, 2)}
                  </pre>
                )}

                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={notes[item.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Geri alma planı / gerekçe notu (opsiyonel)"
                    className="flex-1 min-w-[200px] rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white outline-none focus:border-blue-500/60"
                  />
                  <Button
                    size="sm"
                    onClick={() => decide(item.id, 'approved')}
                    disabled={acting === item.id}
                  >
                    {acting === item.id ? '...' : 'Onayla'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => decide(item.id, 'rejected')}
                    disabled={acting === item.id}
                  >
                    Reddet
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Geçmiş */}
      {history.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
            {history.length} Geçmiş Karar
          </div>
          <DataTable
            columns={historyColumns}
            rows={history}
            loading={false}
            empty={<div />}
          />
        </Card>
      )}
    </div>
  )
}
