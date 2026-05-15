import { supabase } from '@/lib/supabaseClient'

export type PersonaRow = {
  id: string
  slug: string
  pack_id: string | null
  tenant_id: string | null
  name: string
  role_description: string | null
  system_prompt: string | null
  behaviors: Record<string, unknown>
  risk_ceiling: 'R0' | 'R1' | 'R2' | 'R3'
  cost_class: 'low' | 'medium' | 'high'
  content_md: string | null
  created_at: string
  updated_at: string
}

export type UpsertPersonaInput = {
  slug: string
  pack_id: string | null
  name: string
  role_description: string | null
  system_prompt: string | null
  content_md: string | null
  risk_ceiling: 'R0' | 'R1' | 'R2' | 'R3'
  cost_class: 'low' | 'medium' | 'high'
}

export async function listPersonas(params: { q: string; packId?: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('personas')
    .select('id,slug,pack_id,tenant_id,name,role_description,system_prompt,behaviors,risk_ceiling,cost_class,content_md,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (params.packId) query = query.eq('pack_id', params.packId)
  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }

  const res = await query
  return {
    data: (res.data ?? []) as PersonaRow[],
    error: res.error?.message ?? null,
  }
}

export async function getPersona(personaId: string) {
  const res = await supabase
    .from('personas')
    .select('id,slug,pack_id,tenant_id,name,role_description,system_prompt,behaviors,risk_ceiling,cost_class,content_md,created_at,updated_at')
    .eq('id', personaId)
    .maybeSingle()

  return {
    data: (res.data ?? null) as PersonaRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createPersona(input: UpsertPersonaInput) {
  const res = await supabase
    .from('personas')
    .insert(input)
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updatePersona(personaId: string, input: UpsertPersonaInput) {
  const res = await supabase
    .from('personas')
    .update(input)
    .eq('id', personaId)

  return {
    ok: !res.error,
    error: res.error?.message ?? null,
  }
}

export async function deletePersona(personaId: string) {
  const res = await supabase.from('personas').delete().eq('id', personaId)
  return { ok: !res.error, error: res.error?.message ?? null }
}
