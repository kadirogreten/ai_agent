import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { CheckCircle, Clock, CheckSquare } from 'lucide-react'
import { ApprovalDetailCard } from '@/components/approval/ApprovalDetailCard'

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
  // join ile doldurulur — DB kolonları değil
  operation_goal?: string | null
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

  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const highlightRef = useRef<HTMLDivElement | null>(null)

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

    // İki-adımlı join: run_request_id → operation_id → goal_text
    const runIds = [...new Set(all.map((x) => x.run_request_id).filter(Boolean))] as string[]
    const goalMap = new Map<string, string | null>()
    if (runIds.length > 0) {
      const { data: runs } = await supabase
        .from('run_requests')
        .select('id, operation_id')
        .in('id', runIds)

      const opIds = [...new Set((runs ?? []).map((r: { id: string; operation_id: string | null }) => r.operation_id).filter(Boolean))] as string[]
      const runToOp = new Map<string, string | null>((runs ?? []).map((r: { id: string; operation_id: string | null }) => [r.id, r.operation_id]))

      const opGoalMap = new Map<string, string>()
      if (opIds.length > 0) {
        const { data: ops } = await supabase
          .from('operations')
          .select('id, goal_text')
          .in('id', opIds)
        ;(ops ?? []).forEach((o: { id: string; goal_text: string }) => opGoalMap.set(o.id, o.goal_text))
      }

      runIds.forEach((rid) => {
        const opId = runToOp.get(rid) ?? null
        goalMap.set(rid, opId ? (opGoalMap.get(opId) ?? null) : null)
      })
    }

    const enriched = all.map((x) => ({
      ...x,
      operation_goal: x.run_request_id ? (goalMap.get(x.run_request_id) ?? null) : null,
    }))

    setPending(enriched.filter((x) => x.status === 'pending'))
    setHistory(enriched.filter((x) => x.status !== 'pending'))
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setActing(id)
    setErr(null)
    // decide_approval: hem job-seviye hem tool-seviye (run_request_id NULL, ör. purchase_order) gate'leri onaylar.
    const { error } = await supabase.rpc('decide_approval', {
      p_approval_id:   id,
      p_reviewer_id:   user?.id,
      p_decision:      decision,
      p_reviewer_note: notes[id] ?? null,
    })
    if (error) { setErr(error.message) }
    else {
      // Optimistic: nav rozeti 60sn polling'i beklemeden anında düşür
      window.dispatchEvent(new CustomEvent('approval-decided'))
      await load()
    }
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
        icon={<CheckSquare size={18} />}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            Yenile
          </Button>
        }
      />

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Bekleyen Onaylar */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60 flex items-center gap-2">
            Bekleyen Onaylar
            {pendingCount > 0 && (
              <Badge tone="yellow">{pendingCount}</Badge>
            )}
          </div>

          {loading && pending.length === 0 ? (
            <div className="space-y-3 px-4 py-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-5 animate-pulse rounded-full bg-white/[0.05]" style={{ width: `${50 + i * 15}%` }} />
              ))}
            </div>
          ) : pending.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="flex flex-col items-center gap-2">
                <CheckCircle size={24} className="text-emerald-400/40" />
                <span className="text-sm font-medium text-emerald-400">Bekleyen onay yok</span>
                <span className="text-xs text-white/40">Tüm R2/R3 adımlar onaylandı veya henüz tetiklenmedi.</span>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {pending.map((item) => (
                <div
                  key={item.id}
                  ref={item.id === highlightId ? (el) => { highlightRef.current = el; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } : undefined}
                  className={`p-4 space-y-3 transition-colors ${item.id === highlightId ? 'bg-yellow-500/10 border-l-2 border-yellow-400' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono ${RISK_COLORS[item.risk_level]}`}>
                          {item.risk_level}
                        </span>
                        {item.agent_code && (
                          <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-xs text-white/50">{item.agent_code}</span>
                        )}
                        {item.step_name && <span className="text-xs text-white/40">Adım: {item.step_name}</span>}
                        {/* Operasyon etiketi */}
                        {item.operation_goal != null ? (
                          <span className="rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-300 truncate max-w-[200px]" title={item.operation_goal}>
                            🎯 {item.operation_goal.length > 40 ? item.operation_goal.slice(0, 40) + '…' : item.operation_goal}
                          </span>
                        ) : (
                          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-xs text-white/30">tekil iş</span>
                        )}
                      </div>
                      <div className="mt-1.5 text-sm text-white/80">{item.action_summary}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="flex items-center gap-1 text-xs text-amber-400/70">
                        <Clock size={12} /> {timeUntilExpiry(item.expires_at)}
                      </div>
                      <div className="mt-0.5 text-xs text-white/25">{new Date(item.created_at).toLocaleString('tr-TR')}</div>
                    </div>
                  </div>

                  {/* action_detail — slug'a göre özel kart veya generic key-value */}
                  <ApprovalDetailCard item={item} />

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
      </motion.div>

      {/* Geçmiş */}
      {history.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
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
        </motion.div>
      )}
    </div>
  )
}
