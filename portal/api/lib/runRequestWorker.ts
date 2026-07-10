import './loadEnv.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { assertBundleExists } from './builtinBundles.js'
import { notifyChannels } from './notifyChannels.js'
import { getPolicy } from './policyReader.js'
import { enqueueEvalGeneratorJob, processEvalGeneratorJob } from './evalGenerator.js'
import { runCanaryD0SmokeAndVerify } from './canaryD0Smoke.js'
import {
  collectMissingToolSlugs,
  suggestMcpForMissingTools,
} from './mcpRegistry.js'

type RunRequest = {
  id: string
  owner_user_id: string
  mode: 'run' | 'bundle' | 'ceo' | 'ceo-iterate' | 'eval_generator'
  domain_pack: string | null
  request_text: string | null
  answers_json: unknown | null
  selected_agents: string[] | null
  model: string | null
  web: boolean
  contrarian: boolean
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
  tools: string | null
  created_at: string
  attempt_count: number
  operation_id: string | null
}


// IP1.7: model adına göre yaklaşık maliyet tahmini (USD)
function estimateCostUsd(
  model: string | null,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (!model || (!tokensIn && !tokensOut)) return null

  const m = model.toLowerCase()
  const pricing: Record<string, [number, number]> = {
    'gpt-4.1':      [2.0,  8.0],
    'gpt-4.1-mini': [0.4,  1.6],
    'gpt-4o':       [2.5, 10.0],
    'gpt-4o-mini':  [0.15, 0.6],
    'o4-mini':      [1.1,  4.4],
  }

  const entry = Object.entries(pricing).find(([k]) => m.startsWith(k))
  if (!entry) return null

  const [inRate, outRate] = entry[1]
  return (tokensIn * inRate + tokensOut * outRate) / 1_000_000
}

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────

function extractJsonFromText(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (fenced) { try { return JSON.parse(fenced[1]) } catch { /* devam */ } }
  const anyFenced = text.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFenced) { try { return JSON.parse(anyFenced[1]) } catch { /* devam */ } }
  const first = text.indexOf('{')
  const last  = text.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)) } catch { /* devam */ }
  }
  return null
}

async function assertBundleExistsDbFirst(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  packId: string,
  bundleId: string,
): Promise<void> {
  const found = await supabase
    .from('playbook_bundles')
    .select('id')
    .eq('pack_id', packId)
    .eq('slug', bundleId)
    .maybeSingle()

  if (found.data?.id) return

  try {
    assertBundleExists(packId, bundleId)
    return
  } catch {
    /* continue */
  }

  const list = await supabase
    .from('playbook_bundles')
    .select('slug')
    .eq('pack_id', packId)
    .order('slug', { ascending: true })
    .limit(50)

  const slugs = (list.data ?? [])
    .map((r) => (r as { slug?: unknown }).slug)
    .filter((s): s is string => typeof s === 'string' && !!s.trim())
    .map((s) => s.trim())

  if (slugs.length === 0) {
    throw new Error(`Domain pack "${packId}" için bundle tanımı bulunamadı.`)
  }

  throw new Error(
    `Bundle "${bundleId}" paket "${packId}" içinde yok. Geçerli bundle'lar: ${slugs.join(', ')}`,
  )
}

// run_events tablosundan run_metrics event'ini oku (metrics.json yerine)
async function readMetricsFromDb(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
): Promise<{
  model: string | null
  tokens_in: number
  tokens_out: number
  latency_ms: number
  verifier_outcome: string | null
} | null> {
  const { data, error } = await supabase
    .from('run_events')
    .select('payload')
    .eq('run_id', runId)
    .eq('event_type', 'run_metrics')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  const p = data.payload as Record<string, unknown>
  return {
    model:            typeof p.model === 'string' ? p.model : null,
    tokens_in:        typeof p.tokens_in === 'number' ? p.tokens_in : 0,
    tokens_out:       typeof p.tokens_out === 'number' ? p.tokens_out : 0,
    latency_ms:       typeof p.latency_ms === 'number' ? p.latency_ms : 0,
    verifier_outcome: typeof p.verifier_outcome === 'string' ? p.verifier_outcome : null,
  }
}

