/**
 * PR3 — İzle-ve-devam-et operasyon döngüsü tick'i.
 *
 * Her çalışmada:
 *   1. Aktif operasyonları sıraya göre seç (step_count < max_steps filtresi YOK — kod kontrol eder).
 *   2. Optimistic claim: UPDATE last_tick_at WHERE last_tick_at = <okunan değer>.
 *      Etkilenen satır 0 ise başka tick almıştır; atla.
 *   3. OBSERVE: DB'den son run durumu, verifier_outcome, onay kuyruğu, ard arda başarısız sayısı.
 *   4. DECIDE: LLM'e gözlem ver, strict JSON parse et.
 *      Parse başarısız → escalate.
 *   5. ACT:
 *      - continue / retry → run_requests INSERT, step_count++
 *      - wait_approval    → bekleyen onay 24h'den eskiyse escalate + bildirim
 *      - done / escalate  → status güncelle + bildirim (escalate'te)
 *   6. Her faz operation_events'e loglanır.
 *
 * Çalıştırma: npx tsx portal/api/lib/operationLoopTick.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  DECIDE_SYSTEM_PROMPT,
  parseDecideResponse,
  buildDecideUserMessage,
} from './prompts/operationDecide.js'
import { notifyChannels } from './notifyChannels.js'

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
  kind: 'observe' | 'decide' | 'act' | 'escalate',
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
  id:              string
  owner_user_id:   string
  goal_text:       string
  domain_pack:     string
  persona:         string | null
  model:           string | null
  risk:            'R0' | 'R1' | 'R2' | 'R3'
  status:          string
  max_steps:       number
  step_count:      number
  cooldown_minutes: number
  last_tick_at:    string | null
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

  // Bug 1 düzeltme: verifier_outcome, runs tablosunda (0012_runs_cost_ledger.sql:14),
  // run_events'te değil. Worker runs'a external_id = CLI runId ile insert eder.
  // CLI runId → result_json.run_id'den alınır (run tamamlanmışsa).
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

  // Ard arda başarısız sayısı: son N run_requests status='failed'
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

  // Bug 3 düzeltme: CLI RiskGate, approval_queue'ya run_request_id = job.id (RUN_REQUEST_ID
  // env var'dan) yazar (RiskGate.cs düzeltmesi). Sorgu artık run_request_id ile çalışır.
  // Ek olarak: run_request_id = null AND step_name = lastRun.id fallback'i de sorgulanır;
  // bu, düzeltme öncesi yazılmış (eski) onay kayıtlarını da yakalar.
  let pendingApprovals = 0
  let oldestPendingAt: string | null = null
  if (lastRun?.id) {
    // RiskGate artık run_request_id = job.id yazıyor (PR3 Bug 3 düzeltmesi).
    // Eski step_name fallback'i kaldırıldı — ölü kod, yanlış onay eşleştirmesine yol açabilir.
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

  const lastError = lastRun?.status === 'failed'
    ? `Run ${lastRun.id} failed`
    : null

  return {
    lastRunStatus:       lastRun?.status ?? null,
    lastVerifierOutcome,
    consecutiveFails,
    pendingApprovals,
    oldestPendingAt,
    stepCount:           op.step_count,
    maxSteps:            op.max_steps,
    lastPlaybook,
    lastError,
  }
}

// ── DECIDE ─────────────────────────────────────────────────────────────────────

async function decide(
  op:  Operation,
  obs: Awaited<ReturnType<typeof observe>>,
) {
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
  })

  // Bug 2 düzeltme: endpoint api.openai.com → varsayılan gpt-4.1 (repo standardı).
  // claude-sonnet-4-6 Anthropic modeli; OpenAI endpoint'ine 404 döner.
  const model  = op.model ?? 'gpt-4.1'
  const apiKey = getOpenAIKey()

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
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

async function escalateOp(
  supabase: SupabaseClient,
  op: Operation,
  reason: string,
) {
  log('escalate', { id: op.id, reason })
  await supabase
    .from('operations')
    .update({ status: 'escalated', escalation_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', op.id)

  await notifyChannels({
    ownerId: op.owner_user_id,
    subject: `[AgentArmy] Operasyon eskalasyon: ${op.goal_text.slice(0, 60)}`,
    message: [
      `Operasyon eskalasyona alındı.`,
      `Hedef: ${op.goal_text}`,
      `Sebep: ${reason}`,
      `Operasyon ID: ${op.id}`,
    ].join('\n'),
  })
}

// ── single operation tick ──────────────────────────────────────────────────────

async function processOperation(
  supabase: SupabaseClient,
  op:       Operation,
) {
  log('tick başlıyor', { id: op.id, step: op.step_count, max: op.max_steps })

  // ── Optimistic claim: UPDATE WHERE last_tick_at = okunan değer ──────────────
  // Supabase JS v2'de NULL ve değer için ayrı koşul gerekir.
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

  if (claimResult.error) {
    log('claim hatası', { id: op.id, error: claimResult.error.message })
    return
  }
  if ((claimResult.data ?? []).length === 0) {
    log('claim kaybedildi — başka tick aldı', { id: op.id })
    return
  }

  // ── max_steps kontrolü (SELECT filtresi DEĞİL — kod kontrol eder) ──────────
  if (op.step_count >= op.max_steps) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'max_steps_exceeded', step_count: op.step_count, max_steps: op.max_steps })
    await escalateOp(supabase, op, `max_steps aşıldı (${op.step_count}/${op.max_steps})`)
    return
  }

  // ── OBSERVE ────────────────────────────────────────────────────────────────
  const obs = await observe(supabase, op)
  await logEvent(supabase, op.id, 'observe', obs as unknown as Record<string, unknown>)

  // Ard arda 3 başarısız → DECIDE'dan önce escalate
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
    // Strict parse başarısız → güvenli eskalasyon
    await logEvent(supabase, op.id, 'escalate', { reason: 'decide_parse_failed' })
    await escalateOp(supabase, op, 'LLM karar yanıtı parse edilemedi')
    return
  }

  const { action, next_playbook, next_topic, reason } = decideResp

  // ── ACT ───────────────────────────────────────────────────────────────────
  if (action === 'continue' || action === 'retry') {
    const playbook = next_playbook ?? obs.lastPlaybook ?? op.domain_pack
    const topic    = next_topic    ?? op.goal_text

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
      },
      model:           op.model,
      risk:            op.risk,
      allow_high_risk: false,
      status:          'pending',
      operation_id:    op.id,
    })

    if (insErr) {
      log('run_request insert hatası', { id: op.id, error: insErr.message })
      return
    }

    await supabase
      .from('operations')
      .update({ step_count: op.step_count + 1, updated_at: new Date().toISOString() })
      .eq('id', op.id)

    await logEvent(supabase, op.id, 'act', { action, playbook, topic, reason })
    log('run tetiklendi', { id: op.id, action, playbook })

  } else if (action === 'wait_approval') {
    // 24 saatten eski onay kaydı varsa → escalate
    if (obs.oldestPendingAt) {
      const ageMs = Date.now() - new Date(obs.oldestPendingAt).getTime()
      const TWENTY_FOUR_H = 24 * 60 * 60 * 1000
      if (ageMs > TWENTY_FOUR_H) {
        await logEvent(supabase, op.id, 'escalate', { reason: 'wait_approval_timeout', oldest_pending_at: obs.oldestPendingAt })
        await escalateOp(supabase, op, `Onay 24 saatten uzun süredir bekliyor (${obs.oldestPendingAt})`)
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
    log('operasyon tamamlandı', { id: op.id })

  } else if (action === 'escalate') {
    await logEvent(supabase, op.id, 'escalate', { reason })
    await escalateOp(supabase, op, reason)
  }
}

// ── main tick ─────────────────────────────────────────────────────────────────

export async function tick() {
  const supabase = getSupabase()

  // Aktif operasyonları seç. step_count < max_steps filtresi YOKTUR — kod kontrol eder.
  // Sıralama: son tick en eskiden (NULLS FIRST) → cooldown uygulanan önce işlenmez.
  const { data: ops, error } = await supabase
    .from('operations')
    .select('id, owner_user_id, goal_text, domain_pack, persona, model, risk, status, max_steps, step_count, cooldown_minutes, last_tick_at')
    .eq('status', 'active')
    .order('last_tick_at', { ascending: true, nullsFirst: true })
    .limit(20)

  if (error) throw error

  log(`aktif operasyon: ${(ops ?? []).length}`)

  for (const op of (ops ?? []) as Operation[]) {
    // Cooldown: son tick'ten bu yana yeterli süre geçti mi?
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
