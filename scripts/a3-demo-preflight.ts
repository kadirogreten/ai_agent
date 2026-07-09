#!/usr/bin/env npx tsx
/**
 * A3 demo ön koşul doğrulama — DB şema ve seed'ler hazır mı?
 * Tam 9 adımlı UI akışı canlı ortamda manuel koşulur.
 */
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'

const envPath = loadPortalEnv()
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(`SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY gerekli (${envPath})`)
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

type Check = { step: string; ok: boolean; detail?: string }

async function main() {
  const checks: Check[] = []

  const { error: draftErr } = await supabase.from('domain_pack_drafts').select('eval_json, eval_status').limit(1)
  checks.push({ step: '4/7 domain_pack_drafts.eval_json', ok: !draftErr, detail: draftErr?.message })

  const { data: pb } = await supabase.from('playbooks').select('slug').eq('slug', 'sector-arastirma').limit(1)
  checks.push({ step: '3 sector_factory playbooks', ok: (pb ?? []).length > 0 })

  const { data: dynPb } = await supabase.from('playbooks').select('slug').eq('slug', 'dynamic-plan-step').limit(1)
  checks.push({ step: 'D3a dynamic-plan-step playbook', ok: (dynPb ?? []).length > 0 })

  const { data: plannerPrompt } = await supabase.from('decide_prompts').select('scope').eq('scope', 'planner').limit(1)
  checks.push({ step: 'D3a planner decide prompt', ok: (plannerPrompt ?? []).length > 0 })

  const { data: policies } = await supabase.from('policy_settings').select('key').in('key', ['planner.enabled', 'tools.semantic_top_k'])
  checks.push({ step: 'D3 policy seeds', ok: (policies ?? []).length >= 2 })

  const { error: rpcErr } = await supabase.rpc('decrement_pack_canary', {
    p_pack_id: '__preflight_nonexistent__',
    p_is_eval: true,
  })
  checks.push({
    step: '8 decrement_pack_canary RPC',
    ok: !rpcErr,
    detail: rpcErr?.message,
  })

  const { error: matchErr } = await supabase.rpc('match_tools_by_embedding', {
    p_embedding: '[' + Array(1536).fill(0).join(',') + ']',
    p_limit: 1,
    p_threshold: 0.99,
  })
  checks.push({ step: 'D3b match_tools_by_embedding RPC', ok: !matchErr, detail: matchErr?.message })

  let failed = 0
  for (const c of checks) {
    const mark = c.ok ? 'OK' : 'FAIL'
    if (!c.ok) failed++
    console.log(`[${mark}] ${c.step}${c.detail ? ` — ${c.detail}` : ''}`)
  }

  if (failed > 0) {
    console.error(`\n${failed} ön koşul başarısız. A3 demo için önce migration push + env tamamlayın.`)
    process.exit(1)
  }
  console.log('\nA3 DB ön koşulları hazır. UI checklist (diyalog→eval→merge→canary→manifest) manuel koşulabilir.')
}

main().catch((e) => { console.error(e); process.exit(1) })
