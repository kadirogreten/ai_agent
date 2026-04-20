import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { createAgent, getAgent, normalizeAgentCode, updateAgent, type UpsertAgentInput } from '@/lib/agents'

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

function CapabilitiesInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const items = value

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
            const next = uniqNonEmpty([...items, draft])
            if (next.length !== items.length) onChange(next)
            setDraft('')
          }}
        />
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            const next = uniqNonEmpty([...items, draft])
            if (next.length !== items.length) onChange(next)
            setDraft('')
          }}
          disabled={!draft.trim()}
        >
          Ekle
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length === 0 ? <div className="text-xs text-white/50">Henüz yetenek eklenmedi</div> : null}
        {items.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(items.filter((x) => x !== c))}
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

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!canQuery) return
    if (!effectiveId) return
    setLoading(true)
    setErr(null)
    getAgent(effectiveId)
      .then((res) => {
        if (res.error) {
          setErr(res.error)
          return
        }
        if (!res.data) {
          setErr('Ajan bulunamadı')
          return
        }
        setName(res.data.name)
        setCode(res.data.code)
        setDescription(res.data.description ?? '')
        setCapabilities(res.data.capabilities ?? [])
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
    }),
    [capabilities, description, name, normalized]
  )

  const canSave = !!input.name && !!input.code && !loading

  async function save() {
    if (!canQuery) return
    if (!canSave) return
    setSaving(true)
    setErr(null)
    if (mode === 'new') {
      const res = await createAgent(input)
      if (res.error) {
        setErr(res.error)
        setSaving(false)
        return
      }
      navigate('/app/agents')
      return
    }

    if (!effectiveId) {
      setErr('Ajan id bulunamadı')
      setSaving(false)
      return
    }

    const res = await updateAgent(effectiveId, input)
    if (res.error) {
      setErr(res.error)
      setSaving(false)
      return
    }
    navigate('/app/agents')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{mode === 'new' ? 'Yeni Ajan' : 'Ajanı Düzenle'}</div>
          <div className="text-xs text-white/50">Ad, kod, açıklama ve “neler yapar” yetenekleri</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/app/agents')} disabled={saving}>
            İptal
          </Button>
          <Button onClick={save} disabled={saving || !canSave}>
            Kaydet
          </Button>
        </div>
      </div>

      <Card className="p-4">
        {err ? <div className="mb-3 text-sm text-red-200">{err}</div> : null}
        {loading ? <div className="text-sm text-white/60">Yükleniyor...</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-white/60">Ajan adı</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            {!name.trim() ? <div className="mt-1 text-xs text-red-200">Zorunlu</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-white/60">Ajan kodu</div>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SALES_ASSISTANT" />
            <div className="mt-1 text-xs text-white/50">Kaydedilecek kod: {normalized || '-'}</div>
            {!normalized ? <div className="mt-1 text-xs text-red-200">Zorunlu</div> : null}
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Açıklama</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-24 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
            />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-white/60">Neler yapar (yetenekler)</div>
            <CapabilitiesInput value={capabilities} onChange={setCapabilities} />
          </div>
        </div>
      </Card>
    </div>
  )
}
