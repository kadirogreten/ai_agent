import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listPersonas, type PersonaRow } from '@/lib/personas'
import { listDomainPacks, listPlaybooksForPersona, type PlaybookRow } from '@/lib/playbooks'
import { createRunRequest } from '@/lib/runs'

/**
 * Çalıştırma sihirbazı — iki mod:
 *   "run"  — Domain → Persona → Playbook → Topic → Çalıştır (mevcut akış)
 *   "ceo"  — Domain + Hedef → CEO planı otomatik üretir, kullanıcı seçim yapmaz
 */
export default function RunWizardPage() {
  const navigate    = useNavigate()
  const initialized = useAuthStore((s) => s.initialized)
  const user        = useAuthStore((s) => s.user)
  const canRun      = initialized && !!user

  const [wizardMode, setWizardMode]     = useState<'run' | 'ceo'>('run')

  const [packs, setPacks]               = useState<{ id: string; name: string }[]>([])
  const [packId, setPackId]             = useState('')
  const [personas, setPersonas]         = useState<PersonaRow[]>([])
  const [personaId, setPersonaId]       = useState('')
  const [playbooks, setPlaybooks]       = useState<PlaybookRow[]>([])
  const [playbookId, setPlaybookId]     = useState('')
  const [topic, setTopic]               = useState('')
  const [model, setModel]               = useState('gpt-4.1')
  const [web, setWeb]                   = useState(true)
  const [contrarian, setContrarian]     = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [err, setErr]                   = useState<string | null>(null)

  // 1. Pack'ler — sayfa açılışında bir kez
  useEffect(() => {
    if (!canRun) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canRun])

  // 2. Personalar — pack değişince yeniden yükle (pack-spesifik + cross-domain)
  useEffect(() => {
    if (!canRun) return
    setPersonaId('')
    setPlaybooks([])
    setPlaybookId('')
    if (!packId) { setPersonas([]); return }
    listPersonas({ q: '', packId }).then((res) => setPersonas(res.data))
  }, [canRun, packId])

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId) ?? null,
    [personas, personaId],
  )

  // 3. Playbook'lar — persona değişince persona-uyumlu listeyi getir
  useEffect(() => {
    if (!canRun || !selectedPersona) { setPlaybooks([]); setPlaybookId(''); return }
    listPlaybooksForPersona({
      pack_id:      selectedPersona.pack_id,
      risk_ceiling: selectedPersona.risk_ceiling,
    }).then((res) => {
      setPlaybooks(res.data)
      setPlaybookId('')
    })
  }, [canRun, selectedPersona])

  const selectedPlaybook = useMemo(
    () => playbooks.find((p) => p.id === playbookId) ?? null,
    [playbooks, playbookId],
  )

  const activeBehaviors = useMemo(() => {
    if (!selectedPersona) return [] as string[]
    return Object.entries(selectedPersona.behaviors ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k.replace(/_/g, ' '))
  }, [selectedPersona])

  async function onSubmit() {
    setErr(null)
    if (!packId || !selectedPersona || !selectedPlaybook || !topic.trim()) {
      setErr('Domain, persona, playbook ve topic zorunludur.')
      return
    }
    setSubmitting(true)
    const res = await createRunRequest({
      mode:        'run',
      domain_pack: packId,
      request_text: topic.trim(),
      answers_json: {
        playbookId: selectedPlaybook.slug,
        persona:    selectedPersona.slug,
        topic:      topic.trim(),
      },
      model:           model.trim() || undefined,
      risk:            selectedPlaybook.default_risk,
      allow_high_risk: selectedPlaybook.default_risk === 'R2' || selectedPlaybook.default_risk === 'R3',
      web,
      contrarian,
    })
    setSubmitting(false)
    if (res.error || !res.id) {
      setErr(res.error ?? 'Yaratılamadı.')
      return
    }
    navigate(`/app/jobs/${res.id}`)
  }

  async function onCeoSubmit() {
    setErr(null)
    if (!packId || !topic.trim()) {
      setErr('Domain ve hedef zorunludur.')
      return
    }
    setSubmitting(true)
    const res = await createRunRequest({
      mode:         'ceo',
      domain_pack:  packId,
      request_text: topic.trim(),
      answers_json: { topic: topic.trim() },
      model:        model.trim() || undefined,
      risk:         'R1',
      web,
      contrarian,
    })
    setSubmitting(false)
    if (res.error || !res.id) {
      setErr(res.error ?? 'Yaratılamadı.')
      return
    }
    navigate(`/app/jobs/${res.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Yeni Çalıştırma</h1>

      {/* Mod seçici */}
      <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
        <button
          onClick={() => { setWizardMode('run'); setErr(null) }}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${wizardMode === 'run' ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/80'}`}
        >
          Standart Çalıştırma
        </button>
        <button
          onClick={() => { setWizardMode('ceo'); setErr(null) }}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${wizardMode === 'ceo' ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/80'}`}
        >
          CEO Modu — Hedef Söyle
        </button>
      </div>

      {wizardMode === 'ceo' ? (
        <CeoModeForm
          packs={packs}
          packId={packId}
          setPackId={setPackId}
          topic={topic}
          setTopic={setTopic}
          model={model}
          setModel={setModel}
          web={web}
          setWeb={setWeb}
          contrarian={contrarian}
          setContrarian={setContrarian}
          submitting={submitting}
          onSubmit={onCeoSubmit}
          err={err}
        />
      ) : null}

      {wizardMode === 'run' ? (
        <>
          {err ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {err}
            </div>
          ) : null}

          {/* 1. Domain */}
          <Card className="space-y-3 p-5">
            <div className="text-sm font-medium">1. Domain Pack</div>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
            >
              <option value="">Seç...</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Card>

          {/* 2. Persona */}
          {packId ? (
            <Card className="space-y-3 p-5">
              <div className="text-sm font-medium">2. Persona (rolün)</div>
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
              >
                <option value="">Seç...</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug}) — risk≤{p.risk_ceiling}
                  </option>
                ))}
              </select>

              {selectedPersona ? (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100">
                  <div className="mb-1">
                    <span className="text-blue-300">Risk tavanı:</span> <strong>{selectedPersona.risk_ceiling}</strong>
                    <span className="ml-3 text-blue-300">Maliyet sınıfı:</span> {selectedPersona.cost_class}
                  </div>
                  <div>
                    <span className="text-blue-300">Aktif davranış bayrakları:</span>{' '}
                    {activeBehaviors.length === 0 ? (
                      <span className="italic text-blue-200/60">yok (sadece markdown bağlamı kullanılır)</span>
                    ) : (
                      <span>{activeBehaviors.join(', ')}</span>
                    )}
                  </div>
                  {selectedPersona.role_description ? (
                    <div className="mt-1 text-blue-200/70">{selectedPersona.role_description}</div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* 3. Playbook */}
          {selectedPersona ? (
            <Card className="space-y-3 p-5">
              <div className="text-sm font-medium">3. Playbook (ne yapacak)</div>
              {playbooks.length === 0 ? (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-100">
                  Bu persona için uyumlu playbook bulunamadı. Playbook'un <code>pack_id</code>'si
                  persona ile aynı olmalı VE <code>default_risk</code> ≤ persona risk tavanı.
                </div>
              ) : (
                <select
                  value={playbookId}
                  onChange={(e) => setPlaybookId(e.target.value)}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
                >
                  <option value="">Seç...</option>
                  {playbooks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.slug}) — {p.steps?.length ?? 0} adım, risk={p.default_risk}
                    </option>
                  ))}
                </select>
              )}

              {selectedPlaybook ? (
                <div className="rounded-md border border-white/10 bg-[#0B1020] p-3 text-xs text-white/70">
                  <div className="mb-1 text-white/80">{selectedPlaybook.name}</div>
                  {selectedPlaybook.description ? <div className="mb-2">{selectedPlaybook.description}</div> : null}
                  <div className="space-y-1">
                    {selectedPlaybook.steps?.map((s) => (
                      <div key={s.id}>
                        <span className="font-mono text-white/50">{s.id}</span> · <span className="text-blue-200">{s.agent}</span>{' '}
                        {s.goal ? <span className="text-white/60">— {s.goal.slice(0, 80)}{s.goal.length > 80 ? '...' : ''}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* 4. Topic + opsiyonlar */}
          {selectedPlaybook ? (
            <Card className="space-y-3 p-5">
              <div className="text-sm font-medium">4. Topic / İstek</div>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Örn: Üçüncü çeyrek için rakip fiyat takip raporu"
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <div className="mb-1 text-xs text-white/60">Model</div>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1" />
                </div>
                <label className="flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
                  Web araması
                </label>
                <label className="flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={contrarian} onChange={(e) => setContrarian(e.target.checked)} />
                  Contrarian aç
                </label>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={onSubmit} disabled={submitting || !topic.trim()}>
                  {submitting ? 'Yaratılıyor...' : 'Çalıştır'}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

type CeoModeFormProps = {
  packs: { id: string; name: string }[]
  packId: string; setPackId: (v: string) => void
  topic: string; setTopic: (v: string) => void
  model: string; setModel: (v: string) => void
  web: boolean; setWeb: (v: boolean) => void
  contrarian: boolean; setContrarian: (v: boolean) => void
  submitting: boolean
  onSubmit: () => void
  err: string | null
}

function CeoModeForm({ packs, packId, setPackId, topic, setTopic, model, setModel, web, setWeb, contrarian, setContrarian, submitting, onSubmit, err }: CeoModeFormProps) {
  return (
    <>
      <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
        CEO modunda persona ve playbook seçmenize gerek yok. Sadece domain ve hedefinizi söyleyin;
        CEO ajanı planı otomatik oluşturur.
      </div>

      {err ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>
      ) : null}

      <Card className="space-y-4 p-5">
        <div>
          <div className="mb-1 text-xs text-white/60">Domain Pack</div>
          <select
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
            className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
          >
            <option value="">Seç...</option>
            {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <div className="mb-1 text-xs text-white/60">Hedef / İstek</div>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Örn: Rakiplerimizin fiyatlandırma stratejisini analiz et ve bu çeyrek için öneriler üret"
            className="min-h-[100px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-xs text-white/60">Model</div>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1" className="w-36" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
            Web araması
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={contrarian} onChange={(e) => setContrarian(e.target.checked)} />
            Contrarian aç
          </label>
          <div className="ml-auto">
            <Button onClick={onSubmit} disabled={submitting || !packId || !topic.trim()}>
              {submitting ? 'Yaratılıyor...' : 'CEO\'ya Gönder'}
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
