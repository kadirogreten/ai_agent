import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import {
  createPlaybook,
  deletePlaybook,
  getPlaybook,
  listDomainPacks,
  updatePlaybook,
  type PlaybookStep,
  type UpsertPlaybookInput,
} from '@/lib/playbooks'

type Mode = 'new' | 'edit'

const emptyStep = (): PlaybookStep => ({
  id: 'step-' + Math.random().toString(36).slice(2, 6),
  agent: 'Researcher',
  goal: '',
  output: '',
})

export default function PlaybookUpsertPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const params = useParams<{ playbookId?: string }>()
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const canEdit = initialized && !!user

  const [slug, setSlug] = useState('')
  const [packId, setPackId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [goal, setGoal] = useState('')
  const [defaultRisk, setDefaultRisk] = useState<'R0' | 'R1' | 'R2' | 'R3'>('R1')
  const [tags, setTags] = useState('')
  const [requiredTools, setRequiredTools] = useState<string[]>([])
  const [version, setVersion] = useState(1)
  const [steps, setSteps] = useState<PlaybookStep[]>([emptyStep()])

  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [availableTools, setAvailableTools] = useState<{ slug: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!canEdit) return
    listDomainPacks().then((res) => setPacks(res.data))
    supabase
      .from('tools')
      .select('slug,name')
      .eq('enabled', true)
      .order('name')
      .then((res) => setAvailableTools((res.data ?? []) as { slug: string; name: string }[]))
  }, [canEdit])

  useEffect(() => {
    if (mode !== 'edit' || !params.playbookId || !canEdit) return
    getPlaybook(params.playbookId).then((res) => {
      if (res.error || !res.data) {
        setErr(res.error ?? 'Playbook bulunamadı')
        return
      }
      const p = res.data
      setSlug(p.slug)
      setPackId(p.pack_id)
      setName(p.name)
      setDescription(p.description ?? '')
      setGoal(p.goal ?? '')
      setDefaultRisk(p.default_risk)
      setTags((p.tags ?? []).join(', '))
      setRequiredTools(p.required_tools ?? [])
      setVersion(p.version)
      setSteps(p.steps?.length ? p.steps : [emptyStep()])
    })
  }, [mode, params.playbookId, canEdit])

  function updateStep(idx: number, patch: Partial<PlaybookStep>) {
    setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  function addStep() { setSteps((arr) => [...arr, emptyStep()]) }
  function removeStep(idx: number) { setSteps((arr) => arr.filter((_, i) => i !== idx)) }
  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((arr) => {
      const next = [...arr]
      const j = idx + dir
      if (j < 0 || j >= next.length) return arr
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function onSave() {
    setErr(null)
    if (!slug.trim() || !name.trim() || !packId) {
      setErr('Slug, ad ve domain pack zorunludur.')
      return
    }
    if (steps.length === 0 || steps.some((s) => !s.id || !s.agent || !s.goal)) {
      setErr('En az 1 adım gerekli; her adımda id, agent ve goal dolu olmalı.')
      return
    }

    const input: UpsertPlaybookInput = {
      slug: slug.trim(),
      pack_id: packId,
      name: name.trim(),
      description: description.trim() || null,
      goal: goal.trim() || null,
      steps,
      default_risk: defaultRisk,
      required_tools: requiredTools,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      version,
    }
    setSaving(true)
    const res = mode === 'new'
      ? await createPlaybook(input)
      : await updatePlaybook(params.playbookId!, input)
    setSaving(false)
    if ('error' in res && res.error) {
      setErr(res.error)
      return
    }
    navigate('/app/playbooks')
  }

  async function onDelete() {
    if (mode !== 'edit' || !params.playbookId) return
    if (!confirm('Bu playbook silinsin mi?')) return
    setDeleting(true)
    const res = await deletePlaybook(params.playbookId)
    setDeleting(false)
    if (res.error) { setErr(res.error); return }
    navigate('/app/playbooks')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{mode === 'new' ? 'Yeni Playbook' : 'Playbook Düzenle'}</h1>
        <Link to="/app/playbooks"><Button variant="secondary" size="sm">Geri</Button></Link>
      </div>

      {err ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>
      ) : null}

      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-white/60">Slug (benzersiz)</div>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="urun-aciklama-uret" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Ad</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ürün Açıklama Üret" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Domain Pack</div>
            <select value={packId} onChange={(e) => setPackId(e.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm">
              <option value="">Seç...</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Default Risk</div>
            <select value={defaultRisk} onChange={(e) => setDefaultRisk(e.target.value as 'R0'|'R1'|'R2'|'R3')} className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm">
              <option value="R0">R0</option><option value="R1">R1</option><option value="R2">R2</option><option value="R3">R3</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Etiketler (virgülle)</div>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ecommerce, content" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Bağımlı Tool'lar</div>
            <div className="flex flex-wrap gap-2">
              {availableTools.length === 0 && (
                <span className="text-xs text-white/30">Araç bulunamadı (Araçlar sayfası).</span>
              )}
              {availableTools.map((t) => {
                const on = requiredTools.includes(t.slug)
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() =>
                      setRequiredTools((prev) =>
                        on ? prev.filter((s) => s !== t.slug) : [...prev, t.slug],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      on
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                        : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20'
                    }`}
                    title={t.slug}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Versiyon</div>
            <Input type="number" value={version} onChange={(e) => setVersion(parseInt(e.target.value || '1', 10))} />
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-white/60">Hedef (Goal)</div>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Bu playbook neye hizmet eder?" className="min-h-[60px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 text-sm" />
        </div>
        <div>
          <div className="mb-1 text-xs text-white/60">Açıklama</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 text-sm" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Adımlar (sıralı yürütülür)</div>
            <Button variant="outline" size="sm" onClick={addStep}>+ Adım Ekle</Button>
          </div>
          {steps.map((s, idx) => (
            <Card key={idx} className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/50">#{idx + 1}</div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => moveStep(idx, -1)}>↑</Button>
                  <Button variant="ghost" size="sm" onClick={() => moveStep(idx, 1)}>↓</Button>
                  <Button variant="ghost" size="sm" onClick={() => removeStep(idx)}>Sil</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input value={s.id} onChange={(e) => updateStep(idx, { id: e.target.value })} placeholder="adım id (örn: research)" />
                <Input value={s.agent} onChange={(e) => updateStep(idx, { agent: e.target.value })} placeholder="Agent (örn: Researcher)" />
              </div>
              <textarea value={s.goal} onChange={(e) => updateStep(idx, { goal: e.target.value })} placeholder="Adım hedefi" className="min-h-[50px] w-full rounded-md border border-white/10 bg-[#111A33] p-2 text-sm" />
              <textarea value={s.output} onChange={(e) => updateStep(idx, { output: e.target.value })} placeholder="Beklenen çıktı formatı" className="min-h-[50px] w-full rounded-md border border-white/10 bg-[#111A33] p-2 text-sm" />
              <Input value={s.saveAs ?? ''} onChange={(e) => updateStep(idx, { saveAs: e.target.value || undefined })} placeholder="saveAs dosya adı (opsiyonel)" />
            </Card>
          ))}
        </div>

        <div className="flex justify-between">
          {mode === 'edit' ? (
            <Button variant="ghost" onClick={onDelete} disabled={deleting}>{deleting ? 'Siliniyor...' : 'Sil'}</Button>
          ) : <div />}
          <div className="flex gap-2">
            <Link to="/app/playbooks"><Button variant="secondary">İptal</Button></Link>
            <Button onClick={onSave} disabled={saving}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
