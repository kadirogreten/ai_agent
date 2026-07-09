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
import './loadEnv.js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  DECIDE_SYSTEM_PROMPT,
  buildDecideSystemPrompt,
  parseDecideResponse,
  buildDecideUserMessage,
  type IntentJson,
} from './prompts/operationDecide.js'
import { notifyChannels } from './notifyChannels.js'
import { getPolicy } from './policyReader.js'
import {
  sanitizePlanStepSpec,
  type PlanStepSpec,
  type ToolMeta,
} from './planStepSanitizer.js'

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

  // Mevcut playbook slug'larını DB'den al — LLM'e gerçek listeyi ver, slug uydurmasın.
  // Şema gerçeği (0019): playbooks kolonları pack_id + tenant_id'dir;
  // owner_user_id / is_public KOLONLARI YOK (canlı testte boş liste → yanlış eskalasyon bulundu).
  // Kapsam: operasyonun paketi + system paketi; platform (tenant NULL) + kullanıcının tenant satırları.
  const { data: pbRows, error: pbErr } = await supabase
    .from('playbooks')
    .select('slug')
    .in('pack_id', [op.domain_pack, 'system'])
    .or(`tenant_id.is.null,tenant_id.eq.${op.owner_user_id}`)
    .order('slug')
  if (pbErr) log('playbooks sorgu hatası', { error: pbErr.message })
  const availablePlaybooks = ((pbRows ?? []) as { slug: string }[]).map((r) => r.slug)

  // Fazlar arası veri aktarımı: bu operasyona ait run_request'lerin CLI run_id'lerinden
  // en son başarılı purchase_order invocation'ının çıktısını oku.
  let purchaseOrderCtx: {
    order_id: string | null
    tracking_number: string | null
    product: string | null
    quantity: number | null
  } | null = null

  const { data: allRunReqs } = await supabase
    .from('run_requests')
    .select('result_json')
    .eq('operation_id', op.id)
    .not('result_json', 'is', null)

  const cliRunIds = ((allRunReqs ?? []) as { result_json: unknown }[])
    .map((r) => (r.result_json as Record<string, unknown> | null)?.run_id as string | undefined)
    .filter((id): id is string => !!id)

  if (cliRunIds.length > 0) {
    const { data: invRows } = await supabase
      .from('tool_invocations')
      .select('output')
      .in('run_id', cliRunIds)
      .eq('tool_slug', 'purchase_order')
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1)

    const inv = ((invRows ?? []) as { output: unknown }[])[0]
    if (inv?.output && typeof inv.output === 'object') {
      const o = inv.output as Record<string, unknown>
      if (o.order_id || o.tracking_number) {
        purchaseOrderCtx = {
          order_id:        typeof o.order_id === 'string' ? o.order_id : null,
          tracking_number: typeof o.tracking_number === 'string' ? o.tracking_number : null,
          product:         typeof o.product === 'string' ? o.product : null,
          quantity:        typeof o.quantity === 'number' ? o.quantity : null,
        }
      }
    }
  }

  // PR14: sector_factory — domain_pack_drafts'tan draft_id oku (purchase_order context deseni).
  // DomainPackDraftWriter Runner post-hook'u olarak domain_pack_drafts'a INSERT yapar;
  // tool_invocations'ta karşılığı yoktur. Kaynak: run_requests.id (operation'a bağlı en son).
  let sectorDraftId: string | null = null
  if (op.context_json?.kind === 'sector_factory' && lastRun?.id) {
    const { data: draftRows } = await supabase
      .from('domain_pack_drafts')
      .select('id')
      .eq('run_request_id', lastRun.id)
      .order('created_at', { ascending: false })
      .limit(1)
    sectorDraftId = ((draftRows ?? []) as { id: string }[])[0]?.id ?? null
  }

  // D3a: untrusted taint — son run'da untrusted_source araç çağrısı başarılı mı?
  let untrustedTaint = false
  if (lastRun) {
    const lastCliRunId = (lastRun.result_json as Record<string, unknown> | null)?.run_id as string | undefined
    if (lastCliRunId) {
      const { data: untrustedInv } = await supabase
        .from('tool_invocations')
        .select('tool_slug')
        .eq('run_id', lastCliRunId)
        .eq('status', 'succeeded')
      const slugs = ((untrustedInv ?? []) as { tool_slug: string }[]).map((r) => r.tool_slug)
      if (slugs.length > 0) {
        const { data: untrustedTools } = await supabase
          .from('tools')
          .select('slug')
          .in('slug', slugs)
          .eq('untrusted_source', true)
        untrustedTaint = ((untrustedTools ?? []) as { slug: string }[]).length > 0
      }
    }
  }

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
    purchaseOrderCtx,
    sectorDraftId,
    lastRunId:      lastRun?.id ?? null,
    currentPhase:   (op.context_json?.phase as string | undefined) ?? null,
    cargoPollCount: (op.context_json?.cargo_poll_count as number | undefined) ?? 0,
    cliRunIds,
    untrustedTaint,
  }
}

