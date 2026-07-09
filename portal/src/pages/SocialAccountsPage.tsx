import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Check, Copy, Link2, Settings2, Trash2, Unlink } from 'lucide-react'

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

// PR-S7c: app yapılandırması — secret asla gelmez, yalnız secret_set
type AppInfo = {
  platform: string
  app_id: string | null
  redirect_uri: string | null
  secret_set: boolean
  source: 'owner' | 'platform' | 'env' | null
  updated_at: string | null
  suggested_redirect_uri: string
}

const SOURCE_LABEL: Record<string, string> = {
  owner:    'Kendi kaydınız',
  platform: 'Platform varsayılanı',
  env:      'Sunucu env',
}

export default function SocialAccountsPage() {
  const init        = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)
  const [params]    = useSearchParams()

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [accounts,  setAccounts]  = useState<AccountRow[]>([])
  const [apps,      setApps]      = useState<AppInfo[]>([])
  const [loading,   setLoading]   = useState(false)
  const [busy,      setBusy]      = useState<string | null>(null)
  const [err,       setErr]       = useState<string | null>(null)
  const [notice,    setNotice]    = useState<string | null>(null)

  // Uygulama ayarları formu
  const [openConfig,   setOpenConfig]   = useState<string | null>(null)
  const [formAppId,    setFormAppId]    = useState('')
  const [formSecret,   setFormSecret]   = useState('')
  const [formRedirect, setFormRedirect] = useState('')
  const [copied,       setCopied]       = useState(false)

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
      const [provRes, accRes, appsRes] = await Promise.all([
        fetch('/api/social/providers', { headers }),
        fetch('/api/social/accounts', { headers }),
        fetch('/api/social/apps', { headers }),
      ])
      if (!provRes.ok) throw new Error(await provRes.text())
      if (!accRes.ok) throw new Error(await accRes.text())
      if (!appsRes.ok) throw new Error(await appsRes.text())
      setProviders(await provRes.json() as ProviderInfo[])
      setAccounts(await accRes.json() as AccountRow[])
      setApps(await appsRes.json() as AppInfo[])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (initialized) load() }, [initialized, load])

  async function authedFetch(path: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Oturum bulunamadı')
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    })
  }

  async function connect(slug: string) {
    setBusy(slug); setErr(null)
    try {
      const resp = await authedFetch(`/api/social/${slug}/oauth/start`)
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
      const resp = await authedFetch(`/api/social/${slug}/disconnect`, { method: 'POST' })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Bağlantı kesilemedi')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function appFor(slug: string): AppInfo | undefined {
    return apps.find((a) => a.platform === slug)
  }

  function toggleConfig(slug: string) {
    if (openConfig === slug) { setOpenConfig(null); return }
    const app = appFor(slug)
    setFormAppId(app?.app_id ?? '')
    setFormSecret('')
    setFormRedirect(app?.redirect_uri ?? app?.suggested_redirect_uri ?? '')
    setCopied(false)
    setOpenConfig(slug)
  }

  async function saveApp(slug: string) {
    setBusy(slug); setErr(null)
    try {
      const resp = await authedFetch(`/api/social/${slug}/app`, {
        method: 'PUT',
        body: JSON.stringify({
          app_id: formAppId,
          app_secret: formSecret || undefined,   // boş → mevcut secret korunur
          redirect_uri: formRedirect || undefined,
        }),
      })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Kaydedilemedi')
      setNotice('Uygulama ayarları kaydedildi.')
      setOpenConfig(null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function removeApp(slug: string) {
    setBusy(slug); setErr(null)
    try {
      const resp = await authedFetch(`/api/social/${slug}/app`, { method: 'DELETE' })
      const json = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(json.error ?? 'Silinemedi')
      setNotice('Uygulama kaydı silindi.')
      setOpenConfig(null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function copyRedirect(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* pano izni yoksa sessiz geç */ }
  }

  function accountFor(slug: string) {
    return accounts.find((a) => a.platform === slug && a.status === 'active')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sosyal hesaplar"
        description="Platform OAuth bağlantıları — token'lar ve app secret'lar şifreli saklanır, burada görünmez."
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
          const app = appFor(p.slug)
          const configured = Boolean(app?.secret_set)
          const isOpen = openConfig === p.slug
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
                  {app?.source && (
                    <p className="mt-2 text-[11px] text-white/35">
                      App: {app.app_id ?? '—'} · {SOURCE_LABEL[app.source] ?? app.source}
                    </p>
                  )}
                </div>
                <Badge className={connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'}>
                  {connected ? 'Bağlı' : configured ? 'Hazır' : 'Yapılandırma gerekli'}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {!connected && (
                  <Button
                    size="sm"
                    disabled={busy === p.slug || loading || !configured}
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
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => toggleConfig(p.slug)}
                >
                  <Settings2 size={14} className="mr-1" /> Uygulama ayarları
                </Button>
              </div>

              {isOpen && (
                <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                  <div>
                    <label className="text-xs text-white/50">App ID</label>
                    <input
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                      value={formAppId}
                      onChange={(e) => setFormAppId(e.target.value)}
                      placeholder="örn. 1234567890"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50">
                      App Secret {app?.secret_set && <span className="text-white/30">(kayıtlı — değiştirmek için doldurun)</span>}
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                      value={formSecret}
                      onChange={(e) => setFormSecret(e.target.value)}
                      placeholder={app?.secret_set ? '••••••••' : 'zorunlu'}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50">Redirect URI</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                        value={formRedirect}
                        onChange={(e) => setFormRedirect(e.target.value)}
                      />
                      <Button size="sm" variant="ghost" onClick={() => copyRedirect(formRedirect)}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    </div>
                    <p className="mt-1 text-[11px] text-white/35">
                      Bu URI'yi {p.displayName} uygulama ayarlarındaki geçerli OAuth redirect listesine birebir ekleyin.
                    </p>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={busy === p.slug} onClick={() => saveApp(p.slug)}>
                      Kaydet
                    </Button>
                    {app?.source === 'owner' && (
                      <Button size="sm" variant="ghost" disabled={busy === p.slug} onClick={() => removeApp(p.slug)}>
                        <Trash2 size={14} className="mr-1" /> Kaydı sil
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {loading && <p className="text-sm text-white/40">Yükleniyor…</p>}
    </div>
  )
}
