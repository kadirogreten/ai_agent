#!/usr/bin/env npx tsx
/**
 * Taslak için eval_json üretir (eval_generator) ve fake harness çalıştırır.
 *
 *   npx tsx scripts/eval-draft-bootstrap.ts <draft-id>
 *   npx tsx scripts/eval-draft-bootstrap.ts d8db85ac-6248-4d6f-ae34-2f4c370c3712
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPortalEnv } from './loadPortalEnv.js'
import { createClient } from '@supabase/supabase-js'
import { generateEvalJsonFromDraft } from '../portal/api/lib/evalGenerator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const draftId = process.argv[2]
if (!draftId) {
  console.error('Kullanım: npx tsx scripts/eval-draft-bootstrap.ts <draft-id>')
  process.exit(2)
}

loadPortalEnv()
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (portal/.env.local)')
  process.exit(2)
}

const supabase = createClient(url, key)

const { data: draft, error } = await supabase
  .from('domain_pack_drafts')
  .select('id, proposed_pack_id, draft_json, eval_status, eval_json')
  .eq('id', draftId)
  .single()

if (error || !draft) {
  console.error('Taslak bulunamadı:', error?.message ?? draftId)
  process.exit(1)
}

const draftJson = draft.draft_json as Record<string, unknown>
const packId = (draft.proposed_pack_id as string)
  ?? (typeof draftJson?.id === 'string' ? draftJson.id : `draft-${draftId.slice(0, 8)}`)

if (!draft.eval_json) {
  const evalJson = generateEvalJsonFromDraft(draftJson as Parameters<typeof generateEvalJsonFromDraft>[0], packId)
  const { error: upErr } = await supabase
    .from('domain_pack_drafts')
    .update({ eval_json: evalJson, eval_status: 'pending' })
    .eq('id', draftId)
  if (upErr) {
    console.error('eval_json yazılamadı:', upErr.message)
    process.exit(1)
  }
  console.log(`[bootstrap] eval_json üretildi — ${evalJson.cases.length} case`)
} else {
  console.log('[bootstrap] eval_json zaten var, harness çalıştırılıyor')
}

const proc = spawnSync(
  'npx',
  ['tsx', 'scripts/run-evals.ts', '--mode=fake', '--from-db', `--draft-id=${draftId}`],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
)

process.exit(proc.status ?? 1)
