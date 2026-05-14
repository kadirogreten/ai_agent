import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

// Strateji §6.5: "Approval Queue: R2/R3 adımlarda insan onayını bekler, onay alana kadar çalışmayı durdurur"
// Strateji §7.2 Onay Kuralı:
//   R2 → Denetçi onayı + gerekçe
//   R3 → İnsan onayı zorunlu + geri alma planı
// KPI Hedef: Approval Queue P50 bekleme < 4 saat

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
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [pending, setPending] = useState<ApprovalItem[]>([])
  const [history, setHistory] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)
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
    // IP1.5b: Atomik RPC — approval_queue günceller + run_request re-queue (onay) veya fail (red)
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

  const pendingCount = pending.length

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">Approval Queue</span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300 border border-red-500/30">
                {pendingCount} bekliyor
              </span>
            )}
          </div>
          <div className="text-xs text-white/50">
            R2/R3 adımları onay bekliyor — KPI hedefi: P50 bekleme &lt;4 saat
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>Yenile</Button>
      </div>

      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}

      {/* Bekleyen Onaylar */}
      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
          Bekleyen Onaylar {pendingCount > 0 && <span className="ml-1 text-amber-400">({pendingCount})</span>}
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-white/50">Yükleniyor...</div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-medium text-emerald-400">Bekleyen onay yok</div>
            <div className="mt-1 text-xs text-white/40">Tüm R2/R3 adımlar onaylandı veya henüz tetiklenmedi.</div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {pending.map((item) => (
              <div key={item.id} className="p-4 space-y-3">
                {/* Başlık satırı */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono ${RISK_COLORS[item.risk_level]}`}>
                        {item.risk_level}
                      </span>
                      {item.agent_code && (
                        <span className="text-xs font-mono text-white/60 border border-white/10 rounded px-1.5 py-0.5">{item.agent_code}</span>
                      )}
                      {item.step_name && <span className="text-xs text-white/50">Adım: {item.step_name}</span>}
                    </div>
                    <div className="mt-1 text-sm text-white/90">{item.action_summary}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-amber-400/80">{timeUntilExpiry(item.expires_at)}</div>
                    <div className="text-xs text-white/30">{new Date(item.created_at).toLocaleString('tr-TR')}</div>
                  </div>
                </div>

                {/* Detay (opsiyonel) */}
                {item.action_detail && (
                  <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                    {JSON.stringify(item.action_detail, null, 2)}
                  </pre>
                )}

                {/* Not + Aksiyon */}
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    value={notes[item.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Geri alma planı / gerekçe notu (opsiyonel)"
                    className="flex-1 min-w-[200px] rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                  />
                  <Button
                    size="sm"
                    onClick={() => decide(item.id, 'approved')}
                    disabled={acting === item.id}
                    title="Onaylanırsa iş yeniden kuyruğa alınır ve allow_high_risk=true ile çalıştırılır"
                  >
                    {acting === item.id ? '...' : 'Onayla & Yeniden Kuyruğa Al'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => decide(item.id, 'rejected')}
                    disabled={acting === item.id}
                    title="Reddedilirse iş iptal edilir ve hata olarak işaretlenir"
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
          <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Geçmiş</div>
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#0B1020]">
                <tr className="border-b border-white/10 text-xs text-white/50">
                  <th className="px-4 py-2">Risk</th>
                  <th className="px-4 py-2">Ajan</th>
                  <th className="px-4 py-2">Özet</th>
                  <th className="px-4 py-2">Karar</th>
                  <th className="px-4 py-2">Not</th>
                  <th className="px-4 py-2">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono ${RISK_COLORS[item.risk_level]}`}>
                        {item.risk_level}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-white/60">{item.agent_code ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{item.action_summary.slice(0, 60)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={item.status === 'approved' ? 'green' : item.status === 'rejected' ? 'red' : 'yellow'}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-white/50">{item.reviewer_note ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-white/40">
                      {item.decided_at ? new Date(item.decided_at).toLocaleDateString('tr-TR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
