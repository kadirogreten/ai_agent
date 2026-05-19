import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/stores/authStore'
import { getPlaybookBundle, type PlaybookBundleRow } from '@/lib/bundles'
import { listDomainPacks } from '@/lib/playbooks'
import { createRunRequest } from '@/lib/runs'

export default function PlaybookBundleDetailPage() {
  const { bundleId } = useParams<{ bundleId: string }>()
  const navigate = useNavigate()
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)

  const [bundle, setBundle] = useState<PlaybookBundleRow | null>(null)
  const [packName, setPackName] = useState<string>('')
  const [topic, setTopic] = useState('')
  const [model, setModel] = useState('gpt-4.1')
  const [web, setWeb] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canRun = initialized && !!user

  useEffect(() => {
    if (!bundleId) return
    getPlaybookBundle(bundleId).then((res) => {
      if (res.error || !res.data) { setErr(res.error ?? 'Bundle bulunamadı'); return }
      setBundle(res.data)
    })
  }, [bundleId])

  useEffect(() => {
    if (!bundle) return
    listDomainPacks().then((res) => {
      const found = res.data.find((p) => p.id === bundle.pack_id)
      if (found) setPackName(found.name)
    })
  }, [bundle])

  async function onRun() {
    if (!bundle || !canRun) return
    setErr(null)
    if (!topic.trim()) { setErr('Topic zorunludur.'); return }
    setSubmitting(true)
    const res = await createRunRequest({
      mode: 'bundle',
      domain_pack: bundle.pack_id,
      request_text: topic.trim(),
      answers_json: {
        bundleSlug: bundle.slug,
        topic: topic.trim(),
      },
      model: model.trim() || undefined,
      risk: bundle.default_risk,
      allow_high_risk: bundle.default_risk === 'R2' || bundle.default_risk === 'R3',
      web,
    })
    setSubmitting(false)
    if (res.error || !res.id) { setErr(res.error ?? 'Yaratılamadı.'); return }
    navigate(`/app/jobs/${res.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{bundle?.name ?? 'Bundle Detayı'}</h1>
        <Link to="/app/playbook-bundles">
          <Button variant="secondary" size="sm">Geri</Button>
        </Link>
      </div>

      {err && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>
      )}

      {bundle && (
        <>
          <Card className="space-y-3 p-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-white/50">Slug</div>
                <div className="font-mono text-white/70">{bundle.slug}</div>
              </div>
              <div>
                <div className="text-xs text-white/50">Pack</div>
                <div>{packName || bundle.pack_id}</div>
              </div>
              <div>
                <div className="text-xs text-white/50">Varsayılan Risk</div>
                <Badge tone={bundle.default_risk === 'R0' ? 'green' : bundle.default_risk === 'R1' ? 'blue' : 'yellow'}>
                  {bundle.default_risk}
                </Badge>
              </div>
              <div>
                <div className="text-xs text-white/50">Versiyon</div>
                <div className="text-white/60">v{bundle.version}</div>
              </div>
            </div>

            {bundle.description && (
              <div className="text-sm text-white/60">{bundle.description}</div>
            )}

            <div>
              <div className="mb-1 text-xs text-white/50">Playbook'lar ({bundle.playbook_slugs.length})</div>
              <div className="flex flex-wrap gap-1">
                {bundle.playbook_slugs.map((s) => (
                  <span key={s} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-white/60">{s}</span>
                ))}
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="text-sm font-medium">Bundle'ı Çalıştır</div>

            <div>
              <div className="mb-1 text-xs text-white/60">Topic / İstek</div>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Örn: Q3 rakip fiyat analizi"
                className="min-h-[80px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="mb-1 text-xs text-white/60">Model</div>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4.1"
                  className="h-9 rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
                Web araması
              </label>
              <div className="ml-auto">
                <Button onClick={onRun} disabled={submitting || !topic.trim() || !canRun}>
                  {submitting ? 'Çalıştırılıyor...' : 'Çalıştır'}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