const repoRoot       = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const cliProjectPath = path.join(repoRoot, 'src', 'AgentArmy.Cli')

// ── DB yardımcıları ────────────────────────────────────────────────────────

async function upsertRunsRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: RunRequest,
  runId: string,
  startedAt: number,
  metrics: Awaited<ReturnType<typeof readMetricsFromDb>>,
  latencyMs: number,
) {
  const meta = extractRunMeta(job)
  await supabase.from('runs').insert({
    owner_user_id:    job.owner_user_id,
    external_id:      runId,
    title:            job.request_text?.slice(0, 100) ?? runId,
    status:           'success',
    started_at:       new Date(startedAt).toISOString(),
    finished_at:      new Date().toISOString(),
    domain_pack:      job.domain_pack,
    risk_level:       job.risk,
    model:            metrics?.model  ?? job.model,
    tokens_in:        metrics?.tokens_in  ?? null,
    tokens_out:       metrics?.tokens_out ?? null,
    latency_ms:       metrics?.latency_ms ?? latencyMs,
    cost_usd:         estimateCostUsd(metrics?.model ?? null, metrics?.tokens_in ?? 0, metrics?.tokens_out ?? 0),
    verifier_outcome: metrics?.verifier_outcome ?? null,
    meta,
  })
}

/** D1b: Eval run'ları meta.eval=true ile etiketlenir; KPI sorgularından dışlanır. */
function extractRunMeta(job: RunRequest): Record<string, unknown> {
  const payload = (job.answers_json ?? {}) as Record<string, unknown>
  if (payload.eval === true) {
    return {
      eval:    true,
      pack:    payload.pack ?? job.domain_pack ?? null,
      case_id: payload.case_id ?? null,
    }
  }
  if (payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta))
    return payload.meta as Record<string, unknown>
  return {}
}

async function writeAuditEntry(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: RunRequest,
  runId: string | null,
  success: boolean,
  errorMsg?: string,
) {
  await supabase.from('audit_log').insert({
    owner_user_id: job.owner_user_id,
    actor_type:    'worker',
    actor_id:      'run-worker',
    action:        success ? 'run.complete' : 'run.fail',
    resource_type: 'run_request',
    resource_id:   job.id,
    risk_level:    job.risk,
    severity:      success ? 'info' : 'error',
    detail: {
      run_id:      runId,
      domain_pack: job.domain_pack,
      mode:        job.mode,
      model:       job.model,
      ...(errorMsg ? { error: errorMsg.slice(0, 500) } : {}),
    },
  })
}