// ── DECIDE ─────────────────────────────────────────────────────────────────────

type LlmProviderRow = {
  slug:              string
  model_id:          string
  api_base:          string
  api_key_env:       string
  kind:              'openai' | 'anthropic'
  tier:              'basic' | 'standard' | 'frontier'
  max_decision_risk: string
}

const DECIDE_PROVIDER_FALLBACK: LlmProviderRow = {
  slug: 'gpt-4.1-fallback', model_id: 'gpt-4.1', api_base: 'https://api.openai.com',
  api_key_env: 'OPENAI_API_KEY', kind: 'openai', tier: 'standard', max_decision_risk: 'R2',
}

async function resolveDecideProvider(supabase: SupabaseClient): Promise<LlmProviderRow> {
  try {
    const { data } = await supabase
      .from('llm_providers')
      .select('slug,model_id,api_base,api_key_env,kind,tier,max_decision_risk')
      .eq('enabled', true)
      .contains('is_default_for', ['decide'])
      .limit(1)
    const row = (data ?? [])[0] as LlmProviderRow | undefined
    if (row) {
      log(`decide provider: ${row.slug} (${row.model_id})`)
      return row
    }
  } catch (e) {
    log('decide provider çözümleme hatası, fallback kullanılıyor', { error: (e as Error).message })
  }
  log(`decide provider: fallback (${DECIDE_PROVIDER_FALLBACK.model_id})`)
  return DECIDE_PROVIDER_FALLBACK
}

