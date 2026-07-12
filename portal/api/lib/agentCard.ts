/**
 * D4b — A2A Agent Card builder (keşif-only, kamuya-uygun alanlar).
 * Spec path: /.well-known/agent-card.json
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPolicy } from './policyReader.js'

export const A2A_CARD_CACHE_CONTROL = 'public, max-age=300'

export type AgentSkill = {
  id: string
  name: string
  description: string
  tags?: string[]
  examples?: string[]
  'x-agentarmy.risk'?: 'R0' | 'R1' | 'R2' | 'R3'
  'x-agentarmy.requires_human_approval'?: boolean
}

export type AgentCard = {
  protocolVersion: string
  name: string
  description: string
  version: string
  url: string
  supportedInterfaces: Array<{
    url: string
    protocolBinding: string
    protocolVersion: string
  }>
  capabilities: { streaming: boolean; pushNotifications: boolean }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentSkill[]
  provider?: { organization: string; url?: string }
  securitySchemes?: Record<string, { type: string; scheme?: string; description?: string }>
  additionalInterfaces?: Array<{ slug: string; name: string }>
}

type PackRow = {
  id: string
  name: string
  description: string | null
  status: string
  version: number | null
  meta: Record<string, unknown> | null
}

type PlaybookRow = {
  slug: string
  name: string
  description: string | null
  goal: string | null
  default_risk: 'R0' | 'R1' | 'R2' | 'R3'
  tags: string[] | null
}

type PersonaRow = {
  slug: string
  name: string
}

const FORBIDDEN_CARD_KEYS = [
  'system_prompt',
  'required_tools',
  'glossary_md',
  'regulatory_notes_md',
  'verifier_rubric_md',
  'content_md',
  'content_json',
  'steps',
  'auth_env',
  'api_key',
  'secret',
] as const

/** Kamuya uygun kısa açıklama — tool listesi / iç not satırlarını düşür. */
export function sanitizePublicDescription(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? '').trim() || fallback
  const lines = text.split(/\r?\n/).filter((line) => {
    const l = line.trim().toLowerCase()
    if (!l) return false
    if (/^tools?\s*:/.test(l)) return false
    if (/required_tools/.test(l)) return false
    if (/system[_ ]?prompt/.test(l)) return false
    if (/^\s*[-*]\s*(file_store|purchase_order|web_scrape)\b/.test(l)) return false
    return true
  })
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim()
  return (joined || fallback).slice(0, 280)
}

export function isPackA2aPublic(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.a2a_public === true
}

export function validateAgentCard(card: unknown): { ok: true } | { ok: false; error: string } {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return { ok: false, error: 'card object zorunlu' }
  }
  const c = card as Record<string, unknown>
  for (const k of ['name', 'description', 'version', 'url'] as const) {
    if (typeof c[k] !== 'string' || !(c[k] as string).trim()) {
      return { ok: false, error: `${k} zorunlu` }
    }
  }
  if (!Array.isArray(c.skills) || c.skills.length < 1) {
    return { ok: false, error: 'skills en az 1 olmalı' }
  }
  for (const skill of c.skills) {
    if (!skill || typeof skill !== 'object') return { ok: false, error: 'skill geçersiz' }
    const s = skill as Record<string, unknown>
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.description !== 'string') {
      return { ok: false, error: 'skill id/name/description zorunlu' }
    }
    for (const bad of FORBIDDEN_CARD_KEYS) {
      if (bad in s) return { ok: false, error: `skill içinde yasaklı alan: ${bad}` }
    }
  }
  const json = JSON.stringify(c)
  for (const bad of ['system_prompt', 'SUPABASE_SERVICE', 'api_key', 'Bearer ']) {
    if (json.includes(bad)) return { ok: false, error: `kart sızıntı şüphesi: ${bad}` }
  }
  return { ok: true }
}

