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
  side_effect: 'none' | 'read' | 'write' | 'external'
  reversible: boolean
  min_risk: 'R0' | 'R1' | 'R2' | 'R3'
  compensation: string | null
  enabled: boolean
  tenant_id: string | null
  mcp_server_id: string | null
  mcp_tool_name: string | null
  created_at: string
  updated_at: string
}

type ToolInvocation = {
  id: string
  tool_slug: string
  status: 'pending' | 'succeeded' | 'failed' | 'blocked' | 'compensated'
  side_effect: string | null
  risk_level: string | null
  error: string | null
  created_at: string
  compensation_status: 'succeeded' | 'failed' | null
  compensated_at: string | null
}

type ToolOverride = { tool_slug: string; enabled: boolean }

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

type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'gray'

const SIDE_EFFECT_META: Record<string, { label: string; tone: Tone }> = {
  none:     { label: 'etkisiz',    tone: 'gray'   },
  read:     { label: 'okuma',      tone: 'green'  },
  write:    { label: 'yazma',      tone: 'yellow' },
  external: { label: 'dış sistem', tone: 'red'    },
}

const INV_STATUS_TONE: Record<string, Tone> = {
  succeeded:   'green',
  failed:      'red',
  blocked:     'yellow',
  pending:     'gray',
  compensated: 'blue',
}

