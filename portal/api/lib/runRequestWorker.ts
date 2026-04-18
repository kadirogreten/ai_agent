import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { importLocalAgentArmy } from './localImporter.js'

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

function runCmd(command: string, args: string[], env: Record<string, string | undefined>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
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

async function main() {
  const supabase = getSupabaseAdmin()

  const claimed = await supabase.rpc('claim_run_request')
  if (claimed.error) {
    throw claimed.error
  }

  const job = claimed.data as RunRequest | null
  if (!job?.id) {
    console.log('No pending jobs')
    return
  }

  try {
    if ((job.risk === 'R2' || job.risk === 'R3') && !job.allow_high_risk) {
      throw new Error('High risk job requires allow_high_risk=true')
    }

    const repoRoot = path.resolve(process.cwd())
    const dotnetArgs = buildDotnetArgs(job)

    const { code, stdout, stderr } = await runCmd('dotnet', dotnetArgs, {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    })

    if (code !== 0) {
      throw new Error(`dotnet failed (${code})\n${stderr || stdout}`)
    }

    const importRes = await importLocalAgentArmy(job.owner_user_id, repoRoot)

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
  await main()
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  runOnce().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