async function callDecideLlm(
  provider: LlmProviderRow,
  systemPrompt: string,
  userMsg: string,
): Promise<string> {
  const apiKey = process.env[provider.api_key_env]
  if (!apiKey) throw new Error(`[decide] env '${provider.api_key_env}' bulunamadı`)

  if (provider.kind === 'anthropic') {
    // Anthropic Messages API — max_tokens zorunlu, x-api-key header
    const resp = await fetch(`${provider.api_base.replace(/\/$/, '')}/v1/messages`, {
      method:  'POST',
      headers: {
        'x-api-key':        apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':     'application/json',
      },
      body: JSON.stringify({
        model:      provider.model_id,
        max_tokens: 256,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMsg }],
      }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Anthropic API hatası ${resp.status}: ${body.slice(0, 200)}`)
    }
    const json = await resp.json() as { content: { type: string; text: string }[] }
    return json.content.find((b) => b.type === 'text')?.text ?? ''
  }

  // OpenAI Chat Completions (varsayılan)
  const resp = await fetch(`${provider.api_base.replace(/\/$/, '')}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       provider.model_id,
      messages:    [
        { role: 'system', content: systemPrompt },
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
  return json.choices[0]?.message?.content ?? ''
}

async function decide(
  supabase: SupabaseClient,
  op: Operation,
  obs: Awaited<ReturnType<typeof observe>>,
  plannerEnabled: boolean,
): Promise<{ response: Awaited<ReturnType<typeof parseDecideResponse>>; provider: LlmProviderRow }> {
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
    currentPhase:        obs.currentPhase,
    cargoPollCount:      obs.cargoPollCount,
    untrustedTaint:      obs.untrustedTaint,
    plannerEnabled,
  })

  const provider = await resolveDecideProvider(supabase)
  const kind = (op.context_json?.kind as string | undefined) ?? 'base'
  const systemPrompt = await buildDecideSystemPrompt(supabase, kind, plannerEnabled)
  const raw = await callDecideLlm(provider, systemPrompt, userMsg)
  return { response: parseDecideResponse(raw, plannerEnabled), provider }
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

// ── Görev A: bellek terfisi ────────────────────────────────────────────────────

/**
 * Operasyon done olunca: kind='fact' aktif bellek kayıtlarından,
 * source_run_id'si verifier_outcome='pass' olan run'lara ait olanlar
 * global facts tablosuna terfi eder.
 *
 * FK-güvenli sıra (PR4 OperationMemoryStore deseni kopyalandı):
 *   1. İstemcide yeni fact id üret.
 *   2. Yeni fact INSERT (superseded_by henüz null).
 *   3. Çelişen eski fact'a PATCH: superseded_by = yeni id.
 *
 * Trigram dedup: find_similar_fact RPC eşiği policy'den okunur (memory.promote_similarity=0.6).
 */
async function promoteMemoryFacts(supabase: SupabaseClient, op: Operation): Promise<number> {
  const threshold = await getPolicy(supabase, null, 'memory.promote_similarity', 0.6) as number

  // Aktif kind='fact' bellek kayıtları
  const { data: memories } = await supabase
    .from('operation_memory')
    .select('id, content, source_run_id')
    .eq('operation_id', op.id)
    .eq('kind', 'fact')
    .is('superseded_by', null)

  if (!memories || memories.length === 0) return 0

  let promoted = 0
  for (const mem of memories as { id: string; content: string; source_run_id: string | null }[]) {
    if (!mem.source_run_id) continue

    // verifier_outcome kontrolü: runs.external_id = source_run_id (PR3 bağ deseni)
    // CHECK kısıtı küçük harf: ('pass','fail','warn')
    const { data: runsRow } = await supabase
      .from('runs')
      .select('verifier_outcome')
      .eq('external_id', mem.source_run_id)
      .maybeSingle()

    if ((runsRow as { verifier_outcome: string | null } | null)?.verifier_outcome !== 'pass') continue

    // Trigram dedup: benzer aktif fact var mı?
    const { data: similarId } = await supabase
      .rpc('find_similar_fact', {
        p_domain_pack: op.domain_pack,
        p_content:     mem.content,
        p_threshold:   threshold,
      })
    const conflictingId = similarId as string | null

    // FK-güvenli sıra: önce INSERT, sonra eski fact'a PATCH
    const newFactId = `prom-${op.id.replace(/-/g, '')}-${mem.id.replace(/-/g, '').slice(0, 8)}-${Date.now()}`
    const { error: insErr } = await supabase.from('facts').insert({
      id:                      newFactId,
      domain_pack:             op.domain_pack,
      run_id:                  mem.source_run_id,
      claim:                   mem.content,
      operation_id:            op.id,
      promoted_from_memory_id: mem.id,
      superseded_by:           null,
    })
    if (insErr) {
      log('fact terfi INSERT hatası', { mem_id: mem.id, error: insErr.message })
      continue
    }

    // Çelişen fact varsa artık superseded
    if (conflictingId) {
      await supabase
        .from('facts')
        .update({ superseded_by: newFactId })
        .eq('id', conflictingId)
    }

    promoted++
    log('fact terfi edildi', { new_id: newFactId, op_id: op.id, superseded: conflictingId ?? 'none' })
  }
  return promoted
}

// ── Görev B: drift critic ──────────────────────────────────────────────────────

const CRITIC_SYSTEM_PROMPT =
  'Sen bir hedef-uyum critic\'isin. ' +
  'Verilen hedef, niyet sözleşmesi ve karar incelendiğinde bu kararın hedefe ne kadar hizmet ettiğini değerlendir. ' +
  'ÖNEMLİ: Çok adımlı operasyonlarda hazırlık/araştırma/sipariş adımları nihai hedefe hizmet eder. ' +
  'Skoru "bu adım planın mantıklı sıradaki adımı mı?" sorusuna göre ver — "hedef şu an gerçekleşti mi?" sorusuna değil. ' +
  'YALNIZCA şu JSON formatında yanıt ver, başka hiçbir şey ekleme:\n' +
  '{"score": <0-100 tam sayı>, "reason": "<tek cümle Türkçe açıklama>"}\n' +
  '0 = tamamen hedef dışı, 100 = mükemmel hizalamalı.\n\n' +
  'Örnekler:\n' +
  'Hedef: "Stok tükenince sipariş ver ve teslimatta stoğu güncelle". Karar: tedarik-siparis playbookunu çalıştır (stok kontrolü yaptı, şimdi sipariş verme adımı). Puan: 85 — mantıklı sıradaki adım, hazırlık tamamlandı.\n' +
  'Hedef: "Stok tükenince sipariş ver ve teslimatta stoğu güncelle". Karar: market_intel raporlama playbookunu çalıştır (stok/tedarikle ilgisiz). Puan: 15 — hedef dışı adım, planın sırası değil.'

type CriticResult = { score: number; reason: string }

/**
 * Hafif critic çağrısı — is_default_for='facts' provider kullanır.
 * Hata durumunda fail-open: score=100 döner (decide zaten onaylamış;
 * critic çökmesi tüm operasyonları durdurmamalı — bkz. guvenlik-eval-raporu.md).
 */
async function callCritic(
  supabase: SupabaseClient,
  op: Operation,
  action: string,
  reason: string,
): Promise<CriticResult> {
  try {
    const provider = await resolveFactsProvider(supabase)
    const userMsg = [
      `Hedef: ${op.goal_text}`,
      op.intent_json
        ? `Niyet: faydalanan=${op.intent_json.beneficiary ?? '?'}, başarı=${op.intent_json.success_criteria ?? '?'}`
        : '',
      `Karar: ${action}`,
      `Gerekçe: ${reason}`,
    ].filter(Boolean).join('\n')

    const raw = await callDecideLlm(provider, CRITIC_SYSTEM_PROMPT, userMsg)
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    const obj = JSON.parse(cleaned) as Partial<CriticResult>
    const score = typeof obj.score === 'number' && obj.score >= 0 && obj.score <= 100
      ? Math.round(obj.score)
      : 100
    const criticReason = typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : 'parse edilemedi'
    return { score, reason: criticReason }
  } catch (e) {
    // fail-open: critic çökünce operasyonu durdurmuyoruz
    log('critic hata — fail-open score=100', { op_id: op.id, error: (e as Error).message })
    return { score: 100, reason: 'critic çağrısı başarısız (fail-open)' }
  }
}

async function resolveFactsProvider(supabase: SupabaseClient): Promise<LlmProviderRow> {
  try {
    const { data } = await supabase
      .from('llm_providers')
      .select('slug,model_id,api_base,api_key_env,kind,tier,max_decision_risk')
      .eq('enabled', true)
      .contains('is_default_for', ['facts'])
      .limit(1)
    const row = (data ?? [])[0] as LlmProviderRow | undefined
    if (row) return row
  } catch { /* fallback */ }
  return DECIDE_PROVIDER_FALLBACK
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

  const base = {
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

  // PR14: sector_factory ek KPI alanları
  if (op.context_json?.kind === 'sector_factory') {
    const draftRounds = playbooksRun.filter((p) => p === 'sector-paket-taslak').length

    // test_pass_rate: son 5 sector-paket-test act event içinde verifier_outcome='pass' oranı
    const { data: testEvents } = await supabase
      .from('operation_events')
      .select('payload')
      .eq('operation_id', op.id)
      .eq('kind', 'act')
      .order('created_at', { ascending: false })
      .limit(5)
    const testActs = ((testEvents ?? []) as { payload: Record<string, unknown> }[])
      .filter((e) => e.payload?.playbook === 'sector-paket-test')
    const testPassCount = testActs.filter(
      (e) => (e.payload?.verifier_outcome as string | undefined)?.toLowerCase() === 'pass'
    ).length
    const testPassRate = testActs.length > 0
      ? Math.round((testPassCount / testActs.length) * 100)
      : null

    // missing_tools_count: context_json.missing_tools array length (OBSERVE'da set edilirse)
    const missingTools = op.context_json?.missing_tools
    const missingToolsCount = Array.isArray(missingTools) ? missingTools.length : null

    return { ...base, draft_rounds: draftRounds, test_pass_rate: testPassRate, missing_tools_count: missingToolsCount }
  }

  return base
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

  // Fazlar arası veri aktarımı: purchase_order çıktısunu context_json.order'a kalıcı olarak yaz
  if (obs.purchaseOrderCtx && !(op.context_json?.order as Record<string, unknown> | null | undefined)?.order_id) {
    const newCtx = { ...(op.context_json ?? {}), order: obs.purchaseOrderCtx }
    const { error: ctxErr } = await supabase
      .from('operations')
      .update({ context_json: newCtx, updated_at: new Date().toISOString() })
      .eq('id', op.id)
    if (!ctxErr) {
      op.context_json = newCtx
      log('context_json.order yazıldı', { id: op.id, order_id: obs.purchaseOrderCtx.order_id })
    } else {
      log('context_json.order yazma hatası', { id: op.id, error: ctxErr.message })
    }
  }

  // PR15 T4-1: tedarik — stock_replenish tamamlandıysa phase='replenish' yaz (purchase_order deseni).
  // cliRunIds zaten observe()'da hesaplandı; burada tekrar sorgu yerine obs'tan geliyor.
  // phase='replenish' → bir sonraki tick'te DECIDE 'done' verir.
  if (
    op.context_json?.kind !== 'sector_factory' &&
    op.context_json?.phase === 'cargo' &&
    obs.cliRunIds.length > 0
  ) {
    const { data: replenishRows } = await supabase
      .from('tool_invocations')
      .select('id')
      .in('run_id', obs.cliRunIds)
      .eq('tool_slug', 'stock_replenish')
      .eq('status', 'succeeded')
      .limit(1)
    if (((replenishRows ?? []) as { id: string }[]).length > 0) {
      const replenishCtx = { ...(op.context_json ?? {}), phase: 'replenish' }
      const { error: repErr } = await supabase
        .from('operations')
        .update({ context_json: replenishCtx, updated_at: new Date().toISOString() })
        .eq('id', op.id)
      if (!repErr) {
        op.context_json = replenishCtx
        log('phase replenish yazıldı', { id: op.id })
      }
    }
  }

  // PR14: sector_factory — draft_id context_json'a kalıcı yaz (purchase_order deseni)
  if (obs.sectorDraftId && !(op.context_json?.draft_id as string | undefined)) {
    const newCtx = { ...(op.context_json ?? {}), draft_id: obs.sectorDraftId }
    const { error: draftCtxErr } = await supabase
      .from('operations')
      .update({ context_json: newCtx, updated_at: new Date().toISOString() })
      .eq('id', op.id)
    if (!draftCtxErr) {
      op.context_json = newCtx
      log('context_json.draft_id yazıldı', { id: op.id, draft_id: obs.sectorDraftId })
    } else {
      log('context_json.draft_id yazma hatası', { id: op.id, error: draftCtxErr.message })
    }
  }

  if (obs.consecutiveFails >= 3) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'consecutive_failures', count: obs.consecutiveFails })
    await escalateOp(supabase, op, `Ard arda ${obs.consecutiveFails} başarısız çalıştırma`)
    return
  }

  // ── DECIDE ────────────────────────────────────────────────────────────────
  const plannerEnabled = await getPolicy(supabase, op.owner_user_id, 'planner.enabled', false) as boolean
  const { response: decideResp, provider: decideProvider } = await decide(supabase, op, obs, plannerEnabled)
  await logEvent(supabase, op.id, 'decide', {
    raw_action:    decideResp?.action ?? 'parse_failed',
    next_playbook: decideResp?.next_playbook ?? null,
    step_spec:     decideResp?.step_spec ?? null,
    reason:        decideResp?.reason ?? 'LLM yanıtı parse edilemedi',
    provider_slug: decideProvider.slug,
    planner_enabled: plannerEnabled,
  })

  if (!decideResp) {
    await logEvent(supabase, op.id, 'escalate', { reason: 'decide_parse_failed' })
    await escalateOp(supabase, op, 'LLM karar yanıtı parse edilemedi')
    return
  }

  // PR10: Tier kapısı — basic provider otonom aksiyon (continue/retry) tetikleyemez.
  if (decideProvider.tier === 'basic' &&
      (decideResp.action === 'continue' || decideResp.action === 'retry')) {
    const reason = 'decide provider tier=basic otonom aksiyon tetikleyemez'
    await logEvent(supabase, op.id, 'escalate', { reason, provider_slug: decideProvider.slug })
    await escalateOp(supabase, op, reason)
    return
  }

  const { action, next_playbook, next_topic, reason, step_spec } = decideResp

  // ── ACT ───────────────────────────────────────────────────────────────────

  if (action === 'plan_step') {
    if (!plannerEnabled || !step_spec) {
      await logEvent(supabase, op.id, 'escalate', { reason: 'plan_step_without_planner' })
      await escalateOp(supabase, op, 'plan_step planner kapalı veya step_spec eksik')
      return
    }

    const driftThreshold = await getPolicy(supabase, null, 'oploop.drift_threshold', 40) as number
    const critic = await callCritic(supabase, op, action, reason)
    if (critic.score < driftThreshold) {
      await logEvent(supabase, op.id, 'escalate', {
        reason: 'goal_drift', score: critic.score, critic_reason: critic.reason, blocked_action: action,
      })
      await escalateOp(supabase, op, `Hedef sapması (plan_step skor ${critic.score}): ${critic.reason}`)
      return
    }

    const { data: toolRows } = await supabase
      .from('tools')
      .select('slug, side_effect, min_risk, compensation')
      .is('tenant_id', null)
    const toolMeta = new Map<string, ToolMeta>()
    for (const t of (toolRows ?? []) as ToolMeta[]) {
      toolMeta.set(t.slug, t)
    }

    let sanitized = sanitizePlanStepSpec(step_spec, obs.untrustedTaint, toolMeta, 'R1')
    if (op.risk) {
      const rank = (r: string) => ({ R0: 0, R1: 1, R2: 2, R3: 3 }[r] ?? 1)
      if (rank(sanitized.risk) < rank(op.risk)) sanitized = { ...sanitized, risk: op.risk }
    }

    const planCtx = (op.context_json?.plan as { steps?: unknown[]; current_index?: number; completed?: string[] } | undefined) ?? {}
    const planIndex = typeof planCtx.current_index === 'number' ? planCtx.current_index : op.step_count

    const { error: planInsErr } = await supabase.from('run_requests').insert({
      owner_user_id:   op.owner_user_id,
      mode:            'run',
      domain_pack:     'system',
      request_text:    sanitized.topic,
      answers_json: {
        playbookId:   'dynamic-plan-step',
        topic:        sanitized.topic,
        persona:      sanitized.agent_slug ?? op.persona,
        operation_id: op.id,
        plan_index:   planIndex,
        step_spec:    sanitized,
        planner:      true,
      },
      model:           op.model,
      risk:            sanitized.risk,
      allow_high_risk: sanitized.risk === 'R3',
      status:          'pending',
      operation_id:    op.id,
      tools:           sanitized.tools_spec,
    })

    if (planInsErr) { log('plan_step run_request insert hatası', { id: op.id, error: planInsErr.message }); return }

    const newPlanCtx = {
      ...(op.context_json ?? {}),
      planning_mode: true,
      plan: {
        steps:      planCtx.steps ?? [],
        current_index: planIndex + 1,
        completed:  [...(planCtx.completed ?? []), `plan-${planIndex}`],
      },
      untrusted_taint_at_plan: obs.untrustedTaint,
    }
    await supabase
      .from('operations')
      .update({ step_count: op.step_count + 1, context_json: newPlanCtx, updated_at: new Date().toISOString() })
      .eq('id', op.id)
    op.context_json = newPlanCtx

    await logEvent(supabase, op.id, 'act', {
      action:       'plan_step',
      playbook:     'dynamic-plan-step',
      topic:        sanitized.topic,
      reason,
      step_spec:    sanitized,
      drift_score:  critic.score,
      plan_index:   planIndex,
      planner:      true,
    })
    log('plan_step run tetiklendi', { id: op.id, risk: sanitized.risk, untrusted: obs.untrustedTaint })
    return
  }

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
    // Görev B: drift critic — karar hedefe hizmet ediyor mu?
    // Yalnızca continue/retry'da çalışır; wait/done/escalate'te maliyet yok.
    const driftThreshold = await getPolicy(supabase, null, 'oploop.drift_threshold', 40) as number
    const critic = await callCritic(supabase, op, action, reason)
    log('drift critic', { id: op.id, score: critic.score, threshold: driftThreshold })

    if (critic.score < driftThreshold) {
      // Skor eşiğin altında → karar uygulanmaz, escalate
      await logEvent(supabase, op.id, 'escalate', {
        reason:        'goal_drift',
        score:         critic.score,
        critic_reason: critic.reason,
        drift_threshold: driftThreshold,
        blocked_action: action,
      })
      await escalateOp(supabase, op, `Hedef sapması tespit edildi (skor ${critic.score} < eşik ${driftThreshold}): ${critic.reason}`)
      return
    }

    const playbook = next_playbook
      ?? obs.lastPlaybook
      ?? (op.context_json?.first_playbook as string | undefined)
      ?? op.domain_pack

    // Kargo fazı için sipariş bilgisini (order_id + tracking_number) topic'e göm
    const orderCtx = (op.context_json?.order ?? obs.purchaseOrderCtx) as {
      order_id?: string | null
      tracking_number?: string | null
      product?: string | null
      quantity?: number | null
    } | null | undefined

    const baseTopicForOrder = next_topic ?? op.goal_text
    const trackingNumber = orderCtx?.tracking_number
    const topic = trackingNumber && !baseTopicForOrder.includes(trackingNumber)
      ? `${baseTopicForOrder} (takip: ${trackingNumber})`
      : baseTopicForOrder

    // Kargo fazı için stok tetik + sipariş bilgisini run'a taşı
    const stockCtx = {
      ...(op.context_json ? {
        stock_trigger_product: op.context_json.stock_trigger_product,
        reorder_quantity:      op.context_json.reorder_quantity,
      } : {}),
      ...(orderCtx ? { order: orderCtx } : {}),
    }

    // Araç izinleri (dogfood düzeltmesi): seçilen playbook'un required_tools'u esastır.
    // ESKİ HATA: tools yalnız intent forbidden'ı varsa kuruluyordu; required_tools hiç
    // verilmiyordu → Operator adımları araç İZNİSİZ kalıp metinle "rol yapıyordu"
    // (canlı turda yakalandı: purchase_order çağrılmadan "sipariş onaya iletildi" raporu).
    let toolsField: string | undefined
    const forbidden = op.intent_json?.forbidden_tools ?? []
    const { data: pbRows2 } = await supabase
      .from('playbooks')
      .select('required_tools, tenant_id')
      .eq('slug', playbook)
      .or(`tenant_id.is.null,tenant_id.eq.${op.owner_user_id}`)
      .limit(2)
    const pbPick = ((pbRows2 ?? []) as { required_tools: string[] | null; tenant_id: string | null }[])
      .sort((a, b) => (a.tenant_id ? -1 : 0) - (b.tenant_id ? -1 : 0))[0] // tenant satırı öncelikli
    const required = (pbPick?.required_tools ?? []) as string[]
    if (required.length > 0) {
      const allowed = required.filter((s) => !forbidden.includes(s))
      toolsField = allowed.length > 0
        ? `tools: ${allowed.join(', ')}; max_calls: 30`
        : 'tools: _none'
    } else if (forbidden.length > 0) {
      // Playbook araç tanımlamıyor ama intent yasakları var → savunma derinliği (eski yol)
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

    const childRisk =
      op.context_json?.kind === 'sector_factory' ? 'R1' : op.risk

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
      risk:            childRisk,
      allow_high_risk: false,
      status:          'pending',
      operation_id:    op.id,
      ...(toolsField !== undefined ? { tools: toolsField } : {}),
    })

    if (insErr) { log('run_request insert hatası', { id: op.id, error: insErr.message }); return }

    // PR15 T4-1: Faz geri dönüş guard (kod seviyesi — prompt'a güvenmeden sert kapı).
    // phase 'cargo'/'replenish'/'done' iken tedarik-siparis önerilirse escalate.
    const currentPhaseNow = op.context_json?.phase as string | undefined
    if (
      op.context_json?.kind !== 'sector_factory' &&
      ['cargo', 'replenish', 'done'].includes(currentPhaseNow ?? '') &&
      playbook === 'tedarik-siparis'
    ) {
      await logEvent(supabase, op.id, 'escalate', {
        reason: 'forbidden_phase_rollback',
        current_phase: currentPhaseNow,
        blocked_playbook: playbook,
      })
      await escalateOp(supabase, op, `Faz geri dönüşü engellendi: ${currentPhaseNow} → tedarik-siparis`)
      return
    }

    // PR15 T4-1: Faz yazımı — playbook geçişine göre context_json.phase güncelle.
    // PR15 T4-3: Kargo bekleme döngüsü: step_count tüketmez; cargo_poll_count artar.
    const isCargoLoop =
      op.context_json?.kind !== 'sector_factory' &&
      playbook === 'tedarik-kargo' &&
      currentPhaseNow === 'cargo'

    const phaseByPlaybook: Record<string, string> = {
      'tedarik-arastirma': 'research',
      'tedarik-siparis':   'order',
      'tedarik-kargo':     'cargo',
    }
    const nextPhase = phaseByPlaybook[playbook]

    if (isCargoLoop) {
      // Kargo poll: step_count artmaz, cargo_poll_count artar
      const newPollCount = obs.cargoPollCount + 1
      const cargoMax = await getPolicy(supabase, null, 'oploop.cargo_poll_max', 30) as number
      if (newPollCount > cargoMax) {
        await logEvent(supabase, op.id, 'escalate', {
          reason: 'cargo_poll_max_exceeded',
          cargo_poll_count: newPollCount,
          cargo_poll_max: cargoMax,
        })
        await escalateOp(supabase, op, `Kargo poll tavanı aşıldı (${newPollCount}/${cargoMax})`)
        return
      }
      const pollCtx = { ...(op.context_json ?? {}), cargo_poll_count: newPollCount }
      await supabase
        .from('operations')
        .update({ context_json: pollCtx, updated_at: new Date().toISOString() })
        .eq('id', op.id)
      op.context_json = pollCtx
      log('kargo poll count artırıldı', { id: op.id, cargo_poll_count: newPollCount })
    } else {
      // Gerçek faz geçişi: step_count++ + phase güncelle
      const phaseCtx = nextPhase
        ? { ...(op.context_json ?? {}), phase: nextPhase }
        : op.context_json ?? {}
      await supabase
        .from('operations')
        .update({ step_count: op.step_count + 1, context_json: phaseCtx, updated_at: new Date().toISOString() })
        .eq('id', op.id)
      if (nextPhase) {
        op.context_json = phaseCtx
        log('faz güncellendi', { id: op.id, phase: nextPhase })
      }
    }

    // drift_score act event payload'una yazılır (decide zaten loglandı, critic sonrası buraya)
    await logEvent(supabase, op.id, 'act', {
      action,
      playbook,
      topic,
      reason,
      drift_score:     critic.score,
      drift_reason:    critic.reason,
      phase:           nextPhase ?? currentPhaseNow ?? null,
      cargo_poll_count: isCargoLoop ? obs.cargoPollCount + 1 : null,
    })
    log('run tetiklendi', { id: op.id, action, playbook, drift_score: critic.score })

  } else if (action === 'wait_approval') {
    // PR14: sector_factory — gate_run_for_approval RPC ile pack.publish onay girişi aç.
    // Direkt approval_queue INSERT değil; RPC run_request.status='waiting_approval' + bildirim zincirini de yapar.
    // Idempotency: bu run için bekleyen onay yoksa aç.
    if (op.context_json?.kind === 'sector_factory') {
      const lastRunId = obs.lastRunId
      if (lastRunId) {
        const { count: pendingCount } = await supabase
          .from('approval_queue')
          .select('id', { count: 'exact', head: true })
          .eq('run_request_id', lastRunId)
          .eq('status', 'pending')

        if ((pendingCount ?? 0) === 0) {
          const draftId  = op.context_json?.draft_id as string | undefined
          const sector   = op.context_json?.sector_name as string | undefined
          const { error: rpcErr } = await supabase.rpc('gate_run_for_approval', {
            p_run_request_id: lastRunId,
            p_owner_user_id:  op.owner_user_id,
            p_risk_level:     'R2',
            p_action_summary: `pack.publish: ${sector ?? op.goal_text.slice(0, 80)}`,
            p_step_index:     0,
            p_step_name:      'sector-paket-yayinla',
            p_agent_code:     'system',
            p_action_detail:  draftId ? { review_url: `/pack-drafts/${draftId}` } : null,
          })
          if (rpcErr) {
            log('gate_run_for_approval hatası', { id: op.id, error: rpcErr.message })
          } else {
            log('pack.publish onay kuyruğuna eklendi', { id: op.id, draft_id: draftId ?? 'bilinmiyor' })
          }
        }
      }
    }

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

    // Görev A: PASS fact'lerini global facts tablosuna terfi et
    let promotedFacts = 0
    try {
      promotedFacts = await promoteMemoryFacts(supabase, op)
      log('bellek terfisi tamamlandı', { id: op.id, promoted_facts: promotedFacts })
    } catch (promErr) {
      log('bellek terfisi hatası', { id: op.id, error: (promErr as Error).message })
    }

    // KPI özeti: kpi_summary event (CHECK kısıtı migration'da genişletildi)
    try {
      const kpi = await computeKpiSummary(supabase, op)
      await logEvent(supabase, op.id, 'kpi_summary', {
        ...(kpi as unknown as Record<string, unknown>),
        promoted_facts: promotedFacts,
      })
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
