import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Link2, Unlink } from 'lucide-react'

type ProviderInfo = {
  slug: string
  displayName: string
  available: boolean
}

type AccountRow = {
  id: string
  platform: string
  external_account_id: string
  status: string
  expires_at: string | null
  metadata: Record<string, unknown>
  updated_at: string
}

export default function SocialAccountsPage() {
  const init        = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)
  const [params]    = useSearchParams()

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [accounts,  setAccounts]  = useState<AccountRow[]>([])
  const [loading,   setLoading]   = useState(false)
  const [busy,      setBusy]      = useState<string | null>(null)
  const [err,       setErr]       = useState<string | null>(null)
  const [notice,    setNotice]    = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  useEffect(() => {
    const oauth = params.get('oauth')
    const platform = params.get('platform')
    if (oauth === 'success') setNotice(`${platform ?? 'Hesap'} başarıyla bağlandı.`)
    if (oauth === 'error') setErr('OAuth bağlantısı başarısız oldu.')
  }, [params])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [provRes, accRes] = await Promise.all([
        fetch('/api/social/providers', { headers }),
        fetch('/api/social/accounts', { headers }),
      ])
      if (!provRes.ok) throw new Error(await provRes.text())
      if (!accRes.ok) throw new Error(await accRes.text())
      setProviders(await provRes.json() as ProviderInfo[])
      setAccounts(await accRes.json() as AccountRow[])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (initialized) load() }, [initialized, load])

  async function connect(slug: string) {
    setBusy(slug); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Oturum bulunamadı')
      const resp = await fetch(`/api/social/${slug}/oauth/start`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json() as { authorizeUrl?: string; error?: string }
      if (!resp.ok || !json.authorizeUrl) throw new Error(json.error ?? 'OAuth başlatılamadı')
      window.location.href = json.authorizeUrl
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }

  async function disconnect(slug: string) {
    setBusy(slug); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Oturum bulunamadı')
      const resp = await fetch(`/api/social/${slug}/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Bağlantı kesilemedi')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function accountFor(slug: string) {
    return accounts.find((a) => a.platform === slug && a.status === 'active')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sosyal hesaplar"
        description="Platform OAuth bağlantıları — token'lar şifreli saklanır, burada görünmez."
      />

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => {
          const acc = accountFor(p.slug)
          const connected = Boolean(acc)
          return (
            <Card key={p.slug} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-white">{p.displayName}</h3>
                  <p className="mt-1 text-xs text-white/40">platform: {p.slug}</p>
                  {connected && acc && (
                    <div className="mt-3 space-y-1 text-xs text-white/60">
                      <div>Hesap: {String(acc.metadata?.name ?? acc.external_account_id)}</div>
                      {acc.expires_at && (
                        <div>Token süresi: {new Date(acc.expires_at).toLocaleString('tr-TR')}</div>
                      )}
                    </div>
                  )}
                </div>
                <Badge className={connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'}>
                  {connected ? 'Bağlı' : p.available ? 'Hazır' : 'Yakında'}
                </Badge>
              </div>
              <div className="mt-4 flex gap-2">
                {p.available && !connected && (
                  <Button
                    size="sm"
                    disabled={busy === p.slug || loading}
                    onClick={() => connect(p.slug)}
                  >
                    <Link2 size={14} className="mr-1" /> Bağla
                  </Button>
                )}
                {connected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p.slug || loading}
                    onClick={() => disconnect(p.slug)}
                  >
                    <Unlink size={14} className="mr-1" /> Kes
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {loading && <p className="text-sm text-white/40">Yükleniyor…</p>}
    </div>
  )
}
