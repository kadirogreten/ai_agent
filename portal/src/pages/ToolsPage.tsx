import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

// IP1.1: Tool Registry — platform araç kataloğu
// Strateji §5.3: her araç slug, kategori, auth tipi ve config şemasıyla tanımlanır.
// Agent'lar behaviors.requires_web_search gibi bayraklarla araç kullanımını bildirir.

type Tool = {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  auth_type: 'none' | 'api_key' | 'oauth2'
  config_schema: Record<string, unknown>
  enabled: boolean
  tenant_id: string | null
  created_at: string
  updated_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  search:        'Arama',
  communication: 'İletişim',
  calendar:      'Takvim',
  storage:       'Depolama',
  code:          'Kod',
  data:          'Veri',
  utility:       'Yardımcı',
}

const AUTH_BADGE: Record<string, { label: string; tone: 'green' | 'yellow' | 'red' | 'blue' | 'gray' }> = {
  none:    { label: 'Auth Yok',  tone: 'green'  },
  api_key: { label: 'API Key',   tone: 'yellow' },
  oauth2:  { label: 'OAuth 2.0', tone: 'blue'   },
}

function groupByCategory(tools: Tool[]): Map<string, Tool[]> {
  const m = new Map<string, Tool[]>()
  for (const t of tools) {
    if (!m.has(t.category)) m.set(t.category, [])
    m.get(t.category)!.push(t)
  }
  return m
}

export default function ToolsPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [tools, setTools]       = useState<Tool[]>([])
  const [loading, setLoading]   = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [err, setErr]           = useState<string | null>(null)
  const [q, setQ]               = useState('')

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('tools')
      .select('*')
      .order('category')
      .order('name')

    if (error) { setErr(error.message) }
    else { setTools((data ?? []) as Tool[]) }
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function toggleEnabled(tool: Tool) {
    setToggling(tool.id)
    const { error } = await supabase
      .from('tools')
      .update({ enabled: !tool.enabled })
      .eq('id', tool.id)

    if (error) { setErr(error.message) }
    else {
      setTools((prev) => prev.map((t) => t.id === tool.id ? { ...t, enabled: !t.enabled } : t))
    }
    setToggling(null)
  }

  const filtered = q.trim()
    ? tools.filter((t) =>
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.slug.toLowerCase().includes(q.toLowerCase()) ||
        (t.description ?? '').toLowerCase().includes(q.toLowerCase())
      )
    : tools

  const grouped   = groupByCategory(filtered)
  const allCount  = tools.length
  const onCount   = tools.filter((t) => t.enabled).length
  const oauthCount = tools.filter((t) => t.auth_type === 'oauth2').length

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">Tool Registry</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/60">
              {onCount}/{allCount} aktif
            </span>
          </div>
          <div className="text-xs text-white/50">
            Ajan araç kataloğu — aktif araçlar çalıştırma sırasında kullanılabilir
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>Yenile</Button>
      </div>

      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      )}

      {/* KPI özet */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Toplam Araç',   value: allCount,   color: 'text-white' },
          { label: 'Aktif',         value: onCount,    color: 'text-emerald-400' },
          { label: 'Pasif',         value: allCount - onCount, color: 'text-white/50' },
          { label: 'OAuth Gerektiren', value: oauthCount, color: 'text-blue-400' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-white/50">{label}</div>
          </Card>
        ))}
      </div>

      {/* Arama */}
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Araç ara…"
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
      />

      {loading ? (
        <div className="py-8 text-center text-sm text-white/50">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-white/50">Araç bulunamadı.</div>
      ) : (
        Array.from(grouped.entries()).map(([cat, items]) => (
          <Card key={cat} className="overflow-hidden">
            <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-white/40">
              {CATEGORY_LABELS[cat] ?? cat}
            </div>
            <div className="divide-y divide-white/5">
              {items.map((tool) => {
                const authMeta = AUTH_BADGE[tool.auth_type]
                return (
                  <div
                    key={tool.id}
                    className={`flex items-start justify-between gap-4 px-4 py-3 transition-colors ${
                      tool.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    {/* Sol: bilgi */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white/90">{tool.name}</span>
                        <span className="font-mono text-xs text-white/40">{tool.slug}</span>
                        <Badge tone={authMeta.tone}>{authMeta.label}</Badge>
                        {!tool.enabled && (
                          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/40">
                            Pasif
                          </span>
                        )}
                        {tool.auth_type === 'oauth2' && tool.enabled && (
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
                            ⚠ OAuth yapılandırması gerekli
                          </span>
                        )}
                      </div>
                      {tool.description && (
                        <div className="mt-0.5 text-xs text-white/50">{tool.description}</div>
                      )}
                      {/* Config schema özeti */}
                      {tool.config_schema && Object.keys(tool.config_schema).length > 0 && (
                        <div className="mt-1 font-mono text-xs text-white/30">
                          {Object.keys((tool.config_schema as { properties?: Record<string, unknown> }).properties ?? {}).join(' · ')}
                        </div>
                      )}
                    </div>

                    {/* Sağ: toggle */}
                    <button
                      type="button"
                      onClick={() => toggleEnabled(tool)}
                      disabled={toggling === tool.id}
                      title={tool.enabled ? 'Pasif et' : 'Aktif et'}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        tool.enabled ? 'bg-emerald-500' : 'bg-white/20'
                      } ${toggling === tool.id ? 'opacity-50' : ''}`}
                      aria-checked={tool.enabled}
                      role="switch"
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          tool.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}

      {/* Bilgi notu */}
      <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/40">
        <span className="font-medium text-white/60">OAuth 2.0 araçları</span> — Bu araçların aktif edilmesi, agent çalıştırma
        sırasında geçerli bir OAuth token gerektirmektedir. Token yapılandırması henüz portal üzerinden yönetilmemektedir;
        ortam değişkenleri veya servis hesapları kullanılmaktadır.
      </div>
    </div>
  )
}
