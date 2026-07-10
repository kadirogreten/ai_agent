/**
 * D4a — MCP registry keşif istemcisi (okuma-only) + öner/onay.
 * Resmi API: GET {base}/v0.1/servers?search=&version=latest
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPolicy } from './policyReader.js'

export type RegistryEntry = {
  slug: string
  name: string
  description: string | null
  transport: 'http' | 'stdio' | 'streamable-http' | 'sse' | 'unknown'
  endpoint: string | null
  homepage: string | null
  auth_env_hint: string | null
  risk_hint: 'R0' | 'R1' | 'R2' | 'R3'
  raw: Record<string, unknown>
}

export type CachedRegistryRow = RegistryEntry & {
  id: string
  registry_url: string
  fetched_at: string
}

type FetchFn = typeof fetch

const DEFAULT_REGISTRY = 'https://registry.modelcontextprotocol.io'

/** Registry name → yerel mcp_servers.slug (UNIQUE, URL-safe). */
export function slugifyRegistryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'mcp-server'
}

export function estimateRiskHint(description: string | null, envNames: string[]): 'R1' | 'R2' | 'R3' {
  const blob = `${description ?? ''} ${envNames.join(' ')}`.toLowerCase()
  if (/\b(write|delete|purchase|payment|send|post|publish|exec|shell|admin)\b/.test(blob))
    return 'R3'
  if (/\b(create|update|mutate|upload|oauth|token|secret)\b/.test(blob))
    return 'R2'
  return 'R1'
}

type RemoteLike = { type?: string; url?: string; headers?: Array<{ name?: string; isSecret?: boolean }> }
type PackageLike = {
  transport?: { type?: string }
  environmentVariables?: Array<{ name?: string; isSecret?: boolean; isRequired?: boolean }>
}
type ServerDetail = {
  name?: string
  title?: string
  description?: string
  repository?: { url?: string }
  remotes?: RemoteLike[]
  packages?: PackageLike[]
  websiteUrl?: string
}

