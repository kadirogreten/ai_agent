import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, FlaskConical } from 'lucide-react'

type CheckResult = {
  id: string
  check_id: string
  check_name: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  summary: string | null
  details: Record<string, unknown>
  metrics: Record<string, unknown>
  run_at: string
}

const CHECK_LABELS: Record<string, string> = {
  '1': 'Facts Injection (Kapı 1)',
  '2': 'Persona Overlay (Kapı 2)',
  '3': 'Risk Gate (Kapı 2)',
  '4': 'Behaviors Heuristic (sektör keşfi)',
}

const STATUS_TONE: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
  pass: 'green', warn: 'yellow', fail: 'red', skip: 'gray',
}

export default function EmpiricalCheckPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const canQuery    = initialized && !!user

  const [results, setResults] = useState<CheckResult[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)

    // Her check_id için en güncel kaydı al
    const res = await supabase
      .from('empirical_check_results')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(200)

    if (res.error) { setErr(res.error.message); setResults([]) }
    else {
      const latestByCheck = new Map<string, CheckResult>()
      for (const row of (res.data ?? []) as CheckResult[]) {
        if (!latestByCheck.has(row.check_id)) latestByCheck.set(row.check_id, row)
      }
      setResults(Array.from(latestByCheck.values()).sort((a, b) => a.check_id.localeCompare(b.check_id)))
    }
    setLoading(false)
  }, [canQuery])

  useEffect(() => { load() }, [load])

  const allChecks = ['1', '2', '3', '4']
  const resultByCheck = new Map(results.map((r) => [r.check_id, r]))
  const passCount = results.filter((r) => r.status === 'pass').length
  const failCount = results.filter((r) => r.status === 'fail').length
  const warnCount = results.filter((r) => r.status === 'warn').length

  const newest = results.length > 0
    ? results.reduce((a, b) => new Date(a.run_at) > new Date(b.run_at) ? a : b)
    : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ampirik Kontroller"
        description="Mimarinin gerçekten çalıştığının ölçülmüş kanıtı — Kapı 1, 2 ve sektör keşfi"
        actions={
          <Button size="sm" variant="outline" onClick={load}>Yenile</Button>
        }
      />

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>
      )}

      {results.length === 0 && !loading ? (
        <Card className="p-8">
          <EmptyState
            icon={<FlaskConical size={32} />}
            title="Henüz ampirik kontrol çalıştırılmadı"
            description={
              <span>
                Çalıştırmak için: <code className="rounded bg-black/30 px-1.5 py-0.5">npx tsx portal/api/lib/empiricalCheck.ts</code><br/>
                Sonuçlar bu sayfada görünecek (her check için en güncel kayıt).
              </span>
            }
          />
        </Card>
      ) : (
        <>
          {/* Özet */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-white/40">Geçti</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">{passCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-white/40">Uyarı</div>
              <div className="mt-1 text-2xl font-semibold text-yellow-300">{warnCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-white/40">Başarısız</div>
              <div className="mt-1 text-2xl font-semibold text-red-300">{failCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-white/40">Son çalıştırma</div>
              <div className="mt-1 text-sm font-medium text-white/80">
                {newest ? new Date(newest.run_at).toLocaleString('tr-TR') : '—'}
              </div>
            </Card>
          </div>

          {/* Check detayları */}
          <div className="space-y-3">
            {allChecks.map((cid) => {
              const r = resultByCheck.get(cid)
              const label = CHECK_LABELS[cid] ?? `Check ${cid}`
              if (!r) {
                return (
                  <Card key={cid} className="p-4">
                    <div className="flex items-center gap-3">
                      <MinusCircle className="text-white/30" size={18} />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white/60">{label}</div>
                        <div className="text-xs text-white/40">Bu check için sonuç yok — script'i bir kere çalıştır.</div>
                      </div>
                      <Badge tone="gray">çalıştırılmadı</Badge>
                    </div>
                  </Card>
                )
              }
              const Icon = r.status === 'pass' ? CheckCircle2
                         : r.status === 'fail' ? XCircle
                         : r.status === 'warn' ? AlertTriangle
                         : MinusCircle
              const iconColor = r.status === 'pass' ? 'text-emerald-300'
                              : r.status === 'fail' ? 'text-red-300'
                              : r.status === 'warn' ? 'text-yellow-300'
                              : 'text-white/30'

              return (
                <Card key={cid} className="space-y-3 p-5">
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-1 ${iconColor}`} size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                        <Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{r.status.toUpperCase()}</Badge>
                        <span className="text-xs text-white/40">{new Date(r.run_at).toLocaleString('tr-TR')}</span>
                      </div>
                      {r.summary ? <div className="mt-1 text-sm text-white/70">{r.summary}</div> : null}
                    </div>
                  </div>

                  {Object.keys(r.metrics ?? {}).length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {Object.entries(r.metrics).map(([k, v]) => (
                        <div key={k} className="rounded-md border border-white/10 bg-black/20 p-2">
                          <div className="text-xs text-white/40">{k.replace(/_/g, ' ')}</div>
                          <div className="mt-0.5 text-sm font-mono text-white/80">{String(v)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {Object.keys(r.details ?? {}).length > 0 ? (
                    <details className="rounded-md border border-white/10 bg-black/20 p-2 text-xs text-white/60">
                      <summary className="cursor-pointer text-white/50">Detayları gör</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(r.details, null, 2)}</pre>
                    </details>
                  ) : null}
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
