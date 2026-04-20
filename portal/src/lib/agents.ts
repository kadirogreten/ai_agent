import { supabase } from '@/lib/supabaseClient'

export type AgentRow = {
  id: string
  name: string
  code: string
  description: string | null
  capabilities: string[]
  created_at: string
  updated_at: string
}

export type UpsertAgentInput = {
  name: string
  code: string
  description: string | null
  capabilities: string[]
}

export function normalizeAgentCode(input: string) {
  return input.trim().toUpperCase()
}

export async function listAgents(params: { q: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('agents')
    .select('id,name,code,description,capabilities,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`
    query = query.or(`name.ilike.${term},code.ilike.${term}`)
  }

  const res = await query
  return {
    data: (res.data ?? []) as AgentRow[],
    error: res.error?.message ?? null,
  }
}

export async function getAgent(agentId: string) {
  const res = await supabase
    .from('agents')
    .select('id,name,code,description,capabilities,created_at,updated_at')
    .eq('id', agentId)
    .maybeSingle()

  return {
    data: (res.data ?? null) as AgentRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createAgent(input: UpsertAgentInput) {
  const res = await supabase
    .from('agents')
    .insert({
      name: input.name,
      code: input.code,
      description: input.description,
      capabilities: input.capabilities,
    })
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updateAgent(agentId: string, input: UpsertAgentInput) {
  const res = await supabase
    .from('agents')
    .update({
      name: input.name,
      code: input.code,
      description: input.description,
      capabilities: input.capabilities,
    })
    .eq('id', agentId)

  return {
    ok: !res.error,
    error: res.error?.message ?? null,
  }
}
