#!/usr/bin/env npx tsx
/** A3/D3 canlı durum özeti — policy, drafts, sector_factory ops, recent worker activity. */
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const { data: policies } = await sb
    .from('policy_settings')
    .select('owner_user_id, key, value')
    .in('key', ['planner.enabled', 'tools.semantic_top_k'])
  console.log('policies:', JSON.stringify(policies, null, 2))

  const { data: drafts } = await sb
    .from('domain_pack_drafts')
    .select('id, proposed_pack_id, proposed_name, status, eval_status, created_at')
    .order('created_at', { ascending: false })
    .limit(8)
  console.log('drafts:', drafts)

  const { data: ops } = await sb
    .from('operations')
    .select('id, status, step_count, context_json, updated_at, owner_user_id, last_tick_at')
    .contains('context_json', { kind: 'sector_factory' })
    .order('updated_at', { ascending: false })
    .limit(5)
  console.log(
    'sector_factory ops:',
    ops?.map((o) => ({
      id: o.id,
      status: o.status,
      steps: o.step_count,
      owner: o.owner_user_id,
      updated: o.updated_at,
      last_tick: o.last_tick_at,
    })),
  )

  const { data: recentRuns } = await sb
    .from('run_requests')
    .select('id, status, risk, created_at, mode')
    .order('created_at', { ascending: false })
    .limit(8)
  console.log('recent runs:', recentRuns)

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: events } = await sb
    .from('operation_events')
    .select('id, operation_id, event_type, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)
  console.log('events last 2h:', events?.length ?? 0, events)

  const { data: packs, error: packErr } = await sb
    .from('domain_packs')
    .select('*')
    .ilike('id', '%sosyal-medya-reklam%')
    .limit(5)
  console.log('sosyal-medya-reklam packs:', packErr?.message ?? packs)

  const { data: anyPacks, error: anyErr } = await sb
    .from('domain_packs')
    .select('id, name, meta, status, created_at')
    .order('created_at', { ascending: false })
    .limit(8)
  console.log('latest packs:', anyErr?.message ?? anyPacks)

  // A3 9/9 evidence against known good draft
  const goodId = 'ae947160-50cb-4921-b91a-800aeec6e235'
  const { data: good } = await sb
    .from('domain_pack_drafts')
    .select('id, status, eval_status, proposed_pack_id, eval_json')
    .eq('id', goodId)
    .maybeSingle()
  const hasEvalCases = Array.isArray((good?.eval_json as { cases?: unknown[] } | null)?.cases)
  console.log('A3 evidence draft:', {
    id: good?.id,
    status: good?.status,
    eval_status: good?.eval_status,
    pack: good?.proposed_pack_id,
    has_eval_json: hasEvalCases,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
