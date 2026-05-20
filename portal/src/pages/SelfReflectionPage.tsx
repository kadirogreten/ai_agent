import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import {
  listSelfReflectionSignals,
  markSelfReflectionApplied,
  type SelfReflectionSignal,
} from '@/lib/selfReflection'
import { Brain, CheckCircle2, AlertCircle, Clock } from 'lucide-react'

/**
 * Kapı 4 — Öz-Yansımalı Otonomi paneli.
 * selfReflectionTick.ts'in haftalık ürettiği iyileştirme sinyallerini gösterir;
 * kullanıcı CEO'nun önerdiği değişiklikleri inceleyip "uygulandı" işaretler.
 */
export default function SelfReflectionPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const canQuery    = initialized && !!user

  const [rows, setRows]       = useState<SelfReflectionSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    const res = await listSelfReflectionSignals(100)
    if (res.error) setErr(res.error); else setRows(res.data)
    setLoading(false)
  }, [canQuery])

  useEffect(() => { load() }, [load])

  async function onApply(id: string) {
    setApplyingId(id)
    const res = await markSelfReflectionApplied(id, 'CEO önerisi incelendi ve uygulandı')
    setApplyingId(null)
    if (res.error) setErr(res.error)
    else await load()
  }

  const pendingSignals  = rows.filter((r) => r.status === 'pending' || r.status === 'running')
  const completedSignals = rows.filter((r) => r.status === 'success')
  const failedSignals    = rows.filter((r) => r.status === 'fail' || r.status === 'cancelled')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Öz-Yansıma İçgörüleri"
        description="Haftalık otomatik analiz: yüksek FAIL oranlı playbook'lar ve CEO önerileri"
      />

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-white/40">Beklemede / Çalışıyor</div>
          <div className="mt-1 text-2xl font-semibold text-yellow-300">{pendingSignals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-white/40">Tamamlandı (öneri hazır)</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">{completedSignals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-white/40">Başarısız</div>
          <div className="mt-1 text-2xl font-semibold text-red-300">{failedSignals.length}</div>
        </Card>
      </div>

      {loading ? (
        <Card className="p-6 text-center text-sm text-white/50">Yükleniyor…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<Brain size={32} />}
            title="Henüz öz-yansıma sinyali yok"
            description="Self-Reflection Tick haftalık çalışıyor (Pazartesi 02:00 UTC). FAIL oranı %40+ olan playbook'larda otomatik tetiklenir."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const result = s.result_json as Record<string, any> | null
            const applied = !!result?.applied_at
            const ceoOutput = result?.summary || result?.report || result?.text || null

            return (
              <Card key={s.id} className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {s.status === 'pending' || s.status === 'running' ? (
                      <Clock className="mt-1 text-yellow-300" size={18} />
                    ) : s.status === 'success' ? (
                      <CheckCircle2 className="mt-1 text-emerald-300" size={18} />
                    ) : (
                      <AlertCircle className="mt-1 text-red-300" size={18} />
                    )}
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{s.playbook_slug}</span>
                        <Badge tone={s.fail_rate >= 0.6 ? 'red' : 'yellow'}>
                          %{Math.round(s.fail_rate * 100)} FAIL
                        </Badge>
                        <span className="text-xs text-white/40">
                          {s.fail_runs}/{s.total_runs} run · {s.analysis_window}
                        </span>
                        <span className="text-xs text-white/40">· pack: {s.domain_pack}</span>
                      </div>
                      <div className="mt-1 text-xs text-white/50">
                        {new Date(s.created_at).toLocaleString('tr-TR')}
                        {applied ? <span className="ml-2 text-emerald-300">✓ Uygulandı: {new Date(result!.applied_at).toLocaleString('tr-TR')}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/app/jobs/${s.id}`}>
                      <Button variant="outline" size="sm">Detay</Button>
                    </Link>
                    {s.status === 'success' && !applied ? (
                      <Button
                        size="sm"
                        disabled={applyingId === s.id}
                        onClick={() => onApply(s.id)}
                      >
                        {applyingId === s.id ? 'İşaretleniyor…' : 'Uygulandı işaretle'}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {ceoOutput ? (
                  <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                    <div className="mb-1 text-white/40">CEO Önerisi (özet)</div>
                    <pre className="whitespace-pre-wrap font-sans">{String(ceoOutput).slice(0, 800)}{String(ceoOutput).length > 800 ? '…' : ''}</pre>
                  </div>
                ) : s.error_message ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{s.error_message}</div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
