import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listAgents, type AgentRole, type AgentRow } from '@/lib/agents'
import { listPersonas, type PersonaRow } from '@/lib/personas'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion'
import { LayoutGrid, List, Plus, X, Monitor, Cpu, Globe, Database, Pen, Shield, Wrench, FlaskConical, Code2 } from 'lucide-react'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<AgentRole, string> = {
  research:     'Araştırma',
  analysis:     'Analiz',
  writing:      'Yazım',
  editing:      'Editör',
  verification: 'Denetçi',
  operation:    'Operatör',
  contrarian:   'Contrarian',
  design:       'Tasarım',
  code:         'Kod',
}

const ROLE_ICONS: Record<AgentRole, React.ReactNode> = {
  research:     <Globe size={14} />,
  analysis:     <FlaskConical size={14} />,
  writing:      <Pen size={14} />,
  editing:      <Pen size={14} />,
  verification: <Shield size={14} />,
  operation:    <Wrench size={14} />,
  contrarian:   <X size={14} />,
  design:       <Monitor size={14} />,
  code:         <Code2 size={14} />,
}

const RISK_LIGHT: Record<string, string> = {
  R0: '#34d399',
  R1: '#60a5fa',
  R2: '#fbbf24',
  R3: '#f87171',
}

const ROLE_COLORS: Record<AgentRole, string> = {
  research:     '#818cf8',
  analysis:     '#a78bfa',
  writing:      '#f472b6',
  editing:      '#fb923c',
  verification: '#34d399',
  operation:    '#60a5fa',
  contrarian:   '#f87171',
  design:       '#e879f9',
  code:         '#4ade80',
}

// ─── 3D Masa Kartı ────────────────────────────────────────────────────────────

