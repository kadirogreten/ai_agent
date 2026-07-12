import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { KeyRound, Trash2, Plus, Webhook } from 'lucide-react'

type ApiKeyRow = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  enabled: boolean
  last_used_at: string | null
  created_at: string
}

type WebhookRow = {
  id: string
  url: string
  events: string[]
  enabled: boolean
  created_at: string
}

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Oturum bulunamadı')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

export default function PublicApiPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [enabled, setEnabled] = useState(false)
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)

  const [keyName, setKeyName] = useState('default')
  const [whUrl, setWhUrl] = useState('')

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)
    try {
      const headers = await authHeaders()
      const [st, k, w] = await Promise.all([
        fetch('/api/public-api/status', { headers }),
        fetch('/api/public-api/keys', { headers }),
        fetch('/api/public-api/webhooks', { headers }),
      ])
      const stJ = await st.json() as { enabled?: boolean; error?: string }
      const kJ = await k.json() as { keys?: ApiKeyRow[]; error?: string }
      const wJ = await w.json() as { webhooks?: WebhookRow[]; error?: string }
      if (!st.ok) throw new Error(stJ.error ?? 'status')
      if (!k.ok) throw new Error(kJ.error ?? 'keys')
      if (!w.ok) throw new Error(wJ.error ?? 'webhooks')
      setEnabled(stJ.enabled === true)
      setKeys(kJ.keys ?? [])
      setWebhooks(wJ.webhooks ?? [])
    } catch (e) {
      setErr((e as Error).message)
    }
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { void load() }, [load])

  async function createKey() {
    setErr(null)
    setPlaintext(null)
    try {
      const headers = await authHeaders()
      const resp = await fetch('/api/public-api/keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: keyName.trim() || 'default',
          scopes: ['operations:write', 'operations:read'],
        }),
      })
      const json = await resp.json() as { plaintext?: string; error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'create failed')
      setPlaintext(json.plaintext ?? null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function revokeKey(id: string) {
    setErr(null)
    try {
      const headers = await authHeaders()
      const resp = await fetch(`/api/public-api/keys/${id}`, { method: 'DELETE', headers })
      if (!resp.ok) {
        const json = await resp.json() as { error?: string }
        throw new Error(json.error ?? 'delete failed')
      }
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function createWebhook() {
    setErr(null)
    setWebhookSecret(null)
    try {
      const headers = await authHeaders()
      const resp = await fetch('/api/public-api/webhooks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: whUrl.trim(),
          events: ['operation.done', 'operation.escalated'],
        }),
      })
      const json = await resp.json() as { secret?: string; error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'create failed')
      setWebhookSecret(json.secret ?? null)
      setWhUrl('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function removeWebhook(id: string) {
    setErr(null)
    try {
      const headers = await authHeaders()
      const resp = await fetch(`/api/public-api/webhooks/${id}`, { method: 'DELETE', headers })
      if (!resp.ok) {
        const json = await resp.json() as { error?: string }
        throw new Error(json.error ?? 'delete failed')
      }
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (!initialized) return null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<KeyRound size={18} />}
        title="Public API"
        description="API anahtarları ve imzalı webhook'lar. Dış tetik kapısı varsayılan kapalıdır."
      />

      {!enabled && (
        <div className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded px-3 py-2">
          Global/owner <code className="text-amber-100">public_api.enabled</code> şu an{' '}
          <strong>false</strong>. Kod hazır; aktivasyon Politikalar üzerinden bilinçli override ile yapılır
          (eval + D3 gözlem sonrası). Kapalıyken <code className="text-amber-100">POST /api/v1/*</code> → 503.
        </div>
      )}

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {err}
        </div>
      )}

      {plaintext && (
        <div className="text-sm bg-emerald-500/10 border border-emerald-500/25 rounded px-3 py-2 space-y-1">
          <p className="text-emerald-200 font-medium">Yeni API anahtarı (bir kez gösterilir)</p>
          <code className="block break-all text-emerald-100 select-all">{plaintext}</code>
        </div>
      )}

      {webhookSecret && (
        <div className="text-sm bg-emerald-500/10 border border-emerald-500/25 rounded px-3 py-2 space-y-1">
          <p className="text-emerald-200 font-medium">Webhook secret (bir kez gösterilir)</p>
          <code className="block break-all text-emerald-100 select-all">{webhookSecret}</code>
        </div>
      )}

      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80 flex items-center gap-2">
          <KeyRound size={14} /> API anahtarları
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder-white/30"
            placeholder="İsim"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
          <Button size="sm" onClick={() => void createKey()} disabled={loading}>
            <Plus size={14} className="mr-1" /> Oluştur
          </Button>
        </div>
        <ul className="space-y-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-2 text-sm border border-white/10 rounded px-3 py-2"
            >
              <div>
                <span className="text-white/90">{k.name}</span>
                <span className="ml-2 text-white/40 font-mono">{k.key_prefix}…</span>
                <span className="ml-2 text-white/30 text-xs">{k.scopes.join(', ')}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void revokeKey(k.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
          {!loading && keys.length === 0 && (
            <li className="text-xs text-white/35">Henüz anahtar yok.</li>
          )}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80 flex items-center gap-2">
          <Webhook size={14} /> Webhook uçları
        </p>
        <p className="text-xs text-white/40">
          Yalnız <code>context_json.source=public_api</code> operasyonları tetikler (HTTPS + HMAC).
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 min-w-56 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder-white/30"
            placeholder="https://example.com/hooks/agentarmy"
            value={whUrl}
            onChange={(e) => setWhUrl(e.target.value)}
            type="url"
          />
          <Button size="sm" onClick={() => void createWebhook()} disabled={loading || !whUrl.trim()}>
            <Plus size={14} className="mr-1" /> Ekle
          </Button>
        </div>
        <ul className="space-y-2">
          {webhooks.map((w) => (
            <li
              key={w.id}
              className="flex items-center justify-between gap-2 text-sm border border-white/10 rounded px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-white/90 break-all">{w.url}</span>
                <span className="ml-2 text-white/30 text-xs">{w.events?.join(', ')}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void removeWebhook(w.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
          {!loading && webhooks.length === 0 && (
            <li className="text-xs text-white/35">Henüz webhook yok.</li>
          )}
        </ul>
      </Card>
    </div>
  )
}