// Sector Discovery: run_outputs tablosundan scaffold adımını oku, domain_pack_drafts'a yaz
async function writeDraftFromRunOutputs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: RunRequest,
  runId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('run_outputs')
    .select('content_md')
    .eq('run_id', runId)
    .eq('step_id', 'scaffold')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    log('DomainPackDraft: scaffold sorgu hatası', { runId, error: error.message })
    return
  }
  // scaffold adımı yoksa bu bir sektör-keşif run'ı değildir (örn. tedarik) — sessizce çık.
  if (!data?.content_md) return

  const draftJson = extractJsonFromText(data.content_md)
  if (!draftJson) {
    log('DomainPackDraft: scaffold içinde geçerli JSON bulunamadı', { runId })
    return
  }

  const payload     = (job.answers_json ?? {}) as Record<string, unknown>
  const sectorPrompt = typeof payload.sector_prompt === 'string'
    ? payload.sector_prompt
    : (job.request_text ?? '')

  // D4a: eksik araç → MCP registry önerileri (draft_json.suggested_mcp)
  let draftWithSuggestions = { ...draftJson } as Record<string, unknown>
  try {
    const missing = await collectMissingToolSlugs(supabase, draftWithSuggestions)
    if (missing.length > 0) {
      const suggestions = await suggestMcpForMissingTools(supabase, missing)
      draftWithSuggestions = {
        ...draftWithSuggestions,
        missing_tools: missing,
        suggested_mcp: suggestions.map((s) => ({
          slug: s.slug,
          name: s.name,
          description: s.description,
          transport: s.transport,
          endpoint: s.endpoint,
          homepage: s.homepage,
          auth_env_hint: s.auth_env_hint,
          risk_hint: s.risk_hint,
          bindable: typeof s.endpoint === 'string' && s.endpoint.startsWith('https://'),
        })),
      }
      log('DomainPackDraft suggested_mcp', { missing: missing.length, suggestions: suggestions.length })
    }
  } catch (e) {
    log('DomainPackDraft MCP suggest atlandı', { error: e instanceof Error ? e.message : String(e) })
  }

  const { data: inserted, error: insertErr } = await supabase.from('domain_pack_drafts').insert({
    tenant_id:        job.owner_user_id,
    run_request_id:   job.id,
    sector_prompt:    sectorPrompt,
    proposed_pack_id: typeof draftWithSuggestions.id   === 'string' ? draftWithSuggestions.id   : null,
    proposed_name:    typeof draftWithSuggestions.name === 'string' ? draftWithSuggestions.name : null,
    status:           'pending',
    draft_json:       draftWithSuggestions,
  }).select('id').single()

  if (insertErr) {
    log('DomainPackDraft insert hatası', { error: insertErr.message })
  } else {
    log('DomainPackDraft kaydedildi', { pack_id: draftJson.id, run_id: runId, draft_id: inserted?.id })
    if (inserted?.id) {
      try {
        await enqueueEvalGeneratorJob(supabase, inserted.id as string, job.owner_user_id)
        log('EvalGenerator job enqueued', { draft_id: inserted.id })
      } catch (e) {
        log('EvalGenerator enqueue failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
}


const DEFAULT_CMD_TIMEOUT_MS = Number.parseInt(process.env.WORKER_CMD_TIMEOUT_MS ?? '120000', 10)
const SLA_THRESHOLD_MS       = Number.parseInt(process.env.WORKER_SLA_THRESHOLD_MS ?? '30000', 10)

function runCmd(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  cwd = repoRoot,
  timeoutMs = DEFAULT_CMD_TIMEOUT_MS,
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      log('runCmd timeout — killing child process', { command, timeoutMs, pid: child.pid })
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already dead */ } }, 3000)
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.slice(0, 3).join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; process.stdout.write(s) })
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; process.stderr.write(s) })
    child.on('error', (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err) })
    child.on('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }) })
  })
}

function log(message: string, meta?: Record<string, unknown>) {
  const ts   = new Date().toISOString()
  const base = `[worker ${ts}] ${message}`
  if (!meta) { console.log(base); return }
  console.log(base, JSON.stringify(meta))
}

function logEnvironment() {
  log('Environment info', {
    repo_root:        repoRoot,
    cli_project_path: cliProjectPath,
    cwd:              process.cwd(),
    node_env:         process.env.NODE_ENV,
    github_workspace: process.env.GITHUB_WORKSPACE,
    import_root:      process.env.LOCAL_AGENTARMY_ROOT,
  })
}

// CLI artık runId'yi (tam dizin yolu değil) stdout'a yazar.
// CEO modu "OK" veya "FAILED" yazar, bundle/run modu runId yazar.
function extractRunId(stdout: string): string | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.startsWith('PLAYBOOK_RUN_IDS=')) continue
    // runId formatı: yyyyMMdd_HHmmss_<playbook-id> veya bundle variant
    if (/^\d{8}_\d{6}_/.test(l)) return l
  }
  return null
}