function DeskCard({
  agent,
  personas,
  isSelected,
  onSelect,
}: {
  agent: AgentRow
  personas: PersonaRow[]
  isSelected: boolean
  onSelect: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-0.5, 0.5], [8, -8])
  const rotateY = useTransform(x, [-0.5, 0.5], [-8, 8])

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    x.set((e.clientX - rect.left) / rect.width - 0.5)
    y.set((e.clientY - rect.top)  / rect.height - 0.5)
  }
  function onMouseLeave() { x.set(0); y.set(0) }

  const riskColor = RISK_LIGHT[agent.risk_ceiling] ?? '#60a5fa'
  const roleColor = agent.role ? ROLE_COLORS[agent.role] : '#60a5fa'
  const activeBehaviors = Object.entries(agent.behaviors ?? {}).filter(([, v]) => v).map(([k]) => k)

  return (
    <div
      style={{ perspective: '900px' }}
      className="cursor-pointer"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onSelect}
    >
      <motion.div
        ref={ref}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        animate={isSelected ? { scale: 1.04 } : { scale: 1 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="relative"
      >
        {/* Masa yüzeyi */}
        <div
          className="relative rounded-xl border p-0 overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, #0f1829 0%, #0a1020 100%)',
            borderColor: isSelected ? `${roleColor}55` : 'rgba(255,255,255,0.07)',
            boxShadow: isSelected
              ? `0 0 0 1px ${roleColor}44, 0 20px 60px rgba(0,0,0,0.6)`
              : '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Üst şerit (masa kenarı) */}
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${roleColor}80, ${roleColor}20)` }}
          />

          <div className="p-4 space-y-3" style={{ transformStyle: 'preserve-3d' }}>
            {/* Monitor */}
            <div
              className="relative rounded-lg p-3 font-mono"
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.06)',
                transform: 'translateZ(12px)',
              }}
            >
              {/* Ekran parlaması */}
              <div className="absolute inset-0 rounded-lg opacity-5"
                style={{ background: `radial-gradient(ellipse at 30% 30%, ${roleColor}, transparent 70%)` }} />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu size={12} style={{ color: roleColor }} />
                  <span className="text-[11px] font-bold tracking-widest" style={{ color: roleColor }}>
                    {agent.code ?? '—'}
                  </span>
                </div>
                {/* Risk ışığı */}
                <span className="relative flex h-2.5 w-2.5">
                  {agent.risk_ceiling !== 'R0' && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"
                      style={{ background: riskColor }} />
                  )}
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ background: riskColor }} />
                </span>
              </div>

              <div className="mt-1.5 text-xs text-white/50 truncate">{agent.name ?? '—'}</div>
            </div>

            {/* İsim plakası */}
            <div
              className="flex items-center gap-2"
              style={{ transform: 'translateZ(8px)' }}
            >
              <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}30` }}>
                {agent.role ? ROLE_ICONS[agent.role] : <Monitor size={13} />}
                {agent.role ? ROLE_LABELS[agent.role] : '—'}
              </span>
              <span className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                style={{ background: `${riskColor}15`, color: riskColor, border: `1px solid ${riskColor}25` }}>
                {agent.risk_ceiling}
              </span>
            </div>

            {/* Persona kartları (masa üstü kimlik kartları) */}
            {personas.length > 0 && (
              <div style={{ transform: 'translateZ(16px)' }}>
                <div className="mb-1.5 text-[9px] uppercase tracking-widest text-white/25">Personalar</div>
                <div className="flex flex-wrap gap-1.5">
                  {personas.slice(0, 3).map((p) => (
                    <div
                      key={p.id}
                      className="rounded-md px-2 py-1 text-[10px] text-white/60"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {p.name ?? '—'}
                    </div>
                  ))}
                  {personas.length > 3 && (
                    <div className="rounded-md px-2 py-1 text-[10px] text-white/30"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      +{personas.length - 3}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Post-it notları (behaviors) */}
            {activeBehaviors.length > 0 && (
              <div
                className="flex flex-wrap gap-1"
                style={{ transform: 'translateZ(20px)' }}
              >
                {activeBehaviors.slice(0, 3).map((b) => (
                  <span key={b}
                    className="rounded px-1.5 py-0.5 text-[9px] text-white/40"
                    style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }}>
                    {b.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Masa alt gölgesi */}
          <div className="absolute -bottom-px left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${roleColor}40, transparent)` }} />
        </div>

        {/* 3D gölge */}
        <div
          className="absolute -bottom-3 left-4 right-4 h-6 rounded-full blur-xl opacity-40"
          style={{ background: roleColor, transform: 'translateZ(-20px)' }}
        />
      </motion.div>
    </div>
  )
}

// ─── Persona Panel ────────────────────────────────────────────────────────────

function PersonaPanel({ agent, personas, onClose }: { agent: AgentRow; personas: PersonaRow[]; onClose: () => void }) {
  const roleColor = agent.role ? ROLE_COLORS[agent.role] : '#60a5fa'

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="w-72 shrink-0 rounded-xl border p-4 space-y-4"
      style={{
        background: 'linear-gradient(160deg, #0f1829 0%, #0a1020 100%)',
        borderColor: `${roleColor}30`,
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-white/90">{agent.name ?? '—'}</div>
          <div className="font-mono text-xs" style={{ color: roleColor }}>{agent.code ?? '—'}</div>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
          <X size={16} />
        </button>
      </div>

      {agent.description && (
        <p className="text-xs text-white/40 leading-relaxed">{agent.description}</p>
      )}

      <div>
        <div className="mb-2 text-[9px] uppercase tracking-widest text-white/25">
          Persona Kartları ({personas.length})
        </div>
        {personas.length === 0 ? (
          <div className="rounded-lg border border-white/5 p-4 text-center text-xs text-white/25">
            Bu role bağlı persona yok
          </div>
        ) : (
          <div className="space-y-2">
            {personas.map((p) => {
              const activeBehaviors = Object.entries(p.behaviors ?? {}).filter(([, v]) => v === true).map(([k]) => k)
              return (
                <motion.div
                  key={p.id}
                  whileHover={{ x: 3 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                >
                  <Link to={`/app/personas/${p.id}/edit`}>
                    <div
                      className="rounded-lg p-3 transition-colors hover:bg-white/5"
                      style={{ border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white/80">{p.name ?? '—'}</span>
                        <span className="rounded px-1.5 py-0.5 font-mono text-[9px] text-white/40"
                          style={{ background: 'rgba(255,255,255,0.05)' }}>
                          {p.risk_ceiling}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-white/30">{p.slug ?? '—'}</div>
                      {activeBehaviors.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {activeBehaviors.slice(0, 4).map((b) => (
                            <span key={b}
                              className="rounded px-1.5 py-0.5 text-[9px]"
                              style={{ background: `${roleColor}12`, color: `${roleColor}99`, border: `1px solid ${roleColor}20` }}>
                              {b.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      <Link to={`/app/agents/${agent.id}/edit`}>
        <Button variant="outline" size="sm" className="w-full">Ajanı Düzenle</Button>
      </Link>
    </motion.div>
  )
}

// ─── Ana Sayfa ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [agents,   setAgents]   = useState<AgentRow[]>([])
  const [personas, setPersonas] = useState<PersonaRow[]>([])
  const [q,        setQ]        = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState<string | null>(null)
  const [view,     setView]     = useState<'office' | 'table'>('office')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const canQuery = initialized && !!user

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    const [aRes, pRes] = await Promise.all([
      listAgents({ q }),
      listPersonas({ q: '' }),
    ])
    if (aRes.error) { setErr(aRes.error); setLoading(false); return }
    setAgents(aRes.data)
    setPersonas(pRes.data)
    setLoading(false)
  }, [canQuery, q])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() =>
    q.trim()
      ? agents.filter((a) =>
          (a.name ?? '').toLowerCase().includes(q.toLowerCase()) ||
          (a.code ?? '').toLowerCase().includes(q.toLowerCase())
        )
      : agents,
    [agents, q]
  )

  function personasForAgent(agent: AgentRow): PersonaRow[] {
    if (!agent.role) return []
    const roleKw = (ROLE_LABELS[agent.role] ?? agent.role ?? '').toLowerCase()
    return personas.filter((p) => {
      const desc = (p.role_description ?? '').toLowerCase()
      const name = (p.name ?? '').toLowerCase()
      const packMatch = agent.role === 'research' && (desc.includes('araştırma') || name.includes('araştırma'))
        || agent.role === 'analysis'  && (desc.includes('analiz') || desc.includes('analyst'))
        || agent.role === 'writing'   && (desc.includes('yaz') || desc.includes('writer'))
        || agent.role === 'editing'   && (desc.includes('edit') || desc.includes('düzelt'))
        || agent.role === 'verification' && (desc.includes('verif') || desc.includes('denetç'))
        || (roleKw.length > 0 && desc.includes(roleKw))
      return packMatch
    })
  }

  const selectedAgent = agents.find((a) => a.id === selected) ?? null

  return (
    <div className="space-y-4">
      {/* Araç çubuğu */}
      <div className="flex items-center justify-between gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ajan ara…"
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          {/* Görünüm geçişi */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button
              onClick={() => setView('office')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                view === 'office' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <LayoutGrid size={13} />
              Ofis
            </button>
            <button
              onClick={() => setView('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                view === 'table' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <List size={13} />
              Liste
            </button>
          </div>
          <Link to="/app/agents/new">
            <Button size="sm">
              <Plus size={14} className="mr-1" />
              Yeni Ajan
            </Button>
          </Link>
        </div>
      </div>

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      {/* Office görünümü */}
      <AnimatePresence mode="wait">
        {view === 'office' ? (
          <motion.div
            key="office"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Ofis zemin */}
            <div
              className="relative min-h-[70vh] rounded-2xl p-8"
              style={{
                background: 'radial-gradient(ellipse at 50% 0%, #0d1a35 0%, #070d1a 60%)',
                border: '1px solid rgba(255,255,255,0.05)',
                backgroundImage: `
                  radial-gradient(ellipse at 50% 0%, #0d1a35 0%, #070d1a 60%),
                  linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
                `,
                backgroundSize: '100%, 48px 48px, 48px 48px',
              }}
            >
              {/* Ofis tavan ışığı efekti */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-30"
                style={{ background: 'radial-gradient(ellipse at 50% 0%, #1e3a5f, transparent 70%)' }} />

              {loading ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-48 animate-pulse rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.03)' }} />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-white/25">
                  <div className="text-center">
                    <Database size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Ajan bulunamadı</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-6">
                  {/* Masa grid */}
                  <motion.div
                    className="grid flex-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
                  >
                    {filtered.map((agent) => (
                      <motion.div
                        key={agent.id}
                        variants={{
                          hidden: { opacity: 0, y: 24, scale: 0.95 },
                          show:   { opacity: 1, y: 0,  scale: 1 },
                        }}
                        transition={{ type: 'spring' as const, stiffness: 260, damping: 24 }}
                      >
                        <DeskCard
                          agent={agent}
                          personas={personasForAgent(agent)}
                          isSelected={selected === agent.id}
                          onSelect={() => setSelected(selected === agent.id ? null : agent.id)}
                        />
                      </motion.div>
                    ))}
                  </motion.div>

                  {/* Persona panel */}
                  <AnimatePresence>
                    {selectedAgent && (
                      <PersonaPanel
                        key={selectedAgent.id}
                        agent={selectedAgent}
                        personas={personasForAgent(selectedAgent)}
                        onClose={() => setSelected(null)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Legand */}
            <div className="mt-3 flex flex-wrap gap-3 px-1">
              {Object.entries(RISK_LIGHT).map(([risk, color]) => (
                <div key={risk} className="flex items-center gap-1.5 text-xs text-white/30">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {risk}
                </div>
              ))}
              <span className="text-xs text-white/20">· Masalara tıklayarak persona kartlarını görüntüle</span>
            </div>
          </motion.div>
        ) : (
          /* Liste görünümü */
          <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <Card className="overflow-hidden">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Ajanlar</div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#0B1020]">
                    <tr className="border-b border-white/10 text-xs text-white/40">
                      <th className="px-4 py-2">Ad</th>
                      <th className="px-4 py-2">Kod</th>
                      <th className="px-4 py-2">Rol</th>
                      <th className="px-4 py-2">Risk</th>
                      <th className="px-4 py-2">Açıklama</th>
                      <th className="px-4 py-2">Personalar</th>
                      <th className="px-4 py-2">Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td className="px-4 py-3 text-white/40" colSpan={7}>Yükleniyor…</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td className="px-4 py-3 text-white/40" colSpan={7}>Sonuç yok</td></tr>
                    ) : filtered.map((a) => (
                      <tr key={a.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2">
                          <Link to={`/app/agents/${a.id}/edit`} className="text-blue-300 hover:underline">{a.name ?? '—'}</Link>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-white/50">{a.code ?? '—'}</td>
                        <td className="px-4 py-2">
                          {a.role && (
                            <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/60">
                              {ROLE_ICONS[a.role]}
                              {ROLE_LABELS[a.role]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span className="rounded px-1.5 py-0.5 font-mono text-xs"
                            style={{ background: `${RISK_LIGHT[a.risk_ceiling]}18`, color: RISK_LIGHT[a.risk_ceiling] }}>
                            {a.risk_ceiling}
                          </span>
                        </td>
                        <td className="px-4 py-2 max-w-[180px] text-xs text-white/50 truncate">{a.description ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-white/40">{personasForAgent(a).length}</td>
                        <td className="px-4 py-2">
                          <Link to={`/app/agents/${a.id}/edit`}>
                            <Button variant="outline" size="sm">Düzenle</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
