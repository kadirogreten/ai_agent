import { supabase } from '@/lib/supabaseClient'

// ── Tipler ───────────────────────────────────────────────────

export type PackStatus = 'active' | 'archived' | 'draft'
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'merged'

export type DomainPackRow = {
  id: string
  name: string
  description: string | null
  tenant_id: string | null
  status: PackStatus
  version: number
  allowed_domains: string[]
  glossary_md: string | null
  regulatory_notes_md: string | null
  verifier_rubric_md: string | null
  meta: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PlaybookRow = {
  id: string
  slug: string
  pack_id: string
  name: string
  description: string | null
  goal: string | null
  steps: unknown[]
  default_risk: string
  required_tools: string[]
  tags: string[]
  version: number
  created_at: string
  updated_at: string
}

export type PackDraftRow = {
  id: string
  tenant_id: string
  run_request_id: string | null
  sector_prompt: string
  proposed_pack_id: string | null
  proposed_name: string | null
  status: DraftStatus
  draft_json: Record<string, unknown>
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  merged_pack_id: string | null
  eval_json: Record<string, unknown> | null
  eval_status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  eval_generator_run_id: string | null
  created_at: string
  updated_at: string
}

// ── Domain Packs ─────────────────────────────────────────────

export async function listDomainPacks(): Promise<DomainPackRow[]> {
  const { data, error } = await supabase
    .from('domain_packs')
    .select('*')
    .eq('status', 'active')
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function getDomainPack(id: string): Promise<DomainPackRow | null> {
  const { data, error } = await supabase
    .from('domain_packs')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export async function listPlaybooksForPack(packId: string): Promise<PlaybookRow[]> {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*')
    .eq('pack_id', packId)
    .order('name')
  if (error) throw error
  return data ?? []
}

// ── Drafts ────────────────────────────────────────────────────

export async function listDrafts(statusFilter?: DraftStatus): Promise<PackDraftRow[]> {
  let q = supabase
    .from('domain_pack_drafts')
    .select('*')
    .order('created_at', { ascending: false })

  if (statusFilter) {
    q = q.eq('status', statusFilter)
  }

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getDraft(id: string): Promise<PackDraftRow | null> {
  const { data, error } = await supabase
    .from('domain_pack_drafts')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export async function mergeDraft(draftId: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('merge_domain_pack_draft', { p_draft_id: draftId })
  if (error) throw error
  return data as string
}

export async function rejectDraft(draftId: string, notes?: string): Promise<void> {
  const { error } = await supabase
    .rpc('reject_domain_pack_draft', {
      p_draft_id: draftId,
      p_notes: notes ?? null,
    })
  if (error) throw error
}

// ── Sector Dialog (D2a) ───────────────────────────────────────

export type SectorDialogPhase = 'prompt' | 'questions' | 'review' | 'operation' | 'done'

/** CEO planner ile senkron soru üretimi — sector_factory'den önce. */
export async function triggerSectorDialog(
  sectorPrompt: string,
  ownerId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('run_requests')
    .insert({
      owner_user_id: ownerId,
      mode: 'ceo',
      domain_pack: 'system',
      request_text: sectorPrompt,
      status: 'pending',
      risk: 'R2',
      web: false,
      answers_json: {
        source: 'sector-builder',
        phase: 'questions',
        sector_prompt: sectorPrompt,
      },
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function getRunRequest(id: string) {
  const { data, error } = await supabase
    .from('run_requests')
    .select('id, status, mode, request_text, answers_json, result_json, error_message')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function startSectorFactoryOperation(
  jobId: string,
  accessToken: string,
): Promise<string> {
  const res = await fetch(`/api/sector/jobs/${jobId}/execute`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  const json = await res.json() as { success?: boolean; operationId?: string; error?: string }
  if (!res.ok || !json.operationId) {
    throw new Error(json.error ?? 'Operasyon başlatılamadı')
  }
  return json.operationId
}

export async function getOperation(id: string) {
  const { data, error } = await supabase
    .from('operations')
    .select('id, status, goal_text, step_count, max_steps, context_json, escalation_reason, updated_at')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// ── Sector Discovery run tetikleme (legacy tek atım) ─────────────────────────

export async function triggerSectorDiscovery(
  sectorPrompt: string,
  ownerId: string
): Promise<string> {
  // run_requests tablosuna yeni bir istek yaz
  // Playbook: sector-discovery-and-scaffold (pack: system)
  const { data, error } = await supabase
    .from('run_requests')
    .insert({
      owner_user_id: ownerId,
      mode: 'run',
      domain_pack: 'system',
      request_text: sectorPrompt,
      status: 'pending',
      risk: 'R2',
      web: true,
      answers_json: {
        source: 'sector-builder-ui',
        playbookId: 'sector-discovery-and-scaffold',
        sector_prompt: sectorPrompt,
      },
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}
