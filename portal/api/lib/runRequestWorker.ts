import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { assertBundleExists } from './builtinBundles.js'

type RunRequest = {
  id: string
  owner_user_id: string
  mode: 'run' | 'bundle' | 'ceo' | 'ceo-iterate'
  domain_pack: string | null
  request_text: string | null
  answers_json: unknown | null
  selected_agents: string[] | null
  model: string | null
  web: boolean
  contrarian: boolean
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
  created_at: string
  attempt_count: number
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
  })
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
    .single()

  if (error || !data?.content_md) {
    log('DomainPackDraft: run_outputs scaffold adımı bulunamadı', { runId, error: error?.message })
    return
  }

  const draftJson = extractJsonFromText(data.content_md)
  if (!draftJson) {
    log('DomainPackDraft: scaffold içinde geçerli JSON bulunamadı', { runId })
    return
  }

  const payload     = (job.answers_json ?? {}) as Record<string, unknown>
  const sectorPrompt = typeof payload.sector_prompt === 'string'
    ? payload.sector_prompt
    : (job.request_text ?? '')

  const { error: insertErr } = await supabase.from('domain_pack_drafts').insert({
    tenant_id:        job.owner_user_id,
    run_request_id:   job.id,
    sector_prompt:    sectorPrompt,
    proposed_pack_id: typeof draftJson.id   === 'string' ? draftJson.id   : null,
    proposed_name:    typeof draftJson.name === 'string' ? draftJson.name : null,
    status:           'pending',
    draft_json:       draftJson,
  })

  if (insertErr) {
    log('DomainPackDraft insert hatası', { error: insertErr.message })
  } else {
    log('DomainPackDraft kaydedildi', { pack_id: draftJson.id, run_id: runId })
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
    ])
  }

  // mode === 'run'
  const payload    = (job.answers_json ?? {}) as Record<string, unknown>
  const playbookId = typeof payload.playbookId === 'string' ? payload.playbookId : ''
  const topic      = typeof payload.topic === 'string' ? payload.topic : (job.request_text ?? '')
  const persona    = typeof payload.persona === 'string' ? payload.persona.trim() : ''
  if (!playbookId) throw new Error('mode=run requires answers_json.playbookId')

  const args = [
    'run',
    '--domainPack', domainPack,
    '--playbook',   playbookId,
    '--topic',      topic,
    '--model',      model,
    '--risk',       risk,
    '--allowHighRisk', allowHighRisk,
    '--web',        web,
    '--contrarian', contrarian,
  ]
  // Persona seçimi opsiyonel; verilirse CLI --persona arg'ı geçilir, böylece
  // Orchestrator persona profile'ı doğru slug'la yükleyip behaviors overlay'i uygular.
  if (persona) args.push('--persona', persona)

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

    if ((job.risk === 'R2' || job.risk === 'R3') && !job.allow_high_risk) {
      log('R2/R3 job requires human approval — gating', { id: job.id, risk: job.risk })
      const actionSummary = [job.mode, job.domain_pack, job.request_text?.slice(0, 120)]
        .filter(Boolean).join(' · ')
      const { error: gateErr } = await supabase.rpc('gate_run_for_approval', {
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
      return
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

    log('Running dotnet', { args: ['dotnet', ...dotnetArgs] })
    const started = Date.now()

    const { code, stdout, stderr } = await runCmd('dotnet', dotnetArgs, {
      OPENAI_API_KEY:              process.env.OPENAI_API_KEY,
      SUPABASE_URL:                process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY:   process.env.SUPABASE_SERVICE_ROLE_KEY,
      RUN_OWNER_USER_ID:           job.owner_user_id,
      // Sector Discovery hook için: Runner draft yazarken run_request_id bilsin.
      RUN_REQUEST_ID:              job.id,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO:               '1',
    }, repoRoot)

    log('Dotnet finished', { code, duration_ms: Date.now() - started })

    if (code !== 0) {
      throw new Error(`dotnet failed (${code})\n${stderr || stdout}`)
    }

    // CLI artık runId'yi stdout'a yazar (tam dizin yolu değil)
    const runId = extractRunId(stdout)
    const playbookRunIds = extractPlaybookRunIds(stdout)
    log('Extracted runId', { runId, playbook_run_ids: playbookRunIds, stdout_tail: stdout.trim().split('\n').slice(-5).join('\n') })

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

    // Sector discovery: scaffold adımından domain_pack_drafts'a yaz
    if (runId && job.mode !== 'bundle') {
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
          dotnet_stdout_tail: stdout.trim().split('\n').slice(-5).join('\n'),
          metrics,
          sla: { total_ms: totalMs, queue_latency_ms: queueLatencyMs, sla_threshold_ms: SLA_THRESHOLD_MS },
        },
      })
      .eq('id', job.id)

    if (updateErr) throw updateErr
    log('Job success', { id: job.id, run_id: runId, total_ms: totalMs, sla_breach: slaBreached })

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