function riskTone(r: string): Tone {
  if (r === 'R3') return 'red'
  if (r === 'R2') return 'yellow'
  return 'green'
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

  const [tools,      setTools]      = useState<Tool[]>([])
  const [loading,    setLoading]    = useState(false)
  const [toggling,   setToggling]   = useState<string | null>(null)
  const [deletingOv, setDeletingOv] = useState<string | null>(null)
  const [err,        setErr]        = useState<string | null>(null)
  const [q,          setQ]          = useState('')
  const [invocations, setInvocations] = useState<ToolInvocation[]>([])
  const [overrides,  setOverrides]  = useState<ToolOverride[]>([])

  // D4a — MCP keşif
  const [discoverQ, setDiscoverQ] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverResults, setDiscoverResults] = useState<Array<{
    slug: string
    name: string
    description: string | null
    transport: string
    endpoint: string | null
    homepage: string | null
    auth_env_hint: string | null
    risk_hint: string
    bindable?: boolean
  }>>([])
  const [pendingServers, setPendingServers] = useState<Array<{
    id: string
    slug: string
    display_name: string
    status: string
    risk_hint: string | null
    transport: string
    endpoint: string
  }>>([])
  const [mcpBusy, setMcpBusy] = useState<string | null>(null)
  const [mcpMsg, setMcpMsg] = useState<string | null>(null)

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

    const inv = await supabase
      .from('tool_invocations')
      .select('id,tool_slug,status,side_effect,risk_level,error,created_at,compensation_status,compensated_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!inv.error) setInvocations((inv.data ?? []) as ToolInvocation[])

    // Kullanıcı override'larını yükle
    const { data: ovRows } = await supabase
      .from('tool_overrides')
      .select('tool_slug, enabled')
    setOverrides(ovRows as ToolOverride[] ?? [])

    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function authHeaders(): Promise<HeadersInit | null> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return null
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    }
  }

  async function loadPendingMcp() {
    const headers = await authHeaders()
    if (!headers) return
    const res = await fetch('/api/mcp/servers?status=pending_approval', { headers })
    if (!res.ok) return
    const body = await res.json() as { servers?: typeof pendingServers }
    setPendingServers(body.servers ?? [])
  }

  useEffect(() => {
    if (initialized && user) void loadPendingMcp()
  }, [initialized, user])

  async function searchRegistry() {
    const headers = await authHeaders()
    if (!headers) { setErr('Oturum gerekli'); return }
    if (!discoverQ.trim()) return
    setDiscovering(true); setErr(null); setMcpMsg(null)
    try {
      const res = await fetch(
        `/api/mcp/registry/search?q=${encodeURIComponent(discoverQ.trim())}&refresh=1`,
        { headers },
      )
      const body = await res.json() as { results?: typeof discoverResults; error?: string }
      if (!res.ok) throw new Error(body.error ?? res.statusText)
      setDiscoverResults(body.results ?? [])
      if ((body.results ?? []).length === 0) setMcpMsg('Sonuç yok — başka bir anahtar kelime deneyin.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setDiscovering(false)
    }
  }

  async function proposeEntry(entry: (typeof discoverResults)[0]) {
    const headers = await authHeaders()
    if (!headers) return
    setMcpBusy(entry.slug); setErr(null); setMcpMsg(null)
    try {
      const res = await fetch('/api/mcp/propose', {
        method: 'POST',
        headers,
        body: JSON.stringify(entry),
      })
      const body = await res.json() as { error?: string; slug?: string }
      if (!res.ok) throw new Error(body.error ?? res.statusText)
      setMcpMsg(`Önerildi: ${body.slug} (onay bekliyor)`)
      await loadPendingMcp()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setMcpBusy(null)
    }
  }

  async function approveServer(id: string) {
    const headers = await authHeaders()
    if (!headers) return
    setMcpBusy(id); setErr(null)
    try {
      const res = await fetch(`/api/mcp/servers/${id}/approve`, { method: 'POST', headers })
      const body = await res.json() as { error?: string; hint?: string; slug?: string }
      if (!res.ok) throw new Error(body.error ?? res.statusText)
      setMcpMsg(body.hint ?? `Onaylandı: ${body.slug}`)
      await loadPendingMcp()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setMcpBusy(null)
    }
  }

  async function rejectServer(id: string) {
    const headers = await authHeaders()
    if (!headers) return
    setMcpBusy(id); setErr(null)
    try {
      const res = await fetch(`/api/mcp/servers/${id}/reject`, { method: 'POST', headers })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error ?? res.statusText)
      await loadPendingMcp()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setMcpBusy(null)
    }
  }

  async function toggleEnabled(tool: Tool) {
    setToggling(tool.id)
    setErr(null)

    if (tool.tenant_id === null) {
      // Platform aracı: tool_overrides'a upsert (tools satırına yazmak RLS ile artık yasak)
      // Mevcut override varsa tersine çevir; yoksa platform değerini tersine çevir.
      const existing = overrides.find((o) => o.tool_slug === tool.slug)
      const newEnabled = existing ? !existing.enabled : !tool.enabled
      const { error } = await supabase
        .from('tool_overrides')
        .upsert({ tool_slug: tool.slug, enabled: newEnabled }, { onConflict: 'owner_user_id,tool_slug' })
      if (error) { setErr(error.message) }
      else {
        setOverrides((prev) => {
          const filtered = prev.filter((o) => o.tool_slug !== tool.slug)
          return [...filtered, { tool_slug: tool.slug, enabled: newEnabled }]
        })
      }
    } else {
      // Kendi tenant aracı: doğrudan güncelle
      const { error } = await supabase
        .from('tools')
        .update({ enabled: !tool.enabled })
        .eq('id', tool.id)
      if (error) { setErr(error.message) }
      else {
        setTools((prev) => prev.map((t) => t.id === tool.id ? { ...t, enabled: !t.enabled } : t))
      }
    }
    setToggling(null)
  }

  async function removeOverride(slug: string) {
    setDeletingOv(slug); setErr(null)
    const { error } = await supabase
      .from('tool_overrides')
      .delete()
      .eq('tool_slug', slug)
    if (error) { setErr(error.message) }
    else {
      setOverrides((prev) => prev.filter((o) => o.tool_slug !== slug))
    }
    setDeletingOv(null)
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
        title="Araçlar"
        description="Ajan araç kataloğu — sözleşme (yan etki/risk/geri-alınabilirlik) ve son çağrılar"
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
      {mcpMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{mcpMsg}</div>
      )}

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white/90">MCP keşfet (D4a)</div>
            <p className="text-xs text-white/40">
              Resmi registry’de ara → öner → onayla. Yalnız HTTPS remote’lu sunucular bağlanır.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={discoverQ}
            onChange={(e) => setDiscoverQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void searchRegistry() }}
            placeholder="örn. github, filesystem, slack…"
            className="min-w-[200px] flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
          />
          <Button size="sm" onClick={() => void searchRegistry()} disabled={discovering || !discoverQ.trim()}>
            {discovering ? 'Aranıyor…' : 'Ara'}
          </Button>
        </div>
        {discoverResults.length > 0 && (
          <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
            {discoverResults.map((r) => (
              <div key={r.slug} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-white/90">{r.name}</span>
                    <span className="font-mono text-xs text-white/30">{r.slug}</span>
                    <Badge tone={riskTone(r.risk_hint)}>{r.risk_hint}</Badge>
                    <Badge tone={r.bindable ? 'green' : 'gray'}>{r.transport}</Badge>
                  </div>
                  {r.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-white/45">{r.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!r.bindable || mcpBusy === r.slug}
                  onClick={() => void proposeEntry(r)}
                  title={r.bindable ? 'Onay kuyruğuna öner' : 'HTTPS remote yok'}
                >
                  {mcpBusy === r.slug ? '…' : 'Öner'}
                </Button>
              </div>
            ))}
          </div>
        )}
        {pendingServers.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-widest text-white/30">Onay bekleyen</div>
            {pendingServers.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <div>
                  <span className="text-sm text-white/90">{s.display_name}</span>
                  <span className="ml-2 font-mono text-xs text-white/35">{s.slug}</span>
                  {s.risk_hint && <Badge tone={riskTone(s.risk_hint)}>{s.risk_hint}</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={mcpBusy === s.id} onClick={() => void approveServer(s.id)}>Onayla</Button>
                  <Button size="sm" variant="outline" disabled={mcpBusy === s.id} onClick={() => void rejectServer(s.id)}>Reddet</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
                          {SIDE_EFFECT_META[tool.side_effect] && (
                            <Badge tone={SIDE_EFFECT_META[tool.side_effect].tone}>{SIDE_EFFECT_META[tool.side_effect].label}</Badge>
                          )}
                          {tool.min_risk && <Badge tone={riskTone(tool.min_risk)}>{tool.min_risk}</Badge>}
                          {(tool.side_effect === 'write' || tool.side_effect === 'external') && (
                            <Badge tone={tool.reversible ? 'green' : 'red'}>
                              {tool.reversible ? 'geri-alınabilir' : 'geri-alınamaz'}
                            </Badge>
                          )}
                          {tool.mcp_server_id && (
                            <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-xs text-purple-300"
                              title={tool.mcp_tool_name ? `MCP araç adı: ${tool.mcp_tool_name}` : 'MCP proxy aracı'}>
                              MCP
                            </span>
                          )}
                          {!tool.enabled && (
                            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/40">
                              Pasif
                            </span>
                          )}
                          {tool.mcp_server_id && tool.side_effect === 'external' && !tool.reversible && (
                            <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-xs text-orange-300"
                              title="Faz A kuralı: external + geri-alınamaz → sözleşme doldurulana kadar çalıştırılamaz">
                              ⚠ Sözleşme gerekli
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

                      <div className="flex flex-col items-end gap-1">
                        {/* Platform aracında override varsa rozet + "varsayılana dön" */}
                        {tool.tenant_id === null && overrides.some((o) => o.tool_slug === tool.slug) && (
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">kişisel ayar</span>
                            <button
                              onClick={() => removeOverride(tool.slug)}
                              disabled={deletingOv === tool.slug}
                              className="text-[10px] text-white/30 hover:text-white/60 transition"
                              title="Varsayılana dön (override'ı sil)"
                            >
                              ↩ sıfırla
                            </button>
                          </div>
                        )}
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
                    </div>
                  )
                })}
              </div>
            </Card>
          </motion.div>
        ))
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-white/30">
          Son araç çağrıları
        </div>
        {invocations.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-white/30">Henüz araç çağrısı yok.</div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {invocations.map((iv) => (
              <div key={iv.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-white/70">{iv.tool_slug}</span>
                  {iv.risk_level && <Badge tone={riskTone(iv.risk_level)}>{iv.risk_level}</Badge>}
                  {iv.error && <span className="truncate text-xs text-red-300/70">{iv.error}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={INV_STATUS_TONE[iv.status] ?? 'gray'}>{iv.status}</Badge>
                  {iv.status === 'compensated' && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        iv.compensation_status === 'succeeded' ? 'bg-emerald-500/20 text-emerald-300' :
                        iv.compensation_status === 'failed'    ? 'bg-red-500/20 text-red-300' :
                        'bg-white/10 text-white/40'
                      }`}
                      title={iv.compensated_at ? `Telafi: ${new Date(iv.compensated_at).toLocaleString('tr-TR')}` : ''}
                    >
                      ↩ Telafi {iv.compensation_status ?? ''}
                    </span>
                  )}
                  <span className="text-xs text-white/30">{new Date(iv.created_at).toLocaleString('tr-TR')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border border-white/[0.06] p-4">
        <div className="text-xs text-white/40">
          <span className="font-medium text-white/50">OAuth 2.0 araçları</span> — Bu araçların aktif edilmesi, agent çalıştırma sırasında geçerli bir OAuth token gerektirmektedir. Token yapılandırması henüz portal üzerinden yönetilmemektedir.
        </div>
      </Card>
    </div>
  )
}
