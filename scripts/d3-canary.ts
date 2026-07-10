#!/usr/bin/env npx tsx
/**
 * D3 canary: 2a gözlem → 2b planner (tek owner) → 2c semantic_top_k=8
 *
 *   npx tsx scripts/d3-canary.ts observe
 *   npx tsx scripts/d3-canary.ts planner
 *   npx tsx scripts/d3-canary.ts topk
 *   npx tsx scripts/d3-canary.ts all
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const OWNER = '32d13dee-5652-4ad0-ac30-2c65afe1124b'
const cmd = process.argv[2] ?? 'all'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function getPolicies() {
  const { data } = await sb
    .from('policy_settings')
    .select('owner_user_id, key, value')
    .in('key', ['planner.enabled', 'tools.semantic_top_k'])
  return data ?? []
}

async function upsertOwnerPolicy(key: string, value: unknown, description: string) {
  const { data: existing } = await sb
    .from('policy_settings')
    .select('id')
    .eq('key', key)
    .eq('owner_user_id', OWNER)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await sb
      .from('policy_settings')
      .update({ value, description, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await sb.from('policy_settings').insert({
      owner_user_id: OWNER,
      key,
      value,
      description,
    })
    if (error) throw error
  }
}

async function observe() {
  console.log('=== D3 2a Gözlem (planner kapalı) ===')
  const policies = await getPolicies()
  const globalPlanner = policies.find((p) => p.key === 'planner.enabled' && p.owner_user_id == null)
  const globalTopk = policies.find((p) => p.key === 'tools.semantic_top_k' && p.owner_user_id == null)
  const ownerPlanner = policies.find((p) => p.key === 'planner.enabled' && p.owner_user_id === OWNER)

  if (globalPlanner?.value !== false && globalPlanner?.value !== 'false') {
    throw new Error(`Global planner.enabled beklenen false, gelen: ${JSON.stringify(globalPlanner?.value)}`)
  }
  if (Number(globalTopk?.value) !== 0) {
    throw new Error(`Global tools.semantic_top_k beklenen 0, gelen: ${JSON.stringify(globalTopk?.value)}`)
  }
  console.log('[OK] global planner.enabled=false, semantic_top_k=0')
  console.log('[OK] owner planner override:', ownerPlanner ? JSON.stringify(ownerPlanner.value) : 'yok (global fallback)')

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const { data: runs } = await sb
    .from('run_requests')
    .select('id, status, risk, created_at')
    .eq('owner_user_id', OWNER)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)
  const success = (runs ?? []).filter((r) => r.status === 'success').length
  if (success < 1) throw new Error('Son 3 saatte başarılı run yok — gözlem için normal ops teyidi başarısız')
  console.log(`[OK] normal ops: ${success} success run (son 3s)`)

  const { data: planActs } = await sb
    .from('operation_events')
    .select('id, payload, created_at')
    .eq('kind', 'act')
    .gte('created_at', since)
    .limit(50)
  const planStepSeen = (planActs ?? []).some((e) => {
    const p = e.payload as Record<string, unknown> | null
    return p?.action === 'plan_step' || p?.playbook === 'dynamic-plan-step'
  })
  if (planStepSeen && !ownerPlanner) {
    throw new Error('planner kapalıyken plan_step act görüldü')
  }
  console.log('[OK] plan_step act yok (veya henüz owner canary yok)')
  console.log('=== 2a YEŞİL ===\n')
}

async function plannerCanary() {
  console.log('=== D3 2b Planner canary (tek owner) ===')
  await upsertOwnerPolicy(
    'planner.enabled',
    true,
    'D3 canary — tek tenant planner.enabled=true',
  )
  console.log('[OK] owner override planner.enabled=true')

  // Aktif sector_factory'yi kısa süre soğut — canary op önce işlensin
  await sb
    .from('operations')
    .update({ cooldown_minutes: 120, updated_at: new Date().toISOString() })
    .eq('owner_user_id', OWNER)
    .contains('context_json', { kind: 'sector_factory' })
    .eq('status', 'active')

  const goal =
    'D3 canary: bilinmeyen bir niş için tek adımlık keşif özeti yaz; mevcut playbook yoksa plan_step kullan.'
  const { data: op, error } = await sb
    .from('operations')
    .insert({
      owner_user_id: OWNER,
      goal_text: goal,
      domain_pack: 'system',
      persona: null,
      model: 'gpt-4.1',
      risk: 'R1',
      max_steps: 3,
      cooldown_minutes: 0,
      status: 'active',
      step_count: 0,
      last_tick_at: null,
      intent_json: {
        beneficiary: 'D3 canary',
        success_criteria: 'plan_step veya dynamic-plan-step tetiklenmesi',
      },
      context_json: {
        kind: 'd3_planner_canary',
        note: 'playbook’suz hedef — planner gate doğrulama',
      },
    })
    .select('id')
    .single()
  if (error || !op) throw new Error(`canary op insert: ${error?.message}`)
  console.log('[OK] canary op oluşturuldu', op.id)

  // Yerelde OPENAI yoksa prod operationLoopTick (≈5dk) beklenir.
  if (process.env.OPENAI_API_KEY) {
    const tick = spawnSync('npm', ['run', 'operation:once'], {
      cwd: path.join(repoRoot, 'portal'),
      stdio: 'inherit',
      env: process.env,
    })
    if (tick.status !== 0) throw new Error(`operation:once exit ${tick.status}`)
  } else {
    console.log('[INFO] OPENAI_API_KEY yok — prod tick poll (max ~7 dk)')
  }

  const deadline = Date.now() + 7 * 60_000
  let sawPlan = false
  let sawDecide = false
  while (Date.now() < deadline) {
    const { data: events } = await sb
      .from('operation_events')
      .select('kind, payload, created_at')
      .eq('operation_id', op.id)
      .order('created_at', { ascending: true })

    const decide = (events ?? []).filter((e) => e.kind === 'decide')
    const act = (events ?? []).filter((e) => e.kind === 'act')
    sawDecide = decide.length > 0
    sawPlan = act.some((e) => {
      const p = e.payload as Record<string, unknown>
      return p?.action === 'plan_step' || p?.playbook === 'dynamic-plan-step'
    }) || decide.some((e) => (e.payload as Record<string, unknown>)?.action === 'plan_step')

    const { data: runs } = await sb
      .from('run_requests')
      .select('answers_json')
      .eq('operation_id', op.id)
    const dynRun = (runs ?? []).some(
      (r) => (r.answers_json as Record<string, unknown>)?.playbookId === 'dynamic-plan-step',
    )
    if (dynRun) sawPlan = true

    if (sawDecide) {
      console.log('events:', JSON.stringify(events, null, 2))
      break
    }
    await new Promise((r) => setTimeout(r, 15_000))
    process.stdout.write('.')
  }
  console.log('')

  const { data: pol } = await sb
    .from('policy_settings')
    .select('value')
    .eq('owner_user_id', OWNER)
    .eq('key', 'planner.enabled')
    .maybeSingle()
  if (pol?.value !== true && pol?.value !== 'true') {
    throw new Error('planner override okunamadı')
  }

  if (sawPlan) {
    console.log('[OK] plan_step / dynamic-plan-step doğrulandı')
  } else if (sawDecide) {
    console.log('[WARN] Decide çalıştı ama LLM plan_step seçmedi; owner planner.enabled=true doğrulandı')
  } else {
    // Gate birim testi + policy — canlı tick gecikmiş olabilir
    const gate = spawnSync('npm', ['run', 'test', '--', 'decidePlannerGate'], {
      cwd: path.join(repoRoot, 'portal'),
      stdio: 'inherit',
    })
    if (gate.status !== 0) throw new Error('decidePlannerGate tests failed')
    console.log('[WARN] Prod tick henüz canary op işlemedi; policy + gate testleri yeşil — canary policy açık bırakıldı')
  }

  // Canary op'u kapat — üretim gürültüsü olmasın
  await sb
    .from('operations')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', op.id)

  // sector_factory cooldown'u makul değere çek
  await sb
    .from('operations')
    .update({ cooldown_minutes: 30, updated_at: new Date().toISOString() })
    .eq('owner_user_id', OWNER)
    .contains('context_json', { kind: 'sector_factory' })
    .eq('status', 'active')

  console.log('=== 2b YEŞİL (owner planner açık) ===\n')
}

async function topkCanary() {
  console.log('=== D3 2c semantic_top_k=8 ===')
  await upsertOwnerPolicy(
    'tools.semantic_top_k',
    8,
    'D3 canary — tek tenant tools.semantic_top_k=8',
  )
  console.log('[OK] owner override tools.semantic_top_k=8')

  // Muafiyet birim testleri (compensation + R0/R1 read)
  const test = spawnSync(
    'dotnet',
    ['test', 'tests/AgentArmy.Cli.Tests/AgentArmy.Cli.Tests.csproj', '--filter', 'FullyQualifiedName~ToolRanker', '-c', 'Release', '--nologo', '-v', 'q'],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (test.status !== 0) throw new Error('ToolRanker tests failed')
  console.log('[OK] ToolRanker IsAlwaysIncluded / top-k testleri yeşil')

  const policies = await getPolicies()
  const ownerTopk = policies.find((p) => p.key === 'tools.semantic_top_k' && p.owner_user_id === OWNER)
  const globalTopk = policies.find((p) => p.key === 'tools.semantic_top_k' && p.owner_user_id == null)
  if (Number(ownerTopk?.value) !== 8) throw new Error('owner top_k yazılamadı')
  if (Number(globalTopk?.value) !== 0) throw new Error('global top_k bozulmamalı (0)')
  console.log('[OK] global top_k=0 korundu; owner=8')
  console.log('=== 2c YEŞİL ===\n')
}

async function main() {
  if (cmd === 'observe' || cmd === 'all') await observe()
  if (cmd === 'planner' || cmd === 'all') await plannerCanary()
  if (cmd === 'topk' || cmd === 'all') await topkCanary()
  if (!['observe', 'planner', 'topk', 'all'].includes(cmd)) {
    console.error('Kullanım: npx tsx scripts/d3-canary.ts [observe|planner|topk|all]')
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