/** Registry list entry → normalize. Prefer HTTP remotes over stdio packages. */
export function normalizeRegistryServer(
  item: { server?: ServerDetail } | ServerDetail,
): RegistryEntry | null {
  const server = 'server' in item && item.server ? item.server : (item as ServerDetail)
  const registryName = typeof server.name === 'string' ? server.name.trim() : ''
  if (!registryName) return null

  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  const packages = Array.isArray(server.packages) ? server.packages : []
  const httpRemote = remotes.find((r) => {
    const t = (r.type ?? '').toLowerCase()
    return (t === 'streamable-http' || t === 'sse' || t === 'http') && typeof r.url === 'string' && r.url.startsWith('https://')
  })

  let transport: RegistryEntry['transport'] = 'unknown'
  let endpoint: string | null = null
  const envNames: string[] = []

  if (httpRemote?.url) {
    const t = (httpRemote.type ?? 'http').toLowerCase()
    transport = t === 'sse' ? 'sse' : t === 'streamable-http' ? 'streamable-http' : 'http'
    endpoint = httpRemote.url
    for (const h of httpRemote.headers ?? []) {
      if (h.name && /authorization|api[_-]?key/i.test(h.name))
        envNames.push(h.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'))
    }
  } else {
    const pkg = packages[0]
    const pt = (pkg?.transport?.type ?? 'stdio').toLowerCase()
    transport = pt === 'stdio' ? 'stdio' : 'unknown'
    for (const ev of pkg?.environmentVariables ?? []) {
      if (ev.name) envNames.push(ev.name)
    }
  }

  const description = typeof server.description === 'string' ? server.description : null
  const homepage =
    (typeof server.websiteUrl === 'string' && server.websiteUrl) ||
    (typeof server.repository?.url === 'string' && server.repository.url) ||
    null

  const authEnv = envNames.find((n) => /key|token|secret|auth/i.test(n)) ?? envNames[0] ?? null

  return {
    slug: registryName,
    name: typeof server.title === 'string' && server.title.trim()
      ? server.title.trim()
      : registryName,
    description,
    transport,
    endpoint,
    homepage,
    auth_env_hint: authEnv,
    risk_hint: estimateRiskHint(description, envNames),
    raw: server as Record<string, unknown>,
  }
}

export async function fetchRegistryPage(
  baseUrl: string,
  search: string,
  opts?: { limit?: number; fetchFn?: FetchFn },
): Promise<RegistryEntry[]> {
  const fetchFn = opts?.fetchFn ?? fetch
  const limit = opts?.limit ?? 30
  const u = new URL('/v0.1/servers', baseUrl.replace(/\/$/, ''))
  u.searchParams.set('version', 'latest')
  u.searchParams.set('limit', String(limit))
  if (search.trim()) u.searchParams.set('search', search.trim())

  const res = await fetchFn(u.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Registry HTTP ${res.status}: ${baseUrl}`)

  const body = (await res.json()) as { servers?: unknown[] }
  const out: RegistryEntry[] = []
  for (const item of body.servers ?? []) {
    if (!item || typeof item !== 'object') continue
    const n = normalizeRegistryServer(item as { server?: ServerDetail })
    if (n) out.push(n)
  }
  return out
}

export async function refreshRegistryCache(
  supabase: SupabaseClient,
  search: string,
  opts?: { fetchFn?: FetchFn },
): Promise<{ registryUrl: string; upserted: number }> {
  const urls = await getPolicy<string[]>(supabase, null, 'mcp.registry_urls', [DEFAULT_REGISTRY])
  const registryUrl = (Array.isArray(urls) && urls[0]) ? urls[0] : DEFAULT_REGISTRY
  const entries = await fetchRegistryPage(registryUrl, search, { fetchFn: opts?.fetchFn, limit: 40 })
  const now = new Date().toISOString()
  let upserted = 0

  for (const e of entries) {
    const row = {
      registry_url: registryUrl,
      slug: e.slug,
      name: e.name,
      description: e.description,
      transport: e.transport,
      endpoint: e.endpoint,
      homepage: e.homepage,
      auth_env_hint: e.auth_env_hint,
      risk_hint: e.risk_hint,
      raw_json: e.raw,
      fetched_at: now,
    }
    const { error } = await supabase
      .from('mcp_registry_cache')
      .upsert(row, { onConflict: 'registry_url,slug' })
    if (!error) upserted++
  }
  return { registryUrl, upserted }
}

export async function searchCachedRegistry(
  supabase: SupabaseClient,
  query: string,
  opts?: { refreshIfStale?: boolean; fetchFn?: FetchFn; limit?: number },
): Promise<CachedRegistryRow[]> {
  const ttlHours = await getPolicy<number>(supabase, null, 'mcp.registry_cache_ttl_hours', 24)
  const limit = opts?.limit ?? 25
  const q = query.trim().toLowerCase()

  if (opts?.refreshIfStale !== false && q) {
    const { data: newest } = await supabase
      .from('mcp_registry_cache')
      .select('fetched_at')
      .ilike('slug', `%${q.split(/\s+/)[0] ?? q}%`)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const ageMs = newest?.fetched_at
      ? Date.now() - new Date(newest.fetched_at as string).getTime()
      : Number.POSITIVE_INFINITY
    if (ageMs > ttlHours * 3600_000) {
      try {
        await refreshRegistryCache(supabase, q, { fetchFn: opts?.fetchFn })
      } catch {
        // önbellek ile devam
      }
    }
  }

  let qb = supabase
    .from('mcp_registry_cache')
    .select('id, registry_url, slug, name, description, transport, endpoint, homepage, auth_env_hint, risk_hint, fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(limit)

  if (q) {
    qb = qb.or(`slug.ilike.%${q}%,name.ilike.%${q}%,description.ilike.%${q}%`)
  }

  const { data, error } = await qb
  if (error) throw error
  return (data ?? []) as CachedRegistryRow[]
}

/** mcp_servers transport CHECK yalnız http|stdio — streamable-http → http. */
export function mapTransportForDb(t: string): 'http' | 'stdio' {
  if (t === 'stdio') return 'stdio'
  return 'http'
}

export async function proposeMcpServer(
  supabase: SupabaseClient,
  ownerUserId: string,
  entry: Pick<RegistryEntry, 'slug' | 'name' | 'description' | 'transport' | 'endpoint' | 'homepage' | 'auth_env_hint' | 'risk_hint'>,
): Promise<{ id: string; slug: string; status: string }> {
  const localSlug = slugifyRegistryName(entry.slug)
  const endpoint = entry.endpoint?.trim() ?? ''
  if (!endpoint.startsWith('https://')) {
    throw new Error(
      'Bu kayıtta HTTPS remote yok (çoğu stdio paket). AgentArmy şu an yalnız http MCP bağlar — HTTP remote’lu sunucu seçin.',
    )
  }
  const transport = mapTransportForDb(entry.transport)

  // Aynı owner+slug varsa güncelle
  const { data: existing } = await supabase
    .from('mcp_servers')
    .select('id, status')
    .eq('owner_user_id', ownerUserId)
    .eq('slug', localSlug)
    .maybeSingle()

  if (existing?.id) {
    if (existing.status === 'active') {
      throw new Error(`'${localSlug}' zaten aktif bağlı`)
    }
    const { data, error } = await supabase
      .from('mcp_servers')
      .update({
        display_name: entry.name,
        transport,
        endpoint,
        auth_env: entry.auth_env_hint,
        enabled: false,
        status: 'pending_approval',
        registry_slug: entry.slug,
        homepage: entry.homepage,
        risk_hint: entry.risk_hint,
      })
      .eq('id', existing.id)
      .select('id, slug, status')
      .single()
    if (error) throw error
    return data as { id: string; slug: string; status: string }
  }

  const { data, error } = await supabase
    .from('mcp_servers')
    .insert({
      owner_user_id: ownerUserId,
      slug: localSlug,
      display_name: entry.name,
      transport,
      endpoint,
      auth_env: entry.auth_env_hint,
      enabled: false,
      status: 'pending_approval',
      registry_slug: entry.slug,
      homepage: entry.homepage,
      risk_hint: entry.risk_hint,
    })
    .select('id, slug, status')
    .single()
  if (error) throw error
  return data as { id: string; slug: string; status: string }
}

export async function approveMcpServer(
  supabase: SupabaseClient,
  ownerUserId: string,
  serverId: string,
): Promise<{ id: string; slug: string; status: string; transport: string }> {
  const { data: row, error: findErr } = await supabase
    .from('mcp_servers')
    .select('id, slug, status, transport, endpoint')
    .eq('id', serverId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
  if (findErr) throw findErr
  if (!row) throw new Error('Sunucu bulunamadı')
  if (row.status !== 'pending_approval' && row.status !== 'rejected') {
    throw new Error(`Onaylanamaz durum: ${row.status}`)
  }
  if (row.transport !== 'http') {
    throw new Error(`transport='${row.transport}' henüz desteklenmiyor — yalnız http onaylanabilir`)
  }

  const { data, error } = await supabase
    .from('mcp_servers')
    .update({ status: 'active', enabled: true })
    .eq('id', serverId)
    .eq('owner_user_id', ownerUserId)
    .select('id, slug, status, transport')
    .single()
  if (error) throw error
  return data as { id: string; slug: string; status: string; transport: string }
}

export async function rejectMcpServer(
  supabase: SupabaseClient,
  ownerUserId: string,
  serverId: string,
): Promise<void> {
  const { error } = await supabase
    .from('mcp_servers')
    .update({ status: 'rejected', enabled: false })
    .eq('id', serverId)
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'pending_approval')
  if (error) throw error
}

/**
 * Factory köprüsü: eksik araç adlarından registry araması → suggested_mcp[].
 */
export async function suggestMcpForMissingTools(
  supabase: SupabaseClient,
  missingTools: string[],
  opts?: { fetchFn?: FetchFn; maxPerTool?: number },
): Promise<RegistryEntry[]> {
  const maxPer = opts?.maxPerTool ?? 2
  const seen = new Set<string>()
  const out: RegistryEntry[] = []

  for (const tool of missingTools.slice(0, 8)) {
    const q = tool.replace(/_/g, ' ').trim()
    if (!q) continue
    try {
      await refreshRegistryCache(supabase, q, { fetchFn: opts?.fetchFn })
    } catch { /* ignore */ }
    const rows = await searchCachedRegistry(supabase, q, {
      refreshIfStale: false,
      limit: maxPer,
    })
    for (const r of rows) {
      if (seen.has(r.slug)) continue
      seen.add(r.slug)
      out.push({
        slug: r.slug,
        name: r.name,
        description: r.description,
        transport: r.transport as RegistryEntry['transport'],
        endpoint: r.endpoint,
        homepage: r.homepage,
        auth_env_hint: r.auth_env_hint,
        risk_hint: r.risk_hint as RegistryEntry['risk_hint'],
        raw: {},
      })
    }
  }
  return out
}

/** draft_json playbook required_tools vs platform tools → eksikler. */
export async function collectMissingToolSlugs(
  supabase: SupabaseClient,
  draftJson: Record<string, unknown>,
): Promise<string[]> {
  const needed = new Set<string>()
  const playbooks = Array.isArray(draftJson.playbooks) ? draftJson.playbooks : []
  for (const pb of playbooks) {
    if (!pb || typeof pb !== 'object') continue
    const req = (pb as { required_tools?: unknown }).required_tools
    if (Array.isArray(req)) {
      for (const t of req) if (typeof t === 'string' && t.trim()) needed.add(t.trim())
    }
  }
  if (needed.size === 0) return []

  const { data: tools } = await supabase
    .from('tools')
    .select('slug')
    .in('slug', [...needed])
  const have = new Set((tools ?? []).map((t) => t.slug as string))
  return [...needed].filter((s) => !have.has(s))
}
