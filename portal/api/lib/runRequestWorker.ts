import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { importFromRunDir } from './localImporter.js'

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

type DbAgent = {
  id: string
  name: string
  code: string
  description: string | null
  capabilities: string[]
  role: string | null
  risk_ceiling: string | null
  cost_class: string | null
  behaviors: Record<string, unknown> | null
  system_prompt: string | null
}

// IP1.2: run çıktı dizinindeki metrics.json dosyasını oku
async function readMetricsJson(runDir: string): Promise<{
  model: string | null
  tokens_in: number
  tokens_out: number
  latency_ms: number
  verifier_outcome: string | null
} | null> {
  try {
    const p = path.join(runDir, 'metrics.json')
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// IP1.7: model adına göre yaklaşık maliyet tahmini (USD)
// Fiyatlar OpenAI genel fiyatlandırmasına göre; env override'larla değiştirilebilir.
function estimateCostUsd(
  model: string | null,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (!model || (!tokensIn && !tokensOut)) return null

  const m = model.toLowerCase()
  // Fiyat tablosu: [in $/1M, out $/1M]
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const cliProjectPath = path.join(repoRoot, 'src', 'AgentArmy.Cli')

// ── Sector Discovery: scaffold çıktısından domain_pack_drafts INSERT ─────────

function extractJsonFromText(text: string): Record<string, unknown> | null {
  // ```json ... ``` bloğu
  const fenced = text.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* devam */ }
  }
  // ``` ... ``` (lang etiketi olmadan)
  const anyFenced = text.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFenced) {
    try { return JSON.parse(anyFenced[1]) } catch { /* devam */ }
  }
  // Ham JSON: ilk { ... }
  const first = text.indexOf('{')
  const last  = text.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)) } catch { /* devam */ }
  }
  return null
}

async function writeDomainPackDraft(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: RunRequest,
  runDir: string,
): Promise<void> {
  // scaffold.*.md dosyalarını tara
  let files: string[] = []
  try {
    const allFiles = await fs.readdir(runDir)
    files = allFiles
      .filter((f) => f.startsWith('scaffold') && f.endsWith('.md'))
      .map((f) => path.join(runDir, f))
  } catch {
    log('DomainPackDraft: runDir okunamadı', { runDir })
    return
  }

  if (files.length === 0) {
    // work.md'yi de dene (Orchestrator tüm adımları buraya da yazar)
    const workMd = path.join(runDir, 'work.md')
    if (await fs.stat(workMd).then(() => true).catch(() => false)) {
      files = [workMd]
    }
  }

  let draftJson: Record<string, unknown> | null = null
  for (const f of files) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    draftJson = extractJsonFromText(content)
    if (draftJson) break
  }

  if (!draftJson) {
    log('DomainPackDraft: JSON bulunamadı scaffold çıktısında', { runDir, files })
    return
  }

  const payload = (job.answers_json ?? {}) as Record<string, unknown>
  const sectorPrompt = typeof payload.sector_prompt === 'string'
    ? payload.sector_prompt
    : (job.request_text ?? '')

  const { error } = await supabase.from('domain_pack_drafts').insert({
    tenant_id:        job.owner_user_id,
    run_request_id:   job.id,
    sector_prompt:    sectorPrompt,
    proposed_pack_id: typeof draftJson.id === 'string' ? draftJson.id : null,
    proposed_name:    typeof draftJson.name === 'string' ? draftJson.name : null,
    status:           'pending',
    draft_json:       draftJson,
  })

  if (error) {
    log('DomainPackDraft insert hatası', { error: error.message })
  } else {
    log('DomainPackDraft kaydedildi', {
      pack_id: draftJson.id,
      name: draftJson.name,
      run_request_id: job.id,
    })
  }
}

