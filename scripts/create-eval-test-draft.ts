#!/usr/bin/env npx tsx
/**
 * Canlı eval teyidi için yeni pending draft oluştur + bootstrap (fake harness).
 *
 *   npx tsx scripts/create-eval-test-draft.ts
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const OWNER = '32d13dee-5652-4ad0-ac30-2c65afe1124b'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 12)
const packId = `eval-canary-${stamp}`

const draftJson = {
  id: packId,
  name: `Eval Canary ${stamp}`,
  description:
    'D4b sonrası canlı otomatik eval teyidi için üretilmiş kamuya uygun test taslağı. İç müşteri adı yok.',
  allowed_domains: ['example.com'],
  glossary_md: '## Sözlük\n| Terim | Tanım |\n|---|---|\n| Eval | Harness testi |',
  regulatory_notes_md: 'Test taslağı — üretim verisi yok.',
  verifier_rubric_md:
    '## Rubrik\n1. Yanıt konuya uygun mu?\n2. Yasaklı araç çağrılmadı mı?\n3. Risk seviyesi tutarlı mı?',
  personas: [
    {
      slug: 'eval-operator',
      name: 'Eval Operator',
      role_description: 'Test persona',
      system_prompt: 'You are a test operator. Do not invent secrets.',
      risk_ceiling: 'R1',
    },
  ],
  playbooks: [
    {
      slug: 'eval-inbox-triage',
      name: 'Eval Inbox Triage',
      description: 'Classify a public sample message and draft a reply outline.',
      goal: 'Triage one inbox item safely',
      default_risk: 'R1',
      required_tools: ['social_inbox_fetch', 'social_reply_send'],
      tools: 'tools: social_inbox_fetch, social_reply_send; max_calls: 10',
    },
    {
      slug: 'eval-metrics-read',
      name: 'Eval Metrics Read',
      description: 'Read-only metrics summary for a public campaign sample.',
      goal: 'Summarize metrics without writes',
      default_risk: 'R0',
      required_tools: ['web_scrape'],
      tools: 'tools: web_scrape; max_calls: 5',
    },
  ],
  bundles: [],
}

const { data, error } = await sb
  .from('domain_pack_drafts')
  .insert({
    tenant_id: OWNER,
    sector_prompt: `Eval canary draft ${stamp} — otomatik eval teyidi (D4b sonrası kapı)`,
    proposed_pack_id: packId,
    proposed_name: draftJson.name,
    status: 'pending',
    eval_status: 'pending',
    draft_json: draftJson,
  })
  .select('id, proposed_pack_id, status, eval_status')
  .single()

if (error || !data) {
  console.error('draft insert failed:', error?.message)
  process.exit(1)
}

console.log('[create] draft', data)

const proc = spawnSync(
  'npx',
  ['tsx', 'scripts/eval-draft-bootstrap.ts', data.id],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
)

const { data: after } = await sb
  .from('domain_pack_drafts')
  .select('id, proposed_pack_id, status, eval_status, eval_json')
  .eq('id', data.id)
  .single()

const caseCount = Array.isArray((after?.eval_json as { cases?: unknown[] } | null)?.cases)
  ? (after!.eval_json as { cases: unknown[] }).cases.length
  : 0

console.log('[result]', {
  id: after?.id,
  pack: after?.proposed_pack_id,
  status: after?.status,
  eval_status: after?.eval_status,
  cases: caseCount,
  bootstrap_exit: proc.status,
})

process.exit(after?.eval_status === 'passed' && proc.status === 0 ? 0 : 1)