export function playbookToSkill(pb: PlaybookRow): AgentSkill {
  const risk = pb.default_risk ?? 'R1'
  const desc = sanitizePublicDescription(
    pb.description ?? pb.goal,
    `${pb.name} playbook`,
  )
  const skill: AgentSkill = {
    id: pb.slug,
    name: pb.name,
    description: desc,
    tags: Array.isArray(pb.tags) ? pb.tags.slice(0, 8).map(String) : undefined,
    'x-agentarmy.risk': risk,
  }
  if (risk === 'R3') skill['x-agentarmy.requires_human_approval'] = true
  return skill
}

export function buildAgentCardFromRows(opts: {
  pack: PackRow
  playbooks: PlaybookRow[]
  personas: PersonaRow[]
  baseUrl: string
}): AgentCard {
  const { pack, playbooks, personas, baseUrl } = opts
  const origin = baseUrl.replace(/\/$/, '')
  const a2aUrl = `${origin}/api/a2a`
  const skills = playbooks.map(playbookToSkill)
  if (skills.length === 0) {
    skills.push({
      id: 'general-assist',
      name: 'General assist',
      description: sanitizePublicDescription(pack.description, pack.name),
      'x-agentarmy.risk': 'R1',
    })
  }

  const card: AgentCard = {
    protocolVersion: '0.3.0',
    name: pack.name,
    description: sanitizePublicDescription(pack.description, pack.name),
    version: String(pack.version ?? 1),
    url: a2aUrl,
    supportedInterfaces: [
      {
        url: a2aUrl,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '0.3.0',
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills,
    provider: {
      organization: 'AgentArmy',
      url: origin,
    },
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        description: 'Invocation auth arrives in D4c (discovery-only until then).',
      },
    },
  }

  if (personas.length > 0) {
    card.additionalInterfaces = personas.slice(0, 12).map((p) => ({
      slug: p.slug,
      name: p.name,
    }))
  }

  return card
}

export async function resolvePackForCard(
  supabase: SupabaseClient,
  packId: string | null,
): Promise<PackRow | null> {
  const defaultId = await getPolicy<string>(
    supabase,
    null,
    'a2a.default_pack_id',
    'sosyal-medya-reklam-gelirleri',
  )
  const id = (packId?.trim() || defaultId || '').trim()
  if (!id) return null

  const { data, error } = await supabase
    .from('domain_packs')
    .select('id, name, description, status, version, meta')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as PackRow
}

export async function isCardGateOpen(
  supabase: SupabaseClient,
  pack: PackRow,
): Promise<boolean> {
  const globalOn = await getPolicy<boolean>(supabase, null, 'a2a.card_enabled', false)
  if (globalOn === true) return true
  return isPackA2aPublic(pack.meta)
}

export async function loadAgentCard(
  supabase: SupabaseClient,
  opts: { packId?: string | null; baseUrl: string },
): Promise<{ card: AgentCard } | { status: 404; error: string }> {
  const pack = await resolvePackForCard(supabase, opts.packId ?? null)
  if (!pack || pack.status !== 'active') {
    return { status: 404, error: 'pack not found' }
  }
  const open = await isCardGateOpen(supabase, pack)
  if (!open) {
    return { status: 404, error: 'agent card disabled' }
  }

  const [{ data: playbooks }, { data: personas }] = await Promise.all([
    supabase
      .from('playbooks')
      .select('slug, name, description, goal, default_risk, tags')
      .eq('pack_id', pack.id)
      .order('slug'),
    supabase
      .from('personas')
      .select('slug, name')
      .eq('pack_id', pack.id)
      .order('slug'),
  ])

  const card = buildAgentCardFromRows({
    pack,
    playbooks: (playbooks ?? []) as PlaybookRow[],
    personas: (personas ?? []) as PersonaRow[],
    baseUrl: opts.baseUrl,
  })

  const v = validateAgentCard(card)
  if (v.ok === false) {
    return { status: 404, error: v.error }
  }
  return { card }
}

export function publicCardBaseUrl(reqHost: string | undefined, protoHeader: string | undefined): string {
  const host = (reqHost ?? 'localhost').split(',')[0].trim()
  const proto = (protoHeader ?? 'https').split(',')[0].trim() || 'https'
  if (host.includes('localhost') || host.startsWith('127.')) {
    return `http://${host}`
  }
  return `${proto}://${host}`
}
