/**
 * PR3 + PR6 — İzle-ve-devam-et operasyon döngüsü tick'i.
 *
 * Her çalışmada:
 *   1. Aktif operasyonları sıraya göre seç.
 *   2. Optimistic claim: UPDATE last_tick_at WHERE last_tick_at = <okunan değer>.
 *   3. OBSERVE: son run durumu, verifier_outcome, onay kuyruğu, consecutiveFails,
 *              lastResultSummary (kargo durumu dahil), availablePlaybooks (DB'den gerçek slug).
 *   4. DECIDE: LLM'e gözlem + gerçek playbook slug listesini ver, strict JSON parse et.
 *   5. ACT: continue/retry → run_request; wait_approval; done (→ KPI özeti); escalate.
 *   6. Her faz operation_events'e loglanır.
 *
 * Çalıştırma: npx tsx portal/api/lib/operationLoopTick.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  DECIDE_SYSTEM_PROMPT,
  parseDecideResponse,
  buildDecideUserMessage,
  type IntentJson,
} from './prompts/operationDecide.js'
import { notifyChannels } from './notifyChannels.js'
import { getPolicy } from './policyReader.js'

// ── helpers ────────────────────────────────────────────────────────────────────

function log(msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  if (!meta) { console.log(`[opLoop ${ts}] ${msg}`); return }
  console.log(`[opLoop ${ts}] ${msg}`, JSON.stringify(meta))
}

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY eksik')
  return key
}

async function logEvent(
  supabase: SupabaseClient,
  operationId: string,
  kind: 'observe' | 'decide' | 'act' | 'escalate' | 'kpi_summary',
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from('operation_events').insert({
    operation_id: operationId,
    kind,
    payload,
  })
  if (error) log('operation_events insert hatası', { kind, error: error.message })
}

// ── tipler ─────────────────────────────────────────────────────────────────────

type Operation = {
  id:               string
  owner_user_id:    string
  goal_text:        string
  domain_pack:      string
  persona:          string | null
  model:            string | null
  risk:             'R0' | 'R1' | 'R2' | 'R3'
  status:           string
  max_steps:        number
  step_count:       number
  cooldown_minutes: number
  last_tick_at:     string | null
  context_json:     Record<string, unknown> | null
  intent_json:      IntentJson | null
  created_at:       string
}

type RunRequestRow = {
  id:           string
  status:       string
  created_at:   string
  answers_json: unknown
  result_json:  unknown
}

// ── OBSERVE ────────────────────────────────────────────────────────────────────

async function observe(supabase: SupabaseClient, op: Operation) {
  // Son run_request bu operasyona bağlı
  const { data: runs } = await supabase
    .from('run_requests')
    .select('id, status, created_at, answers_json, result_json')
    .eq('operation_id', op.id)
    .order('created_at', { ascending: false })
    .limit(1)

  const lastRun = (runs ?? [])[0] as RunRequestRow | undefined

  // verifier_outcome: runs tablosundan (external_id = CLI runId)
  let lastVerifierOutcome: string | null = null
  if (lastRun) {
    const cliRunId = (lastRun.result_json as Record<string, unknown> | null)?.run_id as string | undefined
    if (cliRunId) {
      const { data: runsRow } = await supabase
        .from('runs')
        .select('verifier_outcome')
        .eq('external_id', cliRunId)
        .maybeSingle()
      lastVerifierOutcome = (runsRow as { verifier_outcome: string | null } | null)?.verifier_outcome ?? null
    }
  }

  // lastResultSummary: son run'ın result_json'undan özet (kargo "Teslim edildi" durumu dahil)
  let lastResultSummary: string | null = null
  if (lastRun?.result_json) {
    const rj = lastRun.result_json as Record<string, unknown>
    const summary = rj.summary ?? rj.work_output ?? rj.output
    if (typeof summary === 'string') {
      lastResultSummary = summary.slice(0, 400)
    } else if (summary !== null && summary !== undefined) {
      lastResultSummary = JSON.stringify(summary).slice(0, 400)
    }
  }

  // Ard arda başarısız sayısı
  const { data: recentRuns } = await supabase
    .from('run_requests')
    .select('status')
    .eq('operation_id', op.id)
    .order('created_at', { ascending: false })
    .limit(10)

  let consecutiveFails = 0
  for (const r of (recentRuns ?? []) as { status: string }[]) {
    if (r.status === 'failed') consecutiveFails++
    else break
  }

  // Onay kuyruğu
  let pendingApprovals = 0
  let oldestPendingAt: string | null = null
  if (lastRun?.id) {
    const { data: aq } = await supabase
      .from('approval_queue')
      .select('id, created_at')
      .eq('run_request_id', lastRun.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    pendingApprovals = (aq ?? []).length
    oldestPendingAt  = (aq ?? [])[0]?.created_at ?? null
  }

  const lastPlaybook = lastRun
    ? ((lastRun.answers_json as Record<string, unknown>)?.playbookId as string | undefined) ?? null
    : null

  const lastError = lastRun?.status === 'failed' ? `Run ${lastRun.id} failed` : null

  // Mevcut playbook slug'larını DB'den al — LLM'e gerçek listeyi ver, slug uydurmasın
  const { data: pbRows } = await supabase
    .from('playbooks')
    .select('slug')
    .or('owner_user_id.eq.' + op.owner_user_id + ',is_public.eq.true')
    .order('slug')
  const availablePlaybooks = ((pbRows ?? []) as { slug: string }[]).map((r) => r.slug)

  return {
    lastRunStatus:       lastRun?.status ?? null,
    lastVerifierOutcome,
    lastResultSummary,
    consecutiveFails,
    pendingApprovals,
    oldestPendingAt,
    stepCount:           op.step_count,
    maxSteps:            op.max_steps,
    lastPlaybook,
    lastError,
    availablePlaybooks,
  }
}

// ── DECIDE ─────────────────────────────────────────────────────────────────────

async function decide(op: Operation, obs: Awaited<ReturnType<typeof observe>>) {
  const userMsg = buildDecideUserMessage({
    goalText:            op.goal_text,
    lastRunStatus:       obs.lastRunStatus,
    lastVerifierOutcome: obs.lastVerifierOutcome,
    consecutiveFails:    obs.consecutiveFails,
    pendingApprovals:    obs.pendingApprovals,
    stepCount:           obs.stepCount,
    maxSteps:            obs.maxSteps,
    lastPlaybook:        obs.lastPlaybook,
    lastError:           obs.lastError,
    lastResultSummary:   obs.lastResultSummary,
    availablePlaybooks:  obs.availablePlaybooks,
    intent:              op.intent_json,
  })

  const model  = op.model ?? 'gpt-4.1'
  const apiKey = getOpenAIKey()

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DECIDE_SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      temperature: 0,
      max_tokens:  256,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`OpenAI API hatası ${resp.status}: ${body.slice(0, 200)}`)
  }

  const json = await resp.json() as { choices: { message: { content: string } }[] }
  const raw  = json.choices[0]?.message?.content ?? ''
  return parseDecideResponse(raw)
}

// ── escalate helper ────────────────────────────────────────────────────────────

async function escalateOp(supabase: SupabaseClient, op: Operation, reason: string) {
  log('escalate', { id: op.id, reason })
  await supabase
    .from('operations')
    .update({ status: 'escalated', escalation_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', op.id)

  await notifyChannels({
    ownerId: op.owner_user_id,
    subject: `[AgentArmy] Operasyon eskalasyon: ${op.goal_text.slice(0, 60)}`,
    message: [`Operasyon eskalasyona alındı.`, `Hedef: ${op.goal_text}`, `Sebep: ${reason}`, `ID: ${op.id}`].join('\n'),
  })
}

// ── KPI özeti ─────────────────────────────────────────────────────────────────

async function computeKpiSummary(supabase: SupabaseClient, op: Operation) {
  const { count: tickCount } = await supabase
    .from('operation_events')
    .select('id', { count: 'exact', head: true })
    .eq('operation_id', op.id)
    .eq('kind', 'observe')

  const { count: errorCount } = await supabase
    .from('operation_events')
    .select('id', { count: 'exact', head: true })
    .eq('operation_id', op.id)
    .eq('kind', 'escalate')

  const { data: opRunIds } = await supabase
    .from('run_requests')
    .select('id')
    .eq('operation_id', op.id)
  const runIds = ((opRunIds ?? []) as { id: string }[]).map((r) => r.id)

  let humanTouchCount = 0
  if (runIds.length > 0) {
    const { count } = await supabase
      .from('approval_queue')
      .select('id', { count: 'exact', head: true })
      .in('run_request_id', runIds)
      .in('status', ['approved', 'rejected'])
    humanTouchCount = count ?? 0
  }

  const totalDurationMin = Math.round((Date.now() - new Date(op.created_at).getTime()) / 60_000)

  const { data: actEvents } = await supabase
    .from('operation_events')
    .select('payload')
    .eq('operation_id', op.id)
    .eq('kind', 'act')
    .order('created_at')
  const playbooksRun = ((actEvents ?? []) as { payload: Record<string, unknown> }[])
    .map((e) => e.payload?.playbook as string | undefined)
    .filter(Boolean) as string[]

  return {
    total_duration_min: totalDurationMin,
    tick_count:         tickCount ?? 0,
    human_touch_count:  humanTouchCount,
    error_count:        errorCount ?? 0,
    step_count:         op.step_count,
    max_steps:          op.max_steps,
    playbooks_run:      playbooksRun,
    goal_text:          op.goal_text,
    context_json:       op.context_json,
    completed_at:       new Date().toISOString(),
  }
}

// ── single operation tick ──────────────────────────────────────────────────────

async function processOperation(supabase: SupabaseClient, op: Operation) {
  log('tick başlıyor', { id: op.id, step: op.step_count, max: op.max_steps })

  // ── Optimistic claim ────────────────────────────────────────────────────────
  let claimQuery = supabase
    .from('operations')
    .update({ last_tick_at: new Date().toISOString() })
    .eq('id', op.id)

  if (op.last_tick_at === null) {
    claimQuery = claimQuery.is('last_tick_at', null) as typeof claimQuery
  } else {
    claimQuery = claimQuery.eq('last_tick_at', op.last_tick_at) as typeof claimQuery
  }

  const claimResult = await claimQuery.select('id')
  if (claimResult.error) { log('claim hatası', { id: op.id, error: claimResult.error.message }); return }
  if ((claimResult.data ?? []).length === 0) { log('claim kaybedildi — başka tick aldı', { id: op.id }); return }

  // ── max_steps kontrolü ──────────────────────────────────────────────────────
  if (op.step_count >= op.max_steps) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'max_steps_exceeded', step_count: op.step_count, max_steps: op.max_steps })
    await escalateOp(supabase, op, `max_steps aşıldı (${op.step_count}/${op.max_steps})`)
    return
  }

  // ── OBSERVE ────────────────────────────────────────────────────────────────
  const obs = await observe(supabase, op)
  await logEvent(supabase, op.id, 'observe', obs as unknown as Record<string, unknown>)

  if (obs.consecutiveFails >= 3) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'consecutive_failures', count: obs.consecutiveFails })
    await escalateOp(supabase, op, `Ard arda ${obs.consecutiveFails} başarısız çalıştırma`)
    return
  }

  // ── DECIDE ────────────────────────────────────────────────────────────────
  const decideResp = await decide(op, obs)
  await logEvent(supabase, op.id, 'decide', {
    raw_action:    decideResp?.action ?? 'parse_failed',
    next_playbook: decideResp?.next_playbook ?? null,
    reason:        decideResp?.reason ?? 'LLM yanıtı parse edilemedi',
  })

  if (!decideResp) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'decide_parse_failed' })
    await escalateOp(supabase, op, 'LLM karar yanıtı parse edilemedi')
    return
  }

  const { action, next_playbook, next_topic, reason } = decideResp

  // ── ACT ───────────────────────────────────────────────────────────────────

  // PR9: intent expires_at kontrolü — vade dolmuş operasyon ilk tick'te kapanır
  if (op.intent_json?.expires_at) {
    const expiresAt = new Date(op.intent_json.expires_at)
    if (!isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
      await supabase
        .from('operations')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', op.id)
      await logEvent(supabase, op.id, 'act', {
        action:  'intent_expired',
        reason:  `expires_at geçti: ${op.intent_json.expires_at}`,
      })
      await notifyChannels({
        ownerId: op.owner_user_id,
        subject: `[AgentArmy] Operasyon süresi doldu: ${op.goal_text.slice(0, 60)}`,
        message: [
          `Operasyon intent vadesi geçtiği için otomatik kapatıldı.`,
          `Hedef: ${op.goal_text}`,
          `Vade: ${op.intent_json.expires_at}`,
          `ID: ${op.id}`,
        ].join('\n'),
      })
      log('operasyon intent_expired ile kapatıldı', { id: op.id, expires_at: op.intent_json.expires_at })
      return
    }
  }

  if (action === 'continue' || action === 'retry') {
    const playbook = next_playbook
      ?? obs.lastPlaybook
      ?? (op.context_json?.first_playbook as string | undefined)
      ?? op.domain_pack

    const topic = next_topic ?? op.goal_text

    // Kargo fazı için stok tetik bilgisini run'a taşı (agent stock_replenish aracını besler)
    const stockCtx = op.context_json
      ? {
          stock_trigger_product: op.context_json.stock_trigger_product,
          reorder_quantity:      op.context_json.reorder_quantity,
        }
      : {}

    // PR9 savunma derinliği: forbidden araçları run_requests.tools'tan filtrele.
    // Worker bu listeyi --tools arg olarak CLI'a iletir; CLI ToolExecutor da kontrol eder.
    let toolsField: string | undefined
    const forbidden = op.intent_json?.forbidden_tools ?? []
    if (forbidden.length > 0) {
      const { data: platformTools } = await supabase
        .from('tools')
        .select('slug')
        .is('tenant_id', null)
        .eq('enabled', true)
      const allSlugs = ((platformTools ?? []) as { slug: string }[]).map((t) => t.slug)
      const allowed  = allSlugs.filter((s) => !forbidden.includes(s))
      toolsField = allowed.length > 0
        ? `tools: ${allowed.join(', ')}; max_calls: 30`
        : 'tools: _none'
    }

    const { error: insErr } = await supabase.from('run_requests').insert({
      owner_user_id:   op.owner_user_id,
      mode:            'run',
      domain_pack:     op.domain_pack,
      request_text:    topic,
      answers_json: {
        playbookId:   playbook,
        persona:      op.persona,
        topic,
        operation_id: op.id,
        ...stockCtx,
      },
      model:           op.model,
      risk:            op.risk,
      allow_high_risk: false,
      status:          'pending',
      operation_id:    op.id,
      ...(toolsField !== undefined ? { tools: toolsField } : {}),
    })

    if (insErr) { log('run_request insert hatası', { id: op.id, error: insErr.message }); return }

    await supabase
      .from('operations')
      .update({ step_count: op.step_count + 1, updated_at: new Date().toISOString() })
      .eq('id', op.id)

    await logEvent(supabase, op.id, 'act', { action, playbook, topic, reason })
    log('run tetiklendi', { id: op.id, action, playbook })

  } else if (action === 'wait_approval') {
    if (obs.oldestPendingAt) {
      const ageMs = Date.now() - new Date(obs.oldestPendingAt).getTime()
      const timeoutHours = await getPolicy(supabase, op.owner_user_id ?? null, 'oploop.wait_approval_timeout_hours', 24)
      const timeoutMs    = (timeoutHours as number) * 60 * 60 * 1000
      if (ageMs > timeoutMs) {
        await logEvent(supabase, op.id, 'escalate', { reason: 'wait_approval_timeout', oldest_pending_at: obs.oldestPendingAt })
        await escalateOp(supabase, op, `Onay ${timeoutHours} saatten uzun süredir bekliyor (${obs.oldestPendingAt})`)
        return
      }
    }
    await logEvent(supabase, op.id, 'act', { action, reason, oldest_pending_at: obs.oldestPendingAt })
    log('wait_approval — bekleniyor', { id: op.id })

  } else if (action === 'done') {
    await supabase
      .from('operations')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', op.id)
    await logEvent(supabase, op.id, 'act', { action, reason })

    // KPI özeti: kpi_summary event (CHECK kısıtı migration'da genişletildi)
    try {
      const kpi = await computeKpiSummary(supabase, op)
      await logEvent(supabase, op.id, 'kpi_summary', kpi as unknown as Record<string, unknown>)
      log('KPI özeti kaydedildi', { id: op.id, total_duration_min: kpi.total_duration_min, tick_count: kpi.tick_count })
    } catch (kpiErr) {
      log('KPI hesaplama hatası', { id: op.id, error: (kpiErr as Error).message })
    }

    log('operasyon tamamlandı', { id: op.id })

  } else if (action === 'escalate') {
    await logEvent(supabase, op.id, 'escalate', { reason })
    await escalateOp(supabase, op, reason)
  }
}

// ── main tick ─────────────────────────────────────────────────────────────────

export async function tick() {
  const supabase = getSupabase()

  const { data: ops, error } = await supabase
    .from('operations')
    .select('id, owner_user_id, goal_text, domain_pack, persona, model, risk, status, max_steps, step_count, cooldown_minutes, last_tick_at, context_json, intent_json, created_at')
    .eq('status', 'active')
    .order('last_tick_at', { ascending: true, nullsFirst: true })
    .limit(20)

  if (error) throw error
  log(`aktif operasyon: ${(ops ?? []).length}`)

  for (const op of (ops ?? []) as Operation[]) {
    if (op.last_tick_at) {
      const elapsedMin = (Date.now() - new Date(op.last_tick_at).getTime()) / 60_000
      if (elapsedMin < op.cooldown_minutes) {
        log('cooldown — atlanıyor', { id: op.id, remainingMin: Math.ceil(op.cooldown_minutes - elapsedMin) })
        continue
      }
    }
    try {
      await processOperation(supabase, op)
    } catch (e) {
      log('processOperation hatası', { id: op.id, error: (e as Error).message })
    }
  }
}

// ── isMain guard ──────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url'

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  tick()
    .then(() => { log('tick tamamlandı'); process.exit(0) })
    .catch((e) => { console.error('[opLoop] HATA:', e); process.exit(1) })
}
