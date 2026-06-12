import { supabase } from '@/lib/supabaseClient'

export type AgentRole =
  | 'research'
  | 'analysis'
  | 'writing'
  | 'editing'
  | 'verification'
  | 'operation'
  | 'contrarian'
  | 'design'
  | 'code'
  | 'architecture'
  | 'ceo'

export type RiskCeiling = 'R0' | 'R1' | 'R2' | 'R3'
export type CostClass = 'low' | 'medium' | 'high'

export type AgentBehaviors = {
  requires_web_search?: boolean
  requires_full_context?: boolean
  writes_to_facts?: boolean
  writes_to_decisions?: boolean
  captures_verifier_report?: boolean
  triggers_contrarian?: boolean
  accepts_rubric?: boolean
  prefers_domain_allowlist?: boolean
}

export type AgentRow = {
  id: string
  name: string
  code: string
  description: string | null
  capabilities: string[]
  role: AgentRole | null
  risk_ceiling: RiskCeiling
  cost_class: CostClass
  behaviors: AgentBehaviors
  system_prompt: string | null
  tenant_overridable: boolean
  tenant_id: string | null  // NULL = sistem ajanı (herkese görünür)
  created_at: string
  updated_at: string
}

export type UpsertAgentInput = {
  name: string
  code: string
  description: string | null
  capabilities: string[]
  role: AgentRole | null
  risk_ceiling: RiskCeiling
  cost_class: CostClass
  behaviors: AgentBehaviors
  system_prompt: string | null
  tenant_overridable: boolean
}

const MANIFEST_SELECT =
  'id,name,code,description,capabilities,role,risk_ceiling,cost_class,behaviors,system_prompt,tenant_overridable,tenant_id,created_at,updated_at'

export function normalizeAgentCode(input: string) {
  return input.trim().toUpperCase()
}

export async function listAgents(params: { q: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('agents')
    .select(MANIFEST_SELECT)
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
    .select(MANIFEST_SELECT)
    .eq('id', agentId)
    .maybeSingle()

  return {
    data: (res.data ?? null) as AgentRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createAgent(input: UpsertAgentInput) {
  // tenant_id = auth.uid() → bu ajan bu kullanıcıya aittir ve ileride güncellenebilir
  const { data: { user } } = await supabase.auth.getUser()
  const res = await supabase
    .from('agents')
    .insert({
      name: input.name,
      code: input.code,
      description: input.description,
      capabilities: input.capabilities,
      role: input.role,
      risk_ceiling: input.risk_ceiling,
      cost_class: input.cost_class,
      behaviors: input.behaviors,
      system_prompt: input.system_prompt,
      tenant_overridable: input.tenant_overridable,
      tenant_id: user?.id ?? null,
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
      role: input.role,
      risk_ceiling: input.risk_ceiling,
      cost_class: input.cost_class,
      behaviors: input.behaviors,
      system_prompt: input.system_prompt,
      tenant_overridable: input.tenant_overridable,
    })
    .eq('id', agentId)
    .select('id')  // RLS bloğunu tespit etmek için — 0 satır dönerse güncelleme başarısız demektir

  const updated = (res.data ?? []) as { id: string }[]
  const blockedByRls = !res.error && updated.length === 0

  return {
    ok: !res.error && !blockedByRls,
    error: res.error?.message
      ?? (blockedByRls ? 'Güncelleme başarısız: bu ajanı düzenleme yetkiniz yok veya ajan bulunamadı.' : null),
  }
}
