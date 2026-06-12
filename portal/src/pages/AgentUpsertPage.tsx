import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import {
  createAgent,
  getAgent,
  normalizeAgentCode,
  updateAgent,
  type AgentBehaviors,
  type AgentRole,
  type CostClass,
  type RiskCeiling,
  type UpsertAgentInput,
} from '@/lib/agents'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: AgentRole; label: string; desc: string }[] = [
  { value: 'ceo', label: 'CEO / Yönetim', desc: 'Hedef bölme, delegasyon, eskalasyon yönetimi' },
  { value: 'research', label: 'Araştırma', desc: 'Kaynak tarar, not çıkarır' },
  { value: 'analysis', label: 'Analiz', desc: 'İddiaları test eder, tutarlılık kontrolü' },
  { value: 'writing', label: 'Yazım', desc: 'Rapor / metin üretir' },
  { value: 'editing', label: 'Editör', desc: 'Dil, ton, format standardı' },
  { value: 'verification', label: 'Denetçi', desc: 'Kaynak doğrulama, risk etiketleme' },
  { value: 'operation', label: 'Operatör', desc: 'Araç çağırır, otomasyon yapar' },
  { value: 'contrarian', label: 'Contrarian', desc: '"Bu neden yanlış olabilir?" raporu' },
  { value: 'design', label: 'Tasarım', desc: 'UI/UX, görsel tasarım görevleri' },
  { value: 'code', label: 'Kod', desc: 'Yazılım geliştirme, teknik analiz' },
  { value: 'architecture', label: 'Mimari', desc: 'Domain pack / sistem iskeleti tasarımı' },
]

const RISK_OPTIONS: { value: RiskCeiling; label: string; color: string }[] = [
  { value: 'R0', label: 'R0 — Zararsız', color: 'text-emerald-300' },
  { value: 'R1', label: 'R1 — Düşük risk', color: 'text-blue-300' },
  { value: 'R2', label: 'R2 — Orta risk (Verifier + insan onayı)', color: 'text-amber-300' },
  { value: 'R3', label: 'R3 — Yüksek risk (zorunlu insan onayı)', color: 'text-red-300' },
]

const COST_OPTIONS: { value: CostClass; label: string }[] = [
  { value: 'low', label: 'Düşük (< 500 token/adım)' },
  { value: 'medium', label: 'Orta (500–2000 token/adım)' },
  { value: 'high', label: 'Yüksek (2000+ token/adım)' },
]

const BEHAVIOR_FIELDS: { key: keyof AgentBehaviors; label: string; desc: string }[] = [
  { key: 'requires_web_search', label: 'Web Araması', desc: 'Çalışmak için web_search aracına ihtiyaç duyar' },
  { key: 'requires_full_context', label: 'Tam Bağlam', desc: 'Hafızanın tamamına ihtiyaç duyar' },
  { key: 'writes_to_facts', label: 'Facts Yazar', desc: 'Çıktıları Facts deposuna kaydeder' },
  { key: 'writes_to_decisions', label: 'Decisions Yazar', desc: 'Kararları Decisions deposuna kaydeder' },
  { key: 'captures_verifier_report', label: 'Verifier Raporu', desc: 'Denetçi raporunu çıktıya iliştirir' },
  { key: 'triggers_contrarian', label: 'Contrarian Tetikler', desc: 'R2+ risk seviyesinde Contrarian çalıştırır' },
  { key: 'accepts_rubric', label: 'Rubrik Kabul', desc: 'Domain Pack rubriğini girdi olarak alır' },
  { key: 'prefers_domain_allowlist', label: 'Domain Allowlist', desc: 'Araştırmada allowed-domains.txt\'i önceliklendirir' },
]

// ─── Yardımcı bileşenler ──────────────────────────────────────────────────────

