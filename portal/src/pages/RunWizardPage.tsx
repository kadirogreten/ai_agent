import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { useAuthStore } from '@/stores/authStore'
import { listPersonas, type PersonaRow } from '@/lib/personas'
import { listDomainPacks, listPlaybooksForPersona, type PlaybookRow } from '@/lib/playbooks'
import { createRunRequest } from '@/lib/runs'
import { Play, Bot, Zap, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react'

// ── Styled textarea ────────────────────────────────────────────────────────
function Textarea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <div>
      {label && <div className="mb-1.5 text-xs font-medium text-white/50">{label}</div>}
      <textarea
        className={[
          'min-h-[110px] w-full rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-white',
          'placeholder:text-white/25 outline-none transition-all duration-150 resize-none',
          'focus:border-blue-500/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-blue-500/15',
          'hover:border-white/[0.12]',
        ].join(' ')}
        {...props}
      />
    </div>
  )
}

// ── Step indicator ─────────────────────────────────────────────────────────
function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={[
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all',
      done   ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' :
      active ? 'bg-white/10 text-white ring-1 ring-blue-500/60' :
               'bg-white/[0.04] text-white/25',
    ].join(' ')}>
      {done ? <CheckCircle2 size={14} /> : n}
    </div>
  )
}

function StepCard({
  n, title, active, done, children,
}: {
  n: number; title: string; active: boolean; done: boolean; children: React.ReactNode
}) {
  return (
    <div className={[
      'rounded-xl border transition-all duration-200',
      active ? 'border-blue-500/25 bg-gradient-to-b from-[#0d1e36] to-[#09152a] shadow-[0_0_24px_rgba(59,130,246,0.06)]' :
      done   ? 'border-white/[0.08] bg-gradient-to-b from-[#0d1829] to-[#0a1020]' :
               'border-white/[0.05] bg-white/[0.015] opacity-60',
    ].join(' ')}>
      <div className="flex items-center gap-3 px-5 py-4">
        <StepBadge n={n} active={active} done={done} />
        <span className={`text-sm font-semibold ${active ? 'text-white' : done ? 'text-white/60' : 'text-white/30'}`}>
          {title}
        </span>
      </div>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.06] px-5 pb-5 pt-4 space-y-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Risk badge ─────────────────────────────────────────────────────────────
const RISK_COLOR: Record<string, string> = {
  R0: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  R1: 'text-blue-400   bg-blue-400/10   border-blue-400/20',
  R2: 'text-amber-400  bg-amber-400/10  border-amber-400/20',
  R3: 'text-red-400    bg-red-400/10    border-red-400/20',
}
function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${RISK_COLOR[risk] ?? 'text-white/50 border-white/10'}`}>
      {risk}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════
export default function RunWizardPage() {
  const navigate    = useNavigate()
  const initialized = useAuthStore((s) => s.initialized)
  const user        = useAuthStore((s) => s.user)
  const canRun      = initialized && !!user

  const [wizardMode, setWizardMode] = useState<'run' | 'ceo'>('ceo')

  const [packs,      setPacks]      = useState<{ id: string; name: string }[]>([])
  const [packId,     setPackId]     = useState('')
  const [personas,   setPersonas]   = useState<PersonaRow[]>([])
  const [personaId,  setPersonaId]  = useState('')
  const [playbooks,  setPlaybooks]  = useState<PlaybookRow[]>([])
  const [playbookId, setPlaybookId] = useState('')
  const [topic,      setTopic]      = useState('')
  const [model,      setModel]      = useState('gpt-4.1')
  const [web,        setWeb]        = useState(true)
  const [contrarian, setContrarian] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  useEffect(() => {
    if (!canRun) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canRun])

  useEffect(() => {
    if (!canRun) return
    setPersonaId(''); setPlaybooks([]); setPlaybookId('')
    if (!packId) { setPersonas([]); return }
    listPersonas({ q: '', packId }).then((res) => setPersonas(res.data))
  }, [canRun, packId])

  const selectedPersona = useMemo(() => personas.find((p) => p.id === personaId) ?? null, [personas, personaId])

  useEffect(() => {
    if (!canRun || !selectedPersona) { setPlaybooks([]); setPlaybookId(''); return }
    listPlaybooksForPersona({ pack_id: selectedPersona.pack_id, risk_ceiling: selectedPersona.risk_ceiling })
      .then((res) => { setPlaybooks(res.data); setPlaybookId('') })
  }, [canRun, selectedPersona])

  const selectedPlaybook = useMemo(() => playbooks.find((p) => p.id === playbookId) ?? null, [playbooks, playbookId])
  const activeBehaviors  = useMemo(() => {
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
      mode: 'run', domain_pack: packId, request_text: topic.trim(),
      answers_json: { playbookId: selectedPlaybook.slug, persona: selectedPersona.slug, topic: topic.trim() },
      model: model.trim() || undefined,
      risk: selectedPlaybook.default_risk,
      allow_high_risk: ['R2','R3'].includes(selectedPlaybook.default_risk),
      web, contrarian,
    })
    setSubmitting(false)
    if (res.error || !res.id) { setErr(res.error ?? 'Yaratılamadı.'); return }
    navigate(`/app/jobs/${res.id}`)
  }

  async function onCeoSubmit() {
    setErr(null)
    if (!packId || !topic.trim()) { setErr('Domain ve hedef zorunludur.'); return }
    setSubmitting(true)
    const res = await createRunRequest({
      mode: 'ceo', domain_pack: packId, request_text: topic.trim(),
      answers_json: { topic: topic.trim() },
      model: model.trim() || undefined, risk: 'R1', web, contrarian,
    })
    setSubmitting(false)
    if (res.error || !res.id) { setErr(res.error ?? 'Yaratılamadı.'); return }
    navigate(`/app/jobs/${res.id}`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
          <Play size={18} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Yeni Çalıştırma</h1>
          <p className="text-xs text-white/40">Bir ajan görevi oluştur ve başlat</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1.5">
        {([
          { mode: 'ceo' as const, label: 'CEO Modu', icon: <Bot size={14} />, desc: 'Hedefinizi söyleyin, plan otomatik oluşur' },
          { mode: 'run' as const, label: 'Standart',  icon: <Zap size={14} />, desc: 'Domain → Persona → Playbook → Çalıştır' },
        ]).map(({ mode, label, icon, desc }) => (
          <button
            key={mode}
            onClick={() => { setWizardMode(mode); setErr(null) }}
            className={[
              'flex flex-1 items-center gap-3 rounded-lg px-4 py-2.5 transition-all text-left',
              wizardMode === mode
                ? 'bg-blue-600/20 border border-blue-500/25 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.08)]'
                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <span className={wizardMode === mode ? 'text-blue-400' : 'text-white/30'}>{icon}</span>
            <div>
              <div className="text-sm font-medium leading-none">{label}</div>
              <div className="mt-1 text-[10px] text-white/35 leading-none">{desc}</div>
            </div>
            {wizardMode === mode && <ChevronRight size={14} className="ml-auto text-blue-400/60 shrink-0" />}
          </button>
        ))}
      </div>

      {/* Error */}
      <AnimatePresence>
        {err && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <AlertTriangle size={14} className="shrink-0 text-red-400" />
            {err}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CEO MODE ──────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
      {wizardMode === 'ceo' && (
        <motion.div key="ceo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/15 bg-blue-500/[0.07] px-4 py-3 text-xs text-blue-200/80">
            <Bot size={14} className="mt-0.5 shrink-0 text-blue-400" />
            CEO modunda sadece domain ve hedefinizi belirtin — ajan, planı otomatik oluşturur.
          </div>

          <Card className="space-y-4 p-5">
            <Select
              label="Domain Pack"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
            >
              <option value="">Seçiniz…</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>

            <Textarea
              label="Hedef / İstek"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Örn: Rakiplerimizin fiyatlandırma stratejisini analiz et ve bu çeyrek için öneriler üret"
            />

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1" />
              <div className="flex items-end">
                <Toggle checked={web} onChange={setWeb} label="Web araması" />
              </div>
              <div className="flex items-end">
                <Toggle checked={contrarian} onChange={setContrarian} label="Contrarian" />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                size="lg"
                onClick={onCeoSubmit}
                disabled={submitting || !packId || !topic.trim()}
                className="gap-2"
              >
                <Bot size={16} />
                {submitting ? 'Gönderiliyor…' : "CEO'ya Gönder"}
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* ── STANDART MODE ────────────────────────────────────────── */}
      {wizardMode === 'run' && (
        <motion.div key="run" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

          {/* Step 1 — Domain */}
          <StepCard n={1} title="Domain Pack seç" active={true} done={!!packId}>
            <Select value={packId} onChange={(e) => setPackId(e.target.value)}>
              <option value="">Seçiniz…</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </StepCard>

          {/* Step 2 — Persona */}
          <StepCard n={2} title="Persona seç" active={!!packId && !personaId} done={!!personaId}>
            {packId ? (
              <>
                <Select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                  <option value="">Seçiniz…</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.slug}) — risk≤{p.risk_ceiling}
                    </option>
                  ))}
                </Select>
                <AnimatePresence>
                  {selectedPersona && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-blue-500/15 bg-blue-500/[0.06] p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/60">Risk:</span>
                        <RiskBadge risk={selectedPersona.risk_ceiling} />
                        <span className="text-xs text-white/40 ml-2">Maliyet: {selectedPersona.cost_class}</span>
                      </div>
                      {activeBehaviors.length > 0 && (
                        <div className="text-[11px] text-blue-200/70">
                          <span className="text-white/40">Bayraklar:</span> {activeBehaviors.join(', ')}
                        </div>
                      )}
                      {selectedPersona.role_description && (
                        <div className="text-[11px] text-white/50">{selectedPersona.role_description}</div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <p className="text-xs text-white/30">Önce domain pack seçin.</p>
            )}
          </StepCard>

          {/* Step 3 — Playbook */}
          <StepCard n={3} title="Playbook seç" active={!!personaId && !playbookId} done={!!playbookId}>
            {selectedPersona ? (
              <>
                {playbooks.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs text-amber-200/80">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    Bu persona için uyumlu playbook bulunamadı.
                  </div>
                ) : (
                  <Select value={playbookId} onChange={(e) => setPlaybookId(e.target.value)}>
                    <option value="">Seçiniz…</option>
                    {playbooks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.steps?.length ?? 0} adım · {p.default_risk}
                      </option>
                    ))}
                  </Select>
                )}
                <AnimatePresence>
                  {selectedPlaybook && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white/80">{selectedPlaybook.name}</span>
                        <RiskBadge risk={selectedPlaybook.default_risk} />
                      </div>
                      {selectedPlaybook.description && (
                        <p className="text-[11px] text-white/45">{selectedPlaybook.description}</p>
                      )}
                      <div className="space-y-1 pt-1">
                        {selectedPlaybook.steps?.map((s, i) => (
                          <div key={s.id} className="flex items-start gap-2 text-[11px]">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.05] font-mono text-[9px] text-white/30">{i+1}</span>
                            <span className="text-blue-300/80 font-medium">{s.agent}</span>
                            {s.goal && <span className="text-white/40 truncate">— {s.goal.slice(0, 70)}{s.goal.length > 70 ? '…' : ''}</span>}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <p className="text-xs text-white/30">Önce persona seçin.</p>
            )}
          </StepCard>

          {/* Step 4 — Topic + launch */}
          <StepCard n={4} title="Topic ve başlat" active={!!playbookId} done={false}>
            {selectedPlaybook ? (
              <div className="space-y-4">
                <Input
                  label="Topic / İstek"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Örn: Üçüncü çeyrek için rakip fiyat takip raporu"
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1" />
                  <div className="flex items-end">
                    <Toggle checked={web} onChange={setWeb} label="Web araması" />
                  </div>
                  <div className="flex items-end">
                    <Toggle checked={contrarian} onChange={setContrarian} label="Contrarian" />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button size="lg" onClick={onSubmit} disabled={submitting || !topic.trim()} className="gap-2">
                    <Play size={16} />
                    {submitting ? 'Yaratılıyor…' : 'Çalıştır'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/30">Önce playbook seçin.</p>
            )}
          </StepCard>

        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}