function extractPlaybookRunIds(stdout: string): string[] {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    const m = /^PLAYBOOK_RUN_IDS=(.+)$/.exec(trimmed)
    if (m?.[1]) {
      return m[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

/** CEO stdout'taki "- soru" satırlarını çıkarır (portal API olmadan review için). */
function extractCeoQuestions(stdout: string): string[] {
  const lines = stdout.split('\n')
  const questions: string[] = []
  let inBlock = false
  for (const raw of lines) {
    const t = raw.trim()
    if (t.startsWith('CEO sorular')) {
      inBlock = true
      continue
    }
    if (!inBlock) continue
    if (t === 'CEO_QUESTIONS_ONLY=1') break
    if (t === 'OK' || t === 'FAILED') break
    if (!t) continue
    if (t.startsWith('- ')) {
      questions.push(t.slice(2).trim())
      continue
    }
    if (questions.length > 0) break
  }
  return questions.filter(Boolean)
}

function buildDotnetArgs(job: RunRequest) {
  const noBuild = process.env.DOTNET_NO_BUILD === 'true'
  const base = noBuild
    ? ['run', '--project', cliProjectPath, '--no-build', '--configuration', 'Release', '--']
    : ['run', '--project', cliProjectPath, '--']

  const domainPack    = job.domain_pack ?? 'market-intel'
  const model         = job.model ?? 'gpt-4.1'
  const web           = job.web ? 'true' : 'false'
  const contrarian    = job.contrarian ? 'true' : 'false'
  const risk          = job.risk ?? 'R1'
  const allowHighRisk = job.allow_high_risk ? 'true' : 'false'

  if (job.mode === 'ceo') {
    return base.concat([
      'ceo',
      '--domainPack', domainPack,
      '--request',    job.request_text ?? '',
      '--model',      model,
      '--risk',       risk,
      '--allowHighRisk', allowHighRisk,
      '--web',        web,
      '--contrarian', contrarian,
      ...(job.tools && job.tools.trim() ? ['--tools', job.tools.trim()] : []),
    ])
  }

  if (job.mode === 'ceo-iterate') {
    return base.concat([
      'ceo-iterate',
      '--domainPack', domainPack,
      '--request',    job.request_text ?? '',
      '--answers',    job.answers_json ? JSON.stringify(job.answers_json) : '{}',
      '--model',      model,
      '--risk',       risk,
      '--allowHighRisk', allowHighRisk,
      '--web',        web,
      '--contrarian', contrarian,
      ...(job.tools && job.tools.trim() ? ['--tools', job.tools.trim()] : []),
    ])
  }

  if (job.mode === 'bundle') {
    const payload  = (job.answers_json ?? {}) as Record<string, unknown>
    const bundleId =
      typeof payload.bundleId === 'string'
        ? payload.bundleId.trim()
        : typeof payload.bundleSlug === 'string'
          ? payload.bundleSlug.trim()
          : 'weekly'
    const topic    = typeof payload.topic === 'string' ? payload.topic : (job.request_text ?? '')
    return base.concat([
      'bundle',
      '--domainPack', domainPack,
      '--id',         bundleId,
      '--topic',      topic,
      '--model',      model,
      '--risk',       risk,
      '--allowHighRisk', allowHighRisk,
      '--web',        web,
      '--contrarian', contrarian,
      ...(job.tools && job.tools.trim() ? ['--tools', job.tools.trim()] : []),
    ])
  }

  // mode === 'run'
  const payload    = (job.answers_json ?? {}) as Record<string, unknown>
  const playbookId = typeof payload.playbookId === 'string' ? payload.playbookId : ''
  const stepSpec   = payload.step_spec as Record<string, unknown> | undefined
  const topic      = typeof stepSpec?.topic === 'string'
    ? stepSpec.topic
    : typeof payload.topic === 'string' ? payload.topic : (job.request_text ?? '')
  const persona    = typeof stepSpec?.agent_slug === 'string'
    ? stepSpec.agent_slug.trim()
    : typeof payload.persona === 'string' ? payload.persona.trim() : ''
  const runRisk    = typeof stepSpec?.risk === 'string' ? stepSpec.risk : risk
  if (!playbookId) throw new Error('mode=run requires answers_json.playbookId')

  const args = [
    'run',
    '--domainPack', domainPack,
    '--playbook',   playbookId,
    '--topic',      topic,
    '--model',      model,
    '--risk',       runRisk,
    '--allowHighRisk', (allowHighRisk === 'true' || runRisk === 'R3') ? 'true' : 'false',
    '--web',        web,
    '--contrarian', contrarian,
  ]
  // Persona seçimi opsiyonel; verilirse CLI --persona arg'ı geçilir, böylece
  // Orchestrator persona profile'ı doğru slug'la yükleyip behaviors overlay'i uygular.
  if (persona) args.push('--persona', persona)
  const toolsField = typeof stepSpec?.tools_spec === 'string'
    ? stepSpec.tools_spec
    : job.tools?.trim()
  if (toolsField) args.push('--tools', toolsField)

  return base.concat(args)
}

async function claimOne() {
  const supabase = getSupabaseAdmin()
  const claimed  = await supabase.rpc('claim_run_request')
  if (claimed.error) throw claimed.error
  const job = claimed.data as RunRequest | null
  if (!job?.id) return null
  return { supabase, job }
}

async function processOne(supabase: ReturnType<typeof getSupabaseAdmin>, job: RunRequest) {
  const jobCreatedAt    = new Date(job.created_at).getTime()
  const tickStart       = Date.now()
  const queueLatencyMs  = tickStart - jobCreatedAt

  try {
    log('Claimed job', {
      id:               job.id,
      mode:             job.mode,
      domain_pack:      job.domain_pack,
      model:            job.model,
      web:              job.web,
      contrarian:       job.contrarian,
      risk:             job.risk,
      attempt:          job.attempt_count,
      queue_latency_ms: queueLatencyMs,
    })

    if (job.mode === 'eval_generator') {
      await processEvalGeneratorJob(supabase, job.id)
      log('EvalGenerator job success', { id: job.id })
      return
    }

    if ((job.risk === 'R2' || job.risk === 'R3') && !job.allow_high_risk) {
      // D2a sector-builder CEO soru fazı: yalnızca netleştirici soru üretir, R2 onay kapısı gereksiz.
      const answers = (job.answers_json ?? {}) as Record<string, unknown>
      const isSectorQuestionPhase =
        job.mode === 'ceo' &&
        answers.source === 'sector-builder' &&
        answers.phase === 'questions'

      // sector_factory ara playbook adımları (araştırma/taslak/test) otonom R1; yalnızca pack.publish R2 onaylı.
      let isSectorFactoryStep = false
      const linkedOpId =
        job.operation_id ??
        (typeof answers.operation_id === 'string' ? answers.operation_id : null)
      if (job.mode === 'run' && linkedOpId) {
        const { data: opRow } = await supabase
          .from('operations')
          .select('context_json')
          .eq('id', linkedOpId)
          .maybeSingle()
        isSectorFactoryStep =
          (opRow?.context_json as Record<string, unknown> | undefined)?.kind === 'sector_factory'
      }

      if (!isSectorQuestionPhase && !isSectorFactoryStep) {
        log('R2/R3 job requires human approval — gating', { id: job.id, risk: job.risk })
        const actionSummary = [job.mode, job.domain_pack, job.request_text?.slice(0, 120)]
          .filter(Boolean).join(' · ')
        const { data: queueId, error: gateErr } = await supabase.rpc('gate_run_for_approval', {
          p_run_request_id: job.id,
          p_owner_user_id:  job.owner_user_id,
          p_risk_level:     job.risk,
          p_action_summary: actionSummary || `${job.mode} çalıştırma isteği`,
          p_step_index:     0,
          p_step_name:      job.mode,
          p_agent_code:     null,
          p_action_detail:  {
            mode:        job.mode,
            domain_pack: job.domain_pack,
            model:       job.model,
            risk:        job.risk,
            request:     job.request_text?.slice(0, 500),
          },
        })
        if (gateErr) throw new Error(`Approval gate failed: ${gateErr.message}`)
        log('Job gated for approval', { id: job.id, risk: job.risk })

        await notifyChannels({
          ownerId: job.owner_user_id,
          subject: `[AgentArmy] ${job.risk} onay bekliyor`,
          message: [
            `Çalıştırma isteği onay bekliyor (${job.risk}).`,
            `Özet: ${actionSummary || job.mode}`,
            `Onay ID: ${queueId ?? job.id}`,
          ].join('\n'),
        })
        return
      }
    }

    if (job.mode === 'bundle') {
      const payload = (job.answers_json ?? {}) as Record<string, unknown>
      const bundleId =
        typeof payload.bundleId === 'string'
          ? payload.bundleId.trim()
          : typeof payload.bundleSlug === 'string'
            ? payload.bundleSlug.trim()
            : 'weekly'
      const packId = job.domain_pack ?? 'market-intel'
      await assertBundleExistsDbFirst(supabase, packId, bundleId)
    }

    const dotnetArgs = buildDotnetArgs(job)

    // Agent'lar artık CLI tarafından doğrudan DB'den yükleniyor.
    // writeAgentsFile / --agentsFile kaldırıldı.

    if (Array.isArray(job.selected_agents) && job.selected_agents.length > 0) {
      dotnetArgs.push('--agents', job.selected_agents.join(','))
      log('Using selected agents', { selected_agents: job.selected_agents })
    }

    // PR9: intent_json'ı çalıştırma anında DB'den taze oku (snapshot sürüklenmesini önler).
    // Worker operation_id → operations.intent_json → RUN_INTENT_JSON env. CLI bu env'i okur.
    let runIntentJson: string | undefined
    if (job.operation_id) {
      const { data: opRow } = await supabase
        .from('operations')
        .select('intent_json')
        .eq('id', job.operation_id)
        .maybeSingle()
      const intentJson = (opRow as { intent_json: unknown } | null)?.intent_json
      if (intentJson != null) {
        runIntentJson = JSON.stringify(intentJson)
      }
    }

    // Timeout policy'den oku: web-search koşuları 120 sn'de kesiliyor (canlı fail gözlemlendi).
    const cmdTimeoutMs = await getPolicy(supabase, job.owner_user_id, 'worker.run_timeout_ms', DEFAULT_CMD_TIMEOUT_MS) as number

    log('Running dotnet', { args: ['dotnet', ...dotnetArgs], timeout_ms: cmdTimeoutMs })
    const started = Date.now()

    const { code, stdout, stderr } = await runCmd('dotnet', dotnetArgs, {
      OPENAI_API_KEY:              process.env.OPENAI_API_KEY,
      SUPABASE_URL:                process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY:   process.env.SUPABASE_SERVICE_ROLE_KEY,
      SERPER_KEY:                  process.env.SERPER_KEY,    // product_search birincil (Serper.dev)
      SERPAPI_KEY:                 process.env.SERPAPI_KEY,   // geriye uyumluluk (aynı Serper anahtarı)
      TAVILY_KEY:                  process.env.TAVILY_KEY,    // product_search yedek backend
      RUN_OWNER_USER_ID:           job.owner_user_id,
      // Sector Discovery hook için: Runner draft yazarken run_request_id bilsin.
      RUN_REQUEST_ID:              job.id,
      // Operasyon belleği: OperationMemoryStore bu id'yi kullanır.
      RUN_OPERATION_ID:            job.operation_id ?? undefined,
      // PR9: operasyonun taze intent sözleşmesi (forbidden_tools, spend cap vb.)
      RUN_INTENT_JSON:             runIntentJson,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO:               '1',
    }, repoRoot, cmdTimeoutMs)

    log('Dotnet finished', { code, duration_ms: Date.now() - started })

    if (code !== 0) {
      throw new Error(`dotnet failed (${code})\n${stderr || stdout}`)
    }

    // CLI artık runId'yi stdout'a yazar (tam dizin yolu değil)
    const runId = extractRunId(stdout)
    const playbookRunIds = extractPlaybookRunIds(stdout)
    const ceoQuestions = job.mode === 'ceo' ? extractCeoQuestions(stdout) : []
    log('Extracted runId', {
      runId,
      playbook_run_ids: playbookRunIds,
      ceo_questions: ceoQuestions.length,
      stdout_tail: stdout.trim().split('\n').slice(-5).join('\n'),
    })

    const metricsRunId = playbookRunIds.length > 0 ? playbookRunIds[playbookRunIds.length - 1] : runId
    const metrics    = metricsRunId ? await readMetricsFromDb(supabase, metricsRunId) : null
    const latencyMs  = Date.now() - started

    // runs tablosuna INSERT et (importFromRunDir artık yok)
    if (runId) {
      await upsertRunsRow(supabase, job, runId, started, metrics, latencyMs)
      log('runs row upserted', { runId, ...metrics })
    }
    for (const childRunId of playbookRunIds) {
      if (childRunId === runId) continue
      await upsertRunsRow(supabase, job, childRunId, started, null, latencyMs)
      log('runs row upserted (bundle child)', { runId: childRunId })
    }

    // Sector discovery: scaffold adımından domain_pack_drafts'a yaz (sector-builder ceo hariç)
    const payload = (job.answers_json ?? {}) as Record<string, unknown>
    const isSectorBuilderCeo = job.mode === 'ceo' && payload.source === 'sector-builder'
    if (runId && job.mode !== 'bundle' && !isSectorBuilderCeo) {
      await writeDraftFromRunOutputs(supabase, job, runId)
    }

    const totalMs    = Date.now() - jobCreatedAt
    const slaBreached = totalMs > SLA_THRESHOLD_MS
    if (slaBreached) {
      log('SLA breach', { id: job.id, total_ms: totalMs, threshold_ms: SLA_THRESHOLD_MS })
    }

    const { error: updateErr } = await supabase
      .from('run_requests')
      .update({
        status:        'success',
        finished_at:   new Date().toISOString(),
        updated_at:    new Date().toISOString(),
        error_message: null,
        sla_breach:    slaBreached,
        result_json: {
          run_id:             runId,
          playbook_run_ids:   playbookRunIds.length > 0 ? playbookRunIds : undefined,
          clarifying_questions: ceoQuestions.length > 0 ? ceoQuestions : undefined,
          dotnet_stdout_tail: stdout.trim().split('\n').slice(-5).join('\n'),
          metrics,
          sla: { total_ms: totalMs, queue_latency_ms: queueLatencyMs, sla_threshold_ms: SLA_THRESHOLD_MS },
        },
      })
      .eq('id', job.id)

    if (updateErr) throw updateErr
    log('Job success', { id: job.id, run_id: runId, total_ms: totalMs, sla_breach: slaBreached })

    // D2c: canary decrement + D0 smoke (eval run'ları hariç)
    if (job.domain_pack && job.mode === 'run') {
      const evalMeta = process.env.RUN_EVAL_META
      const isEval = evalMeta ? (() => { try { return JSON.parse(evalMeta).eval === true } catch { return false } })() : false
      if (!isEval) {
        const { data: dec } = await supabase.rpc('decrement_pack_canary', {
          p_pack_id: job.domain_pack,
          p_is_eval: false,
        })
        log('Canary decrement', { pack: job.domain_pack, result: dec })
        const { data: packRow } = await supabase
          .from('domain_packs')
          .select('meta')
          .eq('id', job.domain_pack)
          .maybeSingle()
        const meta = packRow?.meta as Record<string, unknown> | undefined
        if (meta?.canary === true && meta?.canary_d0_verified !== true) {
          await runCanaryD0SmokeAndVerify(supabase, job.domain_pack)
          log('Canary D0 smoke completed', { pack: job.domain_pack })
        }
      }
    }

    // Audit log
    await writeAuditEntry(supabase, job, runId ?? null, true)

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)

    // Audit log (başarısız)
    try { await writeAuditEntry(supabase, job, null, false, msg) } catch { /* ignore */ }

    const { error: updateErr } = await supabase
      .from('run_requests')
      .update({
        status:        'fail',
        finished_at:   new Date().toISOString(),
        updated_at:    new Date().toISOString(),
        error_message: msg.slice(0, 2000),
      })
      .eq('id', job.id)
    if (updateErr) console.error('Failed to update job status', updateErr)
    throw e
  }
}

async function cleanupStale() {
  const supabase    = getSupabaseAdmin()
  const staleMinutes = Number.parseInt(process.env.WORKER_STALE_MINUTES ?? '35', 10)
  const { data, error } = await supabase.rpc('cleanup_stale_running_jobs', {
    stale_minutes: staleMinutes,
    max_attempts:  3,
  })
  if (error) { log('cleanup_stale_running_jobs error', { error: error.message }); return }
  const cleaned = (data ?? []) as { job_id: string; new_status: string }[]
  if (cleaned.length > 0) {
    log('Stale jobs cleaned up', { count: cleaned.length, jobs: cleaned })
  }
}

export async function runOnce() {
  logEnvironment()
  await cleanupStale()

  const maxJobs = Number.parseInt(process.env.MAX_JOBS ?? '1', 10)
  const limit   = Number.isFinite(maxJobs) && maxJobs > 0 ? maxJobs : 1

  log('Worker tick', { max_jobs: limit })

  for (let i = 0; i < limit; i++) {
    const claimed = await claimOne()
    if (!claimed) {
      if (i === 0) console.log('No pending jobs')
      return
    }
    await processOne(claimed.supabase, claimed.job)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  runOnce().catch((e) => { console.error(e); process.exit(1) })
}
