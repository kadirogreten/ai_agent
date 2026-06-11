import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Cpu } from 'lucide-react'

type Provider = {
  id:               string
  slug:             string
  display_name:     string
  api_base:         string
  api_key_env:      string
  model_id:         string
  kind:             'openai' | 'anthropic'
  tier:             'basic' | 'standard' | 'frontier'
  max_decision_risk: string
  enabled:          boolean
  is_default_for:   string[]
}

const TIER_COLOR: Record<string, string> = {
  basic:    'bg-white/10 text-white/50',
  standard: 'bg-blue-500/20 text-blue-300',
  frontier: 'bg-purple-500/20 text-purple-300',
}

const PURPOSE_LABELS: Record<string, string> = { run: 'Run', decide: 'Decide', facts: 'Facts' }
const ALL_PURPOSES = ['run', 'decide', 'facts']

export default function LlmProvidersPage() {
  const init        = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)

  const [providers, setProviders] = useState<Provider[]>([])
  const [loading,   setLoading]   = useState(false)
  const [patching,  setPatching]  = useState<string | null>(null)
  const [err,       setErr]       = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/llm-providers', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) throw new Error(await resp.text())
      setProviders(await resp.json() as Provider[])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (initialized) load() }, [initialized, load])

  async function patch(id: string, updates: { enabled?: boolean; is_default_for?: string[] }) {
    setPatching(id); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Oturum bulunamadı')
      const resp = await fetch(`/api/llm-providers/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify(updates),
      })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Güncelleme başarısız')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPatching(null)
    }
  }

  function toggleDefault(provider: Provider, purpose: string) {
    const hasDefault = provider.is_default_for.includes(purpose)
    if (hasDefault) {
      // Kaldır
      patch(provider.id, { is_default_for: provider.is_default_for.filter((p) => p !== purpose) })
    } else {
      // Ekle — route diğer provider'lardan kaldırır
      patch(provider.id, { is_default_for: [...provider.is_default_for, purpose] })
    }
  }

  if (!initialized) return null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Cpu size={18} />}
        title="LLM Sağlayıcılar"
        description="Model seçimi ve varsayılan atamalar. api_key_env: env değişkeninin adı, anahtarın kendisi değil."
      />

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-white/40">Yükleniyor…</p>
      ) : providers.length === 0 ? (
        <Card className="p-6 text-center text-sm text-white/40">Provider bulunamadı.</Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <Card key={p.id} className="p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-sm text-white/90">{p.display_name}</span>
                <span className="font-mono text-xs text-white/40">{p.model_id}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TIER_COLOR[p.tier] ?? ''}`}>
                  {p.tier}
                </span>
                <span className="text-[10px] text-white/30 border border-white/10 px-1.5 py-0.5 rounded">
                  max {p.max_decision_risk}
                </span>
                <span className="text-[10px] text-white/30">
                  {p.kind} · {p.api_key_env}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => patch(p.id, { enabled: !p.enabled })}
                    disabled={patching === p.id}
                    className={`text-xs px-2 py-0.5 rounded border transition ${
                      p.enabled
                        ? 'border-green-500/30 text-green-400 bg-green-500/10 hover:bg-green-500/20'
                        : 'border-white/10 text-white/30 hover:bg-white/5'
                    }`}
                  >
                    {patching === p.id ? '…' : p.enabled ? 'Aktif' : 'Pasif'}
                  </button>
                </div>
              </div>

              {/* Varsayılan atamalar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-white/30">Varsayılan:</span>
                {ALL_PURPOSES.map((purpose) => {
                  const isDefault = p.is_default_for.includes(purpose)
                  return (
                    <button
                      key={purpose}
                      onClick={() => toggleDefault(p, purpose)}
                      disabled={patching === p.id}
                      className={`text-[10px] px-2 py-0.5 rounded border transition ${
                        isDefault
                          ? 'border-blue-500/40 text-blue-300 bg-blue-500/15 hover:bg-blue-500/25'
                          : 'border-white/10 text-white/30 hover:bg-white/5'
                      }`}
                    >
                      {PURPOSE_LABELS[purpose] ?? purpose}
                    </button>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
        Yenile
      </Button>
    </div>
  )
}
