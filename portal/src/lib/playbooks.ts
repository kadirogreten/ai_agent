import { supabase } from '@/lib/supabaseClient'

export type PlaybookStep = {
  id: string
  agent: string
  goal: string
  output: string
  saveAs?: string
}

export type PlaybookRow = {
  id: string
  slug: string
  pack_id: string
  tenant_id: string | null
  name: string
  description: string | null
  goal: string | null
  steps: PlaybookStep[]
  default_risk: 'R0' | 'R1' | 'R2' | 'R3'
  required_tools: string[]
  tags: string[]
  content_json: Record<string, unknown> | null
  version: number
  created_at: string
  updated_at: string
}

export type UpsertPlaybookInput = {
  slug: string
  pack_id: string
  name: string
  description: string | null
  goal: string | null
  steps: PlaybookStep[]
  default_risk: 'R0' | 'R1' | 'R2' | 'R3'
  required_tools: string[]
  tags: string[]
  version: number
}

export async function listPlaybooks(params: { q: string; packId?: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('playbooks')
    .select('id,slug,pack_id,tenant_id,name,description,goal,steps,default_risk,required_tools,tags,content_json,version,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (params.packId) query = query.eq('pack_id', params.packId)
  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }

  const res = await query
  return {
    data: (res.data ?? []) as PlaybookRow[],
    error: res.error?.message ?? null,
  }
}

export async function getPlaybook(playbookId: string) {
  const res = await supabase
    .from('playbooks')
    .select('id,slug,pack_id,tenant_id,name,description,goal,steps,default_risk,required_tools,tags,content_json,version,created_at,updated_at')
    .eq('id', playbookId)
    .maybeSingle()
  return {
    data: (res.data ?? null) as PlaybookRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createPlaybook(input: UpsertPlaybookInput) {
  const res = await supabase.from('playbooks').insert(input).select('id').single()
  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updatePlaybook(playbookId: string, input: UpsertPlaybookInput) {
  const res = await supabase.from('playbooks').update(input).eq('id', playbookId)
  return { ok: !res.error, error: res.error?.message ?? null }
}

export async function deletePlaybook(playbookId: string) {
  const res = await supabase.from('playbooks').delete().eq('id', playbookId)
  return { ok: !res.error, error: res.error?.message ?? null }
}

/**
 * Persona-uyumlu playbook listesi:
 *   - Aynı pack'te olan VEYA persona cross-domain (pack_id NULL) ise tüm pack'lerdekiler
 *   - playbook.default_risk ≤ persona.risk_ceiling (risk seviyesi persona tavanını aşmasın)
 *
 * Bu çalıştırma wizard'ında kullanılır: kullanıcı persona seçtiğinde uyumsuz playbook'lar
 * (çok yüksek riskli, yanlış pack) listede gösterilmez.
 */
export async function listPlaybooksForPersona(persona: {
  pack_id: string | null
  risk_ceiling: 'R0' | 'R1' | 'R2' | 'R3'
}) {
  const riskRank: Record<string, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }
  const ceiling  = riskRank[persona.risk_ceiling] ?? 1

  let query = supabase
    .from('playbooks')
    .select('id,slug,pack_id,tenant_id,name,description,goal,steps,default_risk,required_tools,tags,content_json,version,created_at,updated_at')
    .order('name')
    .limit(500)

  // Persona pack-specifik ise sadece o pack; cross-domain ise tüm pack'ler.
  if (persona.pack_id) query = query.eq('pack_id', persona.pack_id)

  const res = await query
  const rows = (res.data ?? []) as PlaybookRow[]

  // Risk tavanı client-side filtre (DB'de ENUM ordering yok).
  const compatible = rows.filter((p) => (riskRank[p.default_risk] ?? 1) <= ceiling)

  return {
    data: compatible,
    error: res.error?.message ?? null,
  }
}

// Domain pack listesi — playbook/persona ekleme formunda dropdown için
export async function listDomainPacks() {
  const res = await supabase
    .from('domain_packs')
    .select('id,name')
    .eq('status', 'active')
    .order('name')
  return {
    data: (res.data ?? []) as { id: string; name: string }[],
    error: res.error?.message ?? null,
  }
}
