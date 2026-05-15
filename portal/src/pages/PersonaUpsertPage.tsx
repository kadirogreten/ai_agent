import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import {
  createPersona,
  deletePersona,
  getPersona,
  updatePersona,
  type UpsertPersonaInput,
} from '@/lib/personas'
import { listDomainPacks } from '@/lib/playbooks'

type Mode = 'new' | 'edit'

export default function PersonaUpsertPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const params = useParams<{ personaId?: string }>()
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)

  const [slug, setSlug] = useState('')
  const [packId, setPackId] = useState<string>('')
  const [name, setName] = useState('')
  const [roleDesc, setRoleDesc] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [riskCeiling, setRiskCeiling] = useState<'R0' | 'R1' | 'R2' | 'R3'>('R2')
  const [costClass, setCostClass] = useState<'low' | 'medium' | 'high'>('medium')

  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canEdit = initialized && !!user

  useEffect(() => {
    if (!canEdit) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canEdit])

  useEffect(() => {
    if (mode !== 'edit' || !params.personaId || !canEdit) return
    getPersona(params.personaId).then((res) => {
      if (res.error || !res.data) {
        setErr(res.error ?? 'Persona bulunamadı')
        return
      }
      const p = res.data
      setSlug(p.slug)
      setPackId(p.pack_id ?? '')
      setName(p.name)
      setRoleDesc(p.role_description ?? '')
      setSystemPrompt(p.system_prompt ?? '')
      setContentMd(p.content_md ?? '')
      setRiskCeiling(p.risk_ceiling)
      setCostClass(p.cost_class)
    })
  }, [mode, params.personaId, canEdit])

  async function onSave() {
    setErr(null)
    if (!slug.trim() || !name.trim()) {
      setErr('Slug ve ad zorunludur.')
      return
    }
    const input: UpsertPersonaInput = {
      slug: slug.trim(),
      pack_id: packId || null,
      name: name.trim(),
      role_description: roleDesc.trim() || null,
      system_prompt: systemPrompt.trim() || null,
      content_md: contentMd.trim() || null,
      risk_ceiling: riskCeiling,
      cost_class: costClass,
    }
    setSaving(true)
    const res = mode === 'new'
      ? await createPersona(input)
      : await updatePersona(params.personaId!, input)
    setSaving(false)
    if ('error' in res && res.error) {
      setErr(res.error)
      return
    }
    navigate('/app/personas')
  }

  async function onDelete() {
    if (mode !== 'edit' || !params.personaId) return
    if (!confirm('Bu personayı silmek istediğinden emin misin?')) return
    setDeleting(true)
    const res = await deletePersona(params.personaId)
    setDeleting(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    navigate('/app/personas')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {mode === 'new' ? 'Yeni Persona' : 'Personayı Düzenle'}
        </h1>
        <Link to="/app/personas">
          <Button variant="secondary" size="sm">Geri</Button>
        </Link>
      </div>

      {err ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-white/60">Slug (benzersiz, örn: merchandiser)</div>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="merchandiser" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Ad</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Merchandiser" />
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Domain Pack</div>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
            >
              <option value="">(cross-domain — pack_id NULL)</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Risk Tavanı</div>
            <select
              value={riskCeiling}
              onChange={(e) => setRiskCeiling(e.target.value as 'R0' | 'R1' | 'R2' | 'R3')}
              className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
            >
              <option value="R0">R0 — Zararsız</option>
              <option value="R1">R1 — Düşük</option>
              <option value="R2">R2 — Orta</option>
              <option value="R3">R3 — Yüksek</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Maliyet Sınıfı</div>
            <select
              value={costClass}
              onChange={(e) => setCostClass(e.target.value as 'low' | 'medium' | 'high')}
              className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
            >
              <option value="low">Düşük</option>
              <option value="medium">Orta</option>
              <option value="high">Yüksek</option>
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-white/60">Rol Açıklaması</div>
          <textarea
            value={roleDesc}
            onChange={(e) => setRoleDesc(e.target.value)}
            placeholder="Ne yapar?"
            className="min-h-[60px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 text-sm"
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-white/60">Sistem Prompt'u (opsiyonel)</div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Sen ... bir ajansın..."
            className="min-h-[120px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 font-mono text-xs"
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-white/60">Persona Markdown İçeriği (run sırasında prompt'a inject edilir)</div>
          <textarea
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            placeholder="# Persona: ..."
            className="min-h-[200px] w-full rounded-md border border-white/10 bg-[#111A33] p-3 font-mono text-xs"
          />
        </div>

        <div className="flex justify-between">
          {mode === 'edit' ? (
            <Button variant="ghost" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Siliniyor...' : 'Sil'}
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Link to="/app/personas">
              <Button variant="secondary">İptal</Button>
            </Link>
            <Button onClick={onSave} disabled={saving}>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