async function writeAgentsFile(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const res = await supabase
    .from('agents')
    .select('id,name,code,description,capabilities,role,risk_ceiling,cost_class,behaviors,system_prompt')
    .order('updated_at', { ascending: false })

  if (res.error) {
    throw res.error
  }

  const agents = (res.data ?? []) as DbAgent[]
  if (agents.length === 0) {
    return null
  }

  const payload = {
    agents: agents.map((a) => ({
      code: a.code,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities ?? [],
      role: a.role,
      riskCeiling: a.risk_ceiling,
      costClass: a.cost_class,
      behaviors: a.behaviors ?? {},
      systemPrompt: a.system_prompt,
    })),
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentarmy-agents-'))
  const filePath = path.join(dir, 'agents.json')
  await fs.writeFile(filePath, JSON.stringify(payload), 'utf-8')
  return filePath
}

// IP1.3: SLA — varsayılan timeout 120 sn; LLM çağrıları dahil tüm dotnet süreci için.
// WORKER_CMD_TIMEOUT_MS env değişkeniyle override edilebilir.
const DEFAULT_CMD_TIMEOUT_MS = Number.parseInt(process.env.WORKER_CMD_TIMEOUT_MS ?? '120000', 10)
// SLA hedef: oluşturma → tamamlama < 30 sn (GHA queue + build cache ile mümkün)
const SLA_THRESHOLD_MS = Number.parseInt(process.env.WORKER_SLA_THRESHOLD_MS ?? '30000', 10)

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

    child.stdout.on('data', (d) => {
      const s = d.toString()
      stdout += s
      process.stdout.write(s)
    })
    child.stderr.on('data', (d) => {
      const s = d.toString()
      stderr += s
      process.stderr.write(s)
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function log(message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const base = `[worker ${ts}] ${message}`
  if (!meta) {
    console.log(base)
    return
  }
  console.log(base, JSON.stringify(meta))
}

function logEnvironment() {
  log('Environment info', {
    repo_root: repoRoot,
    cli_project_path: cliProjectPath,
    cwd: process.cwd(),
    node_env: process.env.NODE_ENV,
    pwd: process.env.PWD,
    github_workspace: process.env.GITHUB_WORKSPACE,
    dotnet_root: process.env.DOTNET_ROOT,
    import_root: process.env.LOCAL_AGENTARMY_ROOT,
  })
}

function extractRunDir(stdout: string) {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.includes('/runs/ceo/') || l.includes('/runs/bundles/')) {
      return l
    }
  }
  return null
}


function buildDotnetArgs(job: RunRequest) {
  // IP1.3: DOTNET_NO_BUILD=true → GHA'da build adımı zaten yapıldı, tekrar build etme
  const noBuild = process.env.DOTNET_NO_BUILD === 'true'
  const base = noBuild
    ? ['run', '--project', cliProjectPath, '--no-build', '--configuration', 'Release', '--']
    : ['run', '--project', cliProjectPath, '--']

  const domainPack = job.domain_pack ?? 'market-intel'
  const model = job.model ?? 'gpt-4.1'
  const web = job.web ? 'true' : 'false'
  const contrarian = job.contrarian ? 'true' : 'false'
  const risk = job.risk ?? 'R1'
  const allowHighRisk = job.allow_high_risk ? 'true' : 'false'

  if (job.mode === 'ceo') {
    const request = job.request_text ?? ''
    return base.concat([
      'ceo',
      '--domainPack',
      domainPack,
      '--request',
      request,
      '--model',
      model,
      '--risk',
      risk,
      '--allowHighRisk',
      allowHighRisk,
      '--web',
      web,
      '--contrarian',
      contrarian,
    ])
  }

  if (job.mode === 'ceo-iterate') {
    const request = job.request_text ?? ''
    const answers = job.answers_json ? JSON.stringify(job.answers_json) : '{}'
    return base.concat([
      'ceo-iterate',
      '--domainPack',
      domainPack,
      '--request',
      request,
      '--answers',
      answers,
      '--model',
      model,
      '--risk',
      risk,
      '--allowHighRisk',
      allowHighRisk,
      '--web',
      web,
      '--contrarian',
      contrarian,
    ])
  }

  if (job.mode === 'bundle') {
    const payload = (job.answers_json ?? {}) as Record<string, unknown>
    const bundleId = typeof payload.bundleId === 'string' ? payload.bundleId : 'weekly'
    const topic = typeof payload.topic === 'string' ? payload.topic : (job.request_text ?? '')
    return base.concat([
      'bundle',
      '--domainPack',
      domainPack,
      '--id',
      bundleId,
      '--topic',
      topic,
      '--model',
      model,
      '--risk',
      risk,
      '--allowHighRisk',
      allowHighRisk,
      '--web',
      web,
      '--contrarian',
      contrarian,
    ])
  }

  const payload = (job.answers_json ?? {}) as Record<string, unknown>
  const playbookId = typeof payload.playbookId === 'string' ? payload.playbookId : ''
  const topic = typeof payload.topic === 'string' ? payload.topic : (job.request_text ?? '')
  if (!playbookId) {
    throw new Error('mode=run requires answers_json.playbookId')
  }
  return base.concat([
    'run',
    '--domainPack',
    domainPack,
    '--playbook',
    playbookId,
    '--topic',
    topic,
    '--model',
    model,
    '--risk',
    risk,
    '--allowHighRisk',
    allowHighRisk,
    '--web',
    web,
    '--contrarian',
    contrarian,
  ])
}

async function claimOne() {
  const supabase = getSupabaseAdmin()

  const claimed = await supabase.rpc('claim_run_request')
  if (claimed.error) {
    throw claimed.error
  }

  const job = claimed.data as RunRequest | null
  if (!job?.id) {
    return null
  }

  return { supabase, job }
}

async function processOne(supabase: ReturnType<typeof getSupabaseAdmin>, job: RunRequest) {
  // IP1.3: SLA ölçümü — job'un oluşturulmasından itibaren geçen süre
  const jobCreatedAt = new Date(job.created_at).getTime()
  const tickStart    = Date.now()
  const queueLatencyMs = tickStart - jobCreatedAt

  try {
    log('Claimed job', {
      id: job.id,
      mode: job.mode,
      domain_pack: job.domain_pack,
      model: job.model,
      web: job.web,
      contrarian: job.contrarian,
      risk: job.risk,
      attempt: job.attempt_count,
      queue_latency_ms: queueLatencyMs,
    })

    if ((job.risk === 'R2' || job.risk === 'R3') && !job.allow_high_risk) {
      // IP1.5b: Gerçek enforcement — approval_queue kaydı oluştur, job'ı 'waiting_approval' yap.
      // Worker throw etmez; kullanıcı portal'dan onay verince job tekrar 'pending' olur.
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
      if (gateErr) {
        log('gate_run_for_approval failed — falling back to error', { error: gateErr.message })
        throw new Error(`Approval gate failed: ${gateErr.message}`)
      }
      log('Job gated for approval', { id: job.id, risk: job.risk })
      return
    }

    const dotnetArgs = buildDotnetArgs(job)

    const agentsFile = await writeAgentsFile(supabase)
    if (agentsFile) {
      dotnetArgs.push('--agentsFile', agentsFile)
      log('Using agents file', { agentsFile })
    } else {
      log('No agents in DB; using built-in catalog')
    }

    if (Array.isArray(job.selected_agents) && job.selected_agents.length > 0) {
      dotnetArgs.push('--agents', job.selected_agents.join(','))
      log('Using selected agents', { selected_agents: job.selected_agents })
    }

    log('Running dotnet', { args: ['dotnet', ...dotnetArgs] })
    const started = Date.now()

    const { code, stdout, stderr } = await runCmd('dotnet', dotnetArgs, {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO: '1',
    }, repoRoot)
    
    // Log the full stdout for debugging
    log('Full dotnet stdout', { 
      stdoutLength: stdout.length,
      stdoutPreview: stdout.slice(0, 1000),
      lastLines: stdout.trim().split('\n').slice(-10).join('\n')
    })

    log('Dotnet finished', {
      code,
      duration_ms: Date.now() - started,
    })

    if (code !== 0) {
      throw new Error(`dotnet failed (${code})\n${stderr || stdout}`)
    }

    const runDir = extractRunDir(stdout)
    if (!runDir) {
      throw new Error('Could not detect runDir from dotnet output')
    }
    log('Importing outputs to Supabase', {
      runDir,
      exists: await fs.stat(runDir).then(() => true).catch(() => false),
      cwd: process.cwd(),
      absolutePath: path.resolve(runDir)
    })

    // Sector Discovery: scaffold adımının çıktısını domain_pack_drafts'a yaz
    const payload = (job.answers_json ?? {}) as Record<string, unknown>
    if (payload.playbookId === 'sector-discovery-and-scaffold') {
      await writeDomainPackDraft(supabase, job, runDir).catch((e) =>
        log('DomainPackDraft write failed (non-fatal)', { error: String(e) })
      )
    }

    const importRes = await importFromRunDir(job.owner_user_id, runDir)
    log('Import finished', importRes as unknown as Record<string, unknown>)

    // IP1.2: metrics.json oku → runs + run_requests tablolarına yaz
    const metrics = await readMetricsJson(runDir)
    const latencyMs = Date.now() - started

    if (metrics && importRes && typeof importRes === 'object' && 'runId' in importRes) {
      const runId = (importRes as { runId?: string }).runId
      if (runId) {
        await supabase
          .from('runs')
          .update({
            model:            metrics.model    ?? job.model,
            tokens_in:        metrics.tokens_in,
            tokens_out:       metrics.tokens_out,
            latency_ms:       metrics.latency_ms ?? latencyMs,
            cost_usd:         estimateCostUsd(metrics.model, metrics.tokens_in, metrics.tokens_out),
            verifier_outcome: metrics.verifier_outcome ?? null,
            domain_pack:      job.domain_pack,
            risk_level:       job.risk,
            finished_at:      new Date().toISOString(),
          })
          .eq('external_id', runId)
          .eq('owner_user_id', job.owner_user_id)
        log('Metrics written to runs', { runId, ...metrics })
      }
    }

    const totalMs    = Date.now() - jobCreatedAt
    const slaBreached = totalMs > SLA_THRESHOLD_MS
    if (slaBreached) {
      log('SLA breach', { id: job.id, total_ms: totalMs, threshold_ms: SLA_THRESHOLD_MS })
    }

    const updated = await supabase
      .from('run_requests')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
        sla_breach: slaBreached,
        result_json: {
          dotnet_stdout_tail: stdout.trim().split('\n').slice(-5).join('\n'),
          imported: importRes,
          metrics,
          sla: { total_ms: totalMs, queue_latency_ms: queueLatencyMs, sla_threshold_ms: SLA_THRESHOLD_MS },
        },
      })
      .eq('id', job.id)

    if (updated.error) throw updated.error
    log(`Job success`, { id: job.id, total_ms: totalMs, sla_breach: slaBreached })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const updated = await supabase
      .from('run_requests')
      .update({
        status: 'fail',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: msg.slice(0, 2000),
      })
      .eq('id', job.id)
    if (updated.error) {
      console.error('Failed to update job status', updated.error)
    }
    throw e
  }
}

// IP1.3: Her tick başında ölü worker'dan kalan stale job'ları temizle
async function cleanupStale() {
  const supabase = getSupabaseAdmin()
  const staleMinutes = Number.parseInt(process.env.WORKER_STALE_MINUTES ?? '35', 10)
  const { data, error } = await supabase.rpc('cleanup_stale_running_jobs', {
    stale_minutes: staleMinutes,
    max_attempts: 3,
  })
  if (error) {
    log('cleanup_stale_running_jobs error', { error: error.message })
    return
  }
  const cleaned = (data ?? []) as { job_id: string; new_status: string }[]
  if (cleaned.length > 0) {
    log('Stale jobs cleaned up', { count: cleaned.length, jobs: cleaned })
  }
}

export async function runOnce() {
  logEnvironment()

  // Stale job temizliği her tick başında çalışır
  await cleanupStale()

  const maxJobs = Number.parseInt(process.env.MAX_JOBS ?? '1', 10)
  const limit = Number.isFinite(maxJobs) && maxJobs > 0 ? maxJobs : 1

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
  runOnce().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
