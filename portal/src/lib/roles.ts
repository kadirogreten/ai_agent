import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentRoleMeta = {
  slug:        string
  label:       string
  description: string
  color:       string   // CSS hex '#rrggbb'
  icon:        string   // lucide icon name
  sort_order:  number
}

// ── Module-level cache (5 min TTL) ────────────────────────────────────────────

let _cache:   AgentRoleMeta[] | null = null
let _cacheAt = 0
const CACHE_TTL = 5 * 60 * 1000

export async function fetchAgentRoles(): Promise<AgentRoleMeta[]> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache
  const { data, error } = await supabase
    .from('agent_roles')
    .select('slug, label, description, color, icon, sort_order')
    .order('sort_order')
  if (error || !data) return _cache ?? []
  _cache  = data as AgentRoleMeta[]
  _cacheAt = Date.now()
  return _cache
}

export function invalidateRolesCache() {
  _cache   = null
  _cacheAt = 0
}

// ── Lookup helper ─────────────────────────────────────────────────────────────

const FALLBACK_COLOR = '#64748b'
const FALLBACK_ICON  = 'Bot'

export function getRoleMeta(
  slug: string | null | undefined,
  roles: AgentRoleMeta[]
): AgentRoleMeta {
  if (!slug) return { slug: '', label: '—', description: '', color: FALLBACK_COLOR, icon: FALLBACK_ICON, sort_order: 99 }
  const found = roles.find((r) => r.slug === slug)
  if (found) return found
  // Unknown slug — graceful fallback; visible in UI as slug text with neutral color
  return { slug, label: slug, description: '', color: FALLBACK_COLOR, icon: FALLBACK_ICON, sort_order: 99 }
}

// ── Three.js color helper ─────────────────────────────────────────────────────

export function cssHexToThree(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}
