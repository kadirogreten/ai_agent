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
  model: string | null
  web: boolean
  contrarian: boolean
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
}

type DbAgent = {
  id: string
  name: string
  code: string
  description: string | null
  capabilities: string[]
}

async function writeAgentsFile(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const res = await supabase
    .from('agents')
    .select('id,name,code,description,capabilities')
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
    })),
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentarmy-agents-'))
  const filePath = path.join(dir, 'agents.json')
  await fs.writeFile(filePath, JSON.stringify(payload), 'utf-8')
  return filePath
}

function runCmd(command: string, args: string[], env: Record<string, string | undefined>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

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

    child.on('error', reject)
    child.on('close', (code) => {
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
  const base = ['run', '--project', 'src/AgentArmy.Cli', '--']

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
  try {
    log('Claimed job', {
      id: job.id,
      mode: job.mode,
      domain_pack: job.domain_pack,
      model: job.model,
      web: job.web,
      contrarian: job.contrarian,
      risk: job.risk,
    })

    if ((job.risk === 'R2' || job.risk === 'R3') && !job.allow_high_risk) {
      throw new Error('High risk job requires allow_high_risk=true')
    }

    const dotnetArgs = buildDotnetArgs(job)

    const agentsFile = await writeAgentsFile(supabase)
    if (agentsFile) {
      dotnetArgs.push('--agentsFile', agentsFile)
      log('Using agents file', { agentsFile })
    } else {
      log('No agents in DB; using built-in catalog')
    }

    log('Running dotnet', { args: ['dotnet', ...dotnetArgs] })
    const started = Date.now()

    const { code, stdout, stderr } = await runCmd('dotnet', dotnetArgs, {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO: '1',
    })
    
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
    const importRes = await importFromRunDir(job.owner_user_id, runDir)
    log('Import finished', importRes as unknown as Record<string, unknown>)

    const updated = await supabase
      .from('run_requests')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
        result_json: {
          dotnet_stdout_tail: stdout.trim().split('\n').slice(-5).join('\n'),
          imported: importRes,
        },
      })
      .eq('id', job.id)

    if (updated.error) throw updated.error
    console.log(`Job ${job.id} success`, importRes)
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

export async function runOnce() {
  logEnvironment()
  
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
