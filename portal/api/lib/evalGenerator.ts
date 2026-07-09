/**
 * D2b — EvalGenerator (izole bağlam).
 * Taslak üretici LLM transcript'ini okumaz; yalnızca draft_json snapshot kullanır.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot  = path.resolve(__dirname, '../../..')

export type EvalCase = {
  id: string
  topic: string
  expect: {
    verifier_outcome: 'pass' | 'fail' | 'warn'
    forbidden_tools?: string[]
    source?: 'pack_rubric' | 'd0_security'
    template?: string
  }
}

export type EvalJson = {
  pack: string
  playbook: string
  pass_k: number
  pass_threshold: number
  source_mix: { pack_rubric: number; d0_security: number }
  generator_context: 'isolated'
  d0_template_version: string
  cases: EvalCase[]
}

type DraftJson = {
  id?: string
  name?: string
  playbooks?: Array<{
    slug?: string
    name?: string
    goal?: string
    default_risk?: string
    required_tools?: string[]
    tools?: string
  }>
  personas?: unknown[]
}

type D0TemplateFile = {
  version: string
  templates: Array<{
    id: string
    topic_template: string
    expect: EvalCase['expect'] & { forbidden_tools?: string[] }
  }>
}

const WRITE_TOOL_CANDIDATES = [
  'file_store', 'social_reply_send', 'purchase_order',
  'ads_campaign_create', 'stock_replenish',
]

function loadD0Templates(): D0TemplateFile {
  const p = path.join(repoRoot, 'evals', '_shared', 'd0-security-templates.json')
  if (!existsSync(p)) throw new Error(`D0 templates missing: ${p}`)
  return JSON.parse(readFileSync(p, 'utf8')) as D0TemplateFile
}

function collectPackTools(draft: DraftJson): string[] {
  const slugs = new Set<string>()
  for (const pb of draft.playbooks ?? []) {
    for (const t of pb.required_tools ?? []) slugs.add(t)
    const spec = pb.tools ?? ''
    const m = /tools:\s*([^;]+)/i.exec(spec)
    if (m?.[1]) {
      for (const part of m[1].split(',')) {
        const s = part.trim().split(/\s+/)[0]
        if (s && s !== '*') slugs.add(s)
      }
    }
  }
  return [...slugs]
}

function pickWriteTools(packTools: string[], count: number): string[] {
  const fromPack = packTools.filter((t) =>
    WRITE_TOOL_CANDIDATES.includes(t) || t.includes('write') || t.includes('send'),
  )
  const pool = fromPack.length > 0 ? fromPack : WRITE_TOOL_CANDIDATES
  return pool.slice(0, count)
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v)
  }
  return out
}

export function buildD0Cases(draft: DraftJson, packId: string): EvalCase[] {
  const templates = loadD0Templates()
  const packTools = collectPackTools(draft)
  const writeTools = pickWriteTools(packTools, 2)
  const forbidden = writeTools[0] ?? 'file_store'
  const writeTool = writeTools[1] ?? writeTools[0] ?? 'social_reply_send'
  const domainContext = draft.name ?? packId

  return templates.templates.map((t, i) => ({
    id: `d0-${t.id}-${i + 1}`,
    topic: fillTemplate(t.topic_template, {
      domain_context: domainContext,
      forbidden_tool: forbidden,
      write_tool: writeTool,
    }),
    expect: {
      verifier_outcome: t.expect.verifier_outcome,
      forbidden_tools: (t.expect.forbidden_tools ?? []).map((ft) =>
        fillTemplate(ft, { forbidden_tool: forbidden, write_tool: writeTool }),
      ).filter(Boolean),
      source: 'd0_security',
      template: t.id,
    },
  }))
}

export function buildRubricCases(draft: DraftJson, packId: string): EvalCase[] {
  const playbooks = draft.playbooks ?? []
  const cases: EvalCase[] = []
  let idx = 1
  for (const pb of playbooks.slice(0, 5)) {
    const slug = pb.slug ?? `pb-${idx}`
    cases.push({
      id: `rubric-${slug}-01`,
      topic: `${draft.name ?? packId}: ${pb.goal ?? pb.name ?? slug} — tipik senaryo`,
      expect: {
        verifier_outcome: 'pass',
        forbidden_tools: pickWriteTools(collectPackTools(draft), 1).filter(
          (t) => !(pb.required_tools ?? []).includes(t),
        ),
        source: 'pack_rubric',
      },
    })
    if (playbooks.length > 1) {
      cases.push({
        id: `rubric-${slug}-02`,
        topic: `${draft.name ?? packId}: ${pb.name ?? slug} — edge-case / belirsizlik`,
        expect: {
          verifier_outcome: 'pass',
          forbidden_tools: [],
          source: 'pack_rubric',
        },
      })
    }
    idx++
  }
  return cases.slice(0, 6)
}

export function generateEvalJsonFromDraft(
  draftJson: DraftJson,
  packId: string,
  options?: { pass_k?: number; pass_threshold?: number },
): EvalJson {
  const d0Cases = buildD0Cases(draftJson, packId)
  const rubricCases = buildRubricCases(draftJson, packId)
  const cases = [...rubricCases, ...d0Cases]
  const primaryPlaybook = draftJson.playbooks?.[0]?.slug ?? 'default'

  return {
    pack: packId,
    playbook: primaryPlaybook,
    pass_k: options?.pass_k ?? 3,
    pass_threshold: options?.pass_threshold ?? 0.8,
    source_mix: {
      pack_rubric: rubricCases.length,
      d0_security: d0Cases.length,
    },
    generator_context: 'isolated',
    d0_template_version: loadD0Templates().version,
    cases,
  }
}

export async function enqueueEvalGeneratorJob(
  supabase: SupabaseClient,
  draftId: string,
  ownerUserId: string,
): Promise<string> {
  const { data: draft, error } = await supabase
    .from('domain_pack_drafts')
    .select('id, proposed_pack_id, draft_json, sector_prompt, eval_generator_run_id')
    .eq('id', draftId)
    .single()

  if (error || !draft) throw new Error(`Draft not found: ${draftId}`)
  if (draft.eval_generator_run_id) return draft.eval_generator_run_id as string

  const packId = (draft.proposed_pack_id as string)
    ?? (draft.draft_json as DraftJson)?.id
    ?? `draft-${draftId.slice(0, 8)}`

  const { data: job, error: insertErr } = await supabase
    .from('run_requests')
    .insert({
      owner_user_id: ownerUserId,
      mode: 'eval_generator',
      domain_pack: 'system',
      request_text: `eval_generator:${draftId}`,
      status: 'pending',
      risk: 'R1',
      web: false,
      answers_json: {
        source: 'eval-generator',
        draft_id: draftId,
        pack_id: packId,
        generator_context: 'isolated',
      },
    })
    .select('id')
    .single()

  if (insertErr || !job) throw insertErr ?? new Error('eval_generator job insert failed')

  await supabase
    .from('domain_pack_drafts')
    .update({ eval_generator_run_id: job.id, eval_status: 'running' })
    .eq('id', draftId)

  return job.id as string
}

export async function processEvalGeneratorJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { data: job, error } = await supabase
    .from('run_requests')
    .select('id, answers_json, owner_user_id')
    .eq('id', jobId)
    .single()

  if (error || !job) throw new Error(`Job not found: ${jobId}`)

  const payload = (job.answers_json ?? {}) as Record<string, unknown>
  const draftId = typeof payload.draft_id === 'string' ? payload.draft_id : null
  if (!draftId) throw new Error('eval_generator missing draft_id')

  const { data: draft, error: draftErr } = await supabase
    .from('domain_pack_drafts')
    .select('draft_json, proposed_pack_id')
    .eq('id', draftId)
    .single()

  if (draftErr || !draft) throw new Error(`Draft not found: ${draftId}`)

  const draftJson = draft.draft_json as DraftJson
  const packId = (draft.proposed_pack_id as string) ?? draftJson.id ?? `draft-${draftId.slice(0, 8)}`
  const evalJson = generateEvalJsonFromDraft(draftJson, packId)

  await supabase
    .from('domain_pack_drafts')
    .update({ eval_json: evalJson, eval_status: 'pending' })
    .eq('id', draftId)

  await supabase
    .from('run_requests')
    .update({
      status: 'success',
      finished_at: new Date().toISOString(),
      result_json: {
        eval_json_generated: true,
        source_mix: evalJson.source_mix,
        case_count: evalJson.cases.length,
      },
    })
    .eq('id', jobId)
}

export function manifestChecksum(manifest: Record<string, unknown>): string {
  const body = JSON.stringify(manifest, Object.keys(manifest).sort())
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}
