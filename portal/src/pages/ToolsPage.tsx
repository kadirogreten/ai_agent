import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { Wrench } from 'lucide-react'
import { motion } from 'framer-motion'

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
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [tools,    setTools]    = useState<Tool[]>([])
  const [loading,  setLoading]  = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [err,      setErr]      = useState<string | null>(null)
  const [q,        setQ]        = useState('')

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
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

  const grouped    = groupByCategory(filtered)
  const allCount   = tools.length
  const onCount    = tools.filter((t) => t.enabled).length
  const oauthCount = tools.filter((t) => t.auth_type === 'oauth2').length

  const kpiCards = [
    { label: 'Toplam Araç', value: allCount, color: 'text-white/90' },
    { label: 'Aktif', value: onCount, color: 'text-emerald-400' },
    { label: 'Pasif', value: allCount - onCount, color: 'text-white/50' },
    { label: 'OAuth Gerektiren', value: oauthCount, color: 'text-blue-400' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tool Registry"
        description="Ajan araç kataloğu — aktif araçlar çalıştırma sırasında kullanılabilir"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>Yenile</Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-4">
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-white/40">{k.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>
      )}

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Araç ara…"
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
      />

      {loading ? (
        <div className="py-12 text-center text-sm text-white/40">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <Wrench size={24} className="mx-auto mb-2 text-white/20" />
          <p className="text-sm text-white/40">Araç bulunamadı</p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([cat, items], catIdx) => (
          <motion.div
            key={cat}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: catIdx * 0.05 }}
          >
            <Card className="overflow-hidden">
              <div className="border-b border-white/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-white/30">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              <div className="divide-y divide-white/[0.06]">
                {items.map((tool) => {
                  const authMeta = AUTH_BADGE[tool.auth_type]
                  return (
                    <div
                      key={tool.id}
                      className={`flex items-start justify-between gap-4 px-4 py-3 transition-colors ${
                        tool.enabled ? '' : 'opacity-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white/90">{tool.name}</span>
                          <span className="font-mono text-xs text-white/30">{tool.slug}</span>
                          <Badge tone={authMeta.tone}>{authMeta.label}</Badge>
                          {!tool.enabled && (
                            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/40">
                              Pasif
                            </span>
                          )}
                          {tool.auth_type === 'oauth2' && tool.enabled && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
                              ⚠ Yapılandırma gerekli
                            </span>
                          )}
                        </div>
                        {tool.description && (
                          <div className="mt-0.5 text-xs text-white/40">{tool.description}</div>
                        )}
                        {tool.config_schema && Object.keys(tool.config_schema).length > 0 && (
                          <div className="mt-1 font-mono text-xs text-white/20">
                            {Object.keys((tool.config_schema as { properties?: Record<string, unknown> }).properties ?? {}).join(' · ')}
                          </div>
                        )}
                      </div>

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
          </motion.div>
        ))
      )}

      <Card className="border border-white/[0.06] p-4">
        <div className="text-xs text-white/40">
          <span className="font-medium text-white/50">OAuth 2.0 araçları</span> — Bu araçların aktif edilmesi, agent çalıştırma sırasında geçerli bir OAuth token gerektirmektedir. Token yapılandırması henüz portal üzerinden yönetilmemektedir.
        </div>
      </Card>
    </div>
  )
}