function uniqNonEmpty(xs: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of xs) {
    const v = x.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function CapabilitiesInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Örn: Müşteri maili taslağı yazar"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const next = uniqNonEmpty([...value, draft])
            if (next.length !== value.length) onChange(next)
            setDraft('')
          }}
        />
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            const next = uniqNonEmpty([...value, draft])
            if (next.length !== value.length) onChange(next)
            setDraft('')
          }}
          disabled={!draft.trim()}
        >
          Ekle
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {value.length === 0 ? <div className="text-xs text-white/50">Henüz yetenek eklenmedi</div> : null}
        {value.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(value.filter((x) => x !== c))}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
          >
            {c}
            <span className="text-white/60">×</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function BehaviorsInput({ value, onChange }: { value: AgentBehaviors; onChange: (next: AgentBehaviors) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {BEHAVIOR_FIELDS.map(({ key, label, desc }) => (
        <label
          key={key}
          className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-white/5 p-2.5 hover:bg-white/8"
        >
          <input
            type="checkbox"
            checked={!!value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            className="mt-0.5 accent-blue-400"
          />
          <div>
            <div className="text-xs font-medium text-white/90">{label}</div>
            <div className="text-xs text-white/50">{desc}</div>
          </div>
        </label>
      ))}
    </div>
  )
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

const DEFAULT_BEHAVIORS: AgentBehaviors = {}

export default function AgentUpsertPage({ mode }: { mode: 'new' | 'edit' }) {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const { agentId } = useParams()
  const navigate = useNavigate()

  const canQuery = initialized && !!user
  const effectiveId = mode === 'edit' ? (agentId as string | undefined) : undefined

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // temel alanlar
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])

  // manifest alanlar
  const [role, setRole] = useState<AgentRole | ''>('')
  const [riskCeiling, setRiskCeiling] = useState<RiskCeiling>('R1')
  const [costClass, setCostClass] = useState<CostClass>('medium')
  const [behaviors, setBehaviors] = useState<AgentBehaviors>(DEFAULT_BEHAVIORS)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tenantOverridable, setTenantOverridable] = useState(true)

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!canQuery || !effectiveId) return
    setLoading(true)
    setErr(null)
    getAgent(effectiveId)
      .then((res) => {
        if (res.error) { setErr(res.error); return }
        if (!res.data) { setErr('Ajan bulunamadı'); return }
        const d = res.data
        setName(d.name)
        setCode(d.code)
        setDescription(d.description ?? '')
        setCapabilities(d.capabilities ?? [])
        setRole(d.role ?? '')
        setRiskCeiling(d.risk_ceiling)
        setCostClass(d.cost_class)
        setBehaviors(d.behaviors ?? {})
        setSystemPrompt(d.system_prompt ?? '')
        setTenantOverridable(d.tenant_overridable)
      })
      .finally(() => setLoading(false))
  }, [canQuery, effectiveId])

  const normalized = useMemo(() => normalizeAgentCode(code), [code])
  const input: UpsertAgentInput = useMemo(
    () => ({
      name: name.trim(),
      code: normalized,
      description: description.trim() ? description.trim() : null,
      capabilities: uniqNonEmpty(capabilities),
      role: role || null,
      risk_ceiling: riskCeiling,
      cost_class: costClass,
      behaviors,
      system_prompt: systemPrompt.trim() ? systemPrompt.trim() : null,
      tenant_overridable: tenantOverridable,
    }),
    [name, normalized, description, capabilities, role, riskCeiling, costClass, behaviors, systemPrompt, tenantOverridable]
  )

  const canSave = !!input.name && !!input.code && !loading

  async function save() {
    if (!canQuery || !canSave) return
    setSaving(true)
    setErr(null)
    if (mode === 'new') {
      const res = await createAgent(input)
      if (res.error) { setErr(res.error); setSaving(false); return }
      navigate('/app/agents')
      return
    }
    if (!effectiveId) { setErr('Ajan id bulunamadı'); setSaving(false); return }
    const res = await updateAgent(effectiveId, input)
    if (res.error) { setErr(res.error); setSaving(false); return }
    navigate('/app/agents')
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Başlık + aksiyonlar */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{mode === 'new' ? 'Yeni Ajan' : 'Ajanı Düzenle'}</div>
          <div className="text-xs text-white/50">Manifest alanları: ad, rol, risk seviyesi, davranış bayrakları</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/app/agents')} disabled={saving}>İptal</Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </div>
      </div>

      {err ? <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div> : null}
      {loading ? <div className="text-sm text-white/60">Yükleniyor...</div> : null}

      {/* Bölüm 1: Temel Bilgiler */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">Temel Bilgiler</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-white/60">Ajan adı *</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            {!name.trim() ? <div className="mt-1 text-xs text-red-300">Zorunlu</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Ajan kodu *</div>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="RESEARCHER_V2" />
            <div className="mt-1 text-xs text-white/40">Kaydedilecek: {normalized || '—'}</div>
            {!normalized ? <div className="mt-0.5 text-xs text-red-300">Zorunlu</div> : null}
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Açıklama</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="min-h-16 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
              placeholder="Bu ajanın kısa amaç tanımı"
            />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Neler yapar (yetenekler)</div>
            <CapabilitiesInput value={capabilities} onChange={setCapabilities} />
          </div>
        </div>
      </Card>

      {/* Bölüm 2: Manifest — Rol & Risk */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">Manifest — Rol & Risk</div>
        <div className="grid gap-3 md:grid-cols-3">
          {/* Rol */}
          <div>
            <div className="mb-1 text-xs text-white/60">Fonksiyonel rol</div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AgentRole | '')}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
            >
              <option value="">— Seçiniz —</option>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
              ))}
            </select>
          </div>

          {/* Risk ceiling */}
          <div>
            <div className="mb-1 text-xs text-white/60">Maksimum risk seviyesi</div>
            <select
              value={riskCeiling}
              onChange={(e) => setRiskCeiling(e.target.value as RiskCeiling)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
            >
              {RISK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="mt-1 text-xs text-white/40">
              R2/R3: Verifier + insan onayı zorunlu
            </div>
          </div>

          {/* Cost class */}
          <div>
            <div className="mb-1 text-xs text-white/60">Maliyet sınıfı</div>
            <select
              value={costClass}
              onChange={(e) => setCostClass(e.target.value as CostClass)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
            >
              {COST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tenant overridable */}
        <div className="mt-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={tenantOverridable}
              onChange={(e) => setTenantOverridable(e.target.checked)}
              className="accent-blue-400"
            />
            <div>
              <span className="text-sm text-white/90">Tenant özelleştirilebilir</span>
              <span className="ml-2 text-xs text-white/40">Tenant bu ajanı kendi sistem promptuyla ezebilir</span>
            </div>
          </label>
        </div>
      </Card>

      {/* Bölüm 3: Davranış Bayrakları */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/40">Davranış Bayrakları</div>
        <BehaviorsInput value={behaviors} onChange={setBehaviors} />
      </Card>

      {/* Bölüm 4: Sistem Promptu */}
      <Card className="p-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">Sistem Promptu</div>
        <div className="mb-2 text-xs text-white/40">
          Boş bırakılırsa description + capabilities'ten otomatik üretilir.
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
          placeholder="Sen bir uzman araştırmacısın. Görevin: kaynakları taramak, alıntıları düzenlemek ve güven puanı eklemek."
        />
      </Card>
    </div>
  )
}
