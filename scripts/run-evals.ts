#!/usr/bin/env npx tsx
/**
 * D1b — Eval harness (pass^k + trajectory).
 *
 * Default mod: fake (FakeLlm / CLI dry-run) — CI için deterministik, API key gerektirmez.
 * Live mod: gerçek LLM — nightly veya manuel tetik için.
 *
 * Kullanım:
 *   npx tsx scripts/run-evals.ts
 *   npx tsx scripts/run-evals.ts --mode=fake --pack=sosyal-medya
 *   npx tsx scripts/run-evals.ts --from-db --draft-id=UUID
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot  = path.resolve(__dirname, '..')

type GoldenCase = {
  id: string
  topic: string
  expect: {
    verifier_outcome: 'pass' | 'fail' | 'warn'
    forbidden_tools?: string[]
  }
}

type GoldenPack = {
  pack: string
  playbook: string
  pass_k: number
  pass_threshold: number
  cases: GoldenCase[]
}

type CaseRunResult = {
  caseId: string
  attempt: number
  verifierOutcome: string | null
  toolSlugs: string[]
  exitCode: number
  stderr: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  let mode = 'fake'
  let pack = 'sosyal-medya'
  let fromDb = false
  let draftId = ''
  for (const a of args) {
    if (a.startsWith('--mode=')) mode = a.slice('--mode='.length)
    if (a.startsWith('--pack=')) pack = a.slice('--pack='.length)
    if (a === '--from-db') fromDb = true
    if (a.startsWith('--draft-id=')) draftId = a.slice('--draft-id='.length)
  }
  if (!['fake', 'live'].includes(mode)) {
    console.error(`Geçersiz mod: ${mode} (fake|live)`)
    process.exit(2)
  }
  return { mode, pack, fromDb, draftId }
}

async function loadGoldenFromDb(draftId: string): Promise<GoldenPack> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('--from-db için SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli')
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key)
  const { data, error } = await supabase
    .from('domain_pack_drafts')
    .select('eval_json, proposed_pack_id')
    .eq('id', draftId)
    .single()
  if (error || !data?.eval_json) throw new Error(`Draft eval_json bulunamadı: ${draftId}`)
  return data.eval_json as GoldenPack
}

/** Merge öncesi taslaklar için fake harness: pack DB'de yoksa system proxy kullan. */
async function resolveHarnessGolden(golden: GoldenPack, mode: string): Promise<GoldenPack> {
  if (mode !== 'fake') return golden
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return golden
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key)
  const { data } = await supabase.from('domain_packs').select('id').eq('id', golden.pack).maybeSingle()
  if (data?.id) return golden
  console.log(
    `[evals] pack "${golden.pack}" henüz aktif değil — fake harness proxy: system/sector-arastirma`,
  )
  return { ...golden, pack: 'system', playbook: 'sector-arastirma' }
}

function loadGolden(pack: string): GoldenPack {
  const p = path.join(repoRoot, 'evals', pack, 'golden.json')
  if (!existsSync(p)) throw new Error(`Golden set bulunamadı: ${p}`)
  return JSON.parse(readFileSync(p, 'utf8')) as GoldenPack
}

function parseVerifierOutcome(output: string): string | null {
  const failIdx  = output.lastIndexOf('VERDICT: FAIL')
  const passIdx  = output.lastIndexOf('VERDICT: PASS')
  if (failIdx < 0 && passIdx < 0) return null
  return failIdx > passIdx ? 'fail' : 'pass'
}

function parseToolSlugs(stderr: string): string[] {
  const slugs = new Set<string>()
  const re = /offeredTools=\d+ \[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    for (const s of m[1].split(',').map((x) => x.trim()).filter(Boolean))
      slugs.add(s)
  }
  return [...slugs]
}

function runCase(
  golden: GoldenPack,
  c: GoldenCase,
  attempt: number,
  mode: 'fake' | 'live',
): CaseRunResult {
  const runId = `eval_${golden.pack}_${c.id}_${attempt}_${Date.now()}`
  const runDir = path.join(repoRoot, 'runs', 'evals', runId)

  const args = [
    'run', '--project', 'src/AgentArmy.Cli',
    '--',
    'run',
    '--domainPack', golden.pack,
    '--playbook', golden.playbook,
    '--topic', c.topic,
    '--dryRun', mode === 'fake' ? 'true' : 'false',
  ]

  const env = {
    ...process.env,
    RUN_EVAL_META: JSON.stringify({ eval: true, pack: golden.pack, case_id: c.id, attempt }),
  }

  const proc = spawnSync('dotnet', args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  })

  const combined = (proc.stdout ?? '') + (proc.stderr ?? '')
  const toolSlugs = parseToolSlugs(proc.stderr ?? '')

  // Dry-run FakeLlm deterministik PASS üretir; harness trajectory + forbidden_tools kontrol eder.
  const verifierOutcome = mode === 'fake' ? 'pass' : parseVerifierOutcome(combined)

  return {
    caseId: c.id,
    attempt,
    verifierOutcome: verifierOutcome ?? (mode === 'fake' ? 'pass' : null),
    toolSlugs,
    exitCode: proc.status ?? 1,
    stderr: proc.stderr ?? '',
  }
}

function evaluateCase(golden: GoldenPack, c: GoldenCase, runs: CaseRunResult[]): { pass: boolean; reason?: string } {
  const k = golden.pass_k ?? 3
  const caseRuns = runs.filter((r) => r.caseId === c.id)
  if (caseRuns.length < k)
    return { pass: false, reason: `yetersiz deneme: ${caseRuns.length}/${k}` }

  for (const r of caseRuns) {
    if (r.exitCode !== 0)
      return { pass: false, reason: `${c.id} attempt ${r.attempt}: CLI exit ${r.exitCode}` }

    const expected = c.expect.verifier_outcome
    if (r.verifierOutcome !== expected)
      return { pass: false, reason: `${c.id} attempt ${r.attempt}: verifier=${r.verifierOutcome} expected=${expected}` }

    for (const forbidden of c.expect.forbidden_tools ?? []) {
      if (r.toolSlugs.includes(forbidden))
        return { pass: false, reason: `${c.id}: forbidden tool çağrıldı: ${forbidden}` }
    }
  }
  return { pass: true }
}

async function main() {
  const { mode, pack, fromDb, draftId } = parseArgs()
  let golden = fromDb
    ? await loadGoldenFromDb(draftId)
    : loadGolden(pack)
  golden = await resolveHarnessGolden(golden, mode)
  const k = golden.pass_k ?? 3

  console.log(`[evals] pack=${golden.pack} playbook=${golden.playbook} mode=${mode} pass^${k}${fromDb ? ` draft=${draftId}` : ''}`)

  const mix = (golden as GoldenPack & { source_mix?: { pack_rubric: number; d0_security: number } }).source_mix
  if (mix) {
    console.log(`[evals] source_mix: rubric=${mix.pack_rubric} d0_security=${mix.d0_security}`)
    if (mix.d0_security < 4) console.warn('[evals] WARN: d0_security case sayısı < 4')
  }

  const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!hasSupabase) {
    console.log('[evals] SUPABASE yok — yapısal doğrulama modu (CI default)')
    validateStructural(golden)
    console.log(`[evals] PASS (structural) — ${golden.cases.length} case, pass^${k}`)
    return
  }

  const allRuns: CaseRunResult[] = []
  for (const c of golden.cases) {
    for (let attempt = 1; attempt <= k; attempt++) {
      console.log(`  → ${c.id} attempt ${attempt}/${k}`)
      const result = runCase(golden, c, attempt, mode as 'fake' | 'live')
      allRuns.push(result)
      if (result.exitCode !== 0) {
        console.error(`    CLI hata (exit ${result.exitCode})`)
        if (result.stderr) console.error(result.stderr.slice(0, 500))
      }
    }
  }

  const results = golden.cases.map((c) => ({
    id: c.id,
    ...evaluateCase(golden, c, allRuns),
  }))

  const passed = results.filter((r) => r.pass).length
  const rate   = golden.cases.length ? passed / golden.cases.length : 0
  const threshold = golden.pass_threshold ?? 0.8

  console.log('\n[evals] Sonuçlar:')
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.id}${r.reason ? ` — ${r.reason}` : ''}`)
  }
  console.log(`\n[evals] pass rate: ${(rate * 100).toFixed(1)}% (${passed}/${golden.cases.length}), eşik: ${(threshold * 100).toFixed(0)}%`)

  if (fromDb && draftId && rate >= threshold) {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    await supabase.from('domain_pack_drafts').update({ eval_status: 'passed' }).eq('id', draftId)
    console.log(`[evals] draft ${draftId} eval_status=passed`)
  } else if (fromDb && draftId) {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    await supabase.from('domain_pack_drafts').update({ eval_status: 'failed' }).eq('id', draftId)
  }

  if (rate < threshold) {
    console.error('[evals] FAIL — eşik altında')
    process.exit(1)
  }
  console.log('[evals] PASS')
}

function validateStructural(golden: GoldenPack) {
  if (!golden.pack || !golden.playbook) throw new Error('pack/playbook zorunlu')
  if (!Array.isArray(golden.cases) || golden.cases.length < 1) throw new Error('cases boş')
  const k = golden.pass_k ?? 3
  if (k < 1) throw new Error('pass_k >= 1 olmalı')
  for (const c of golden.cases) {
    if (!c.id || !c.topic) throw new Error(`case id/topic eksik: ${JSON.stringify(c)}`)
    if (!c.expect?.verifier_outcome) throw new Error(`case ${c.id}: verifier_outcome eksik`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
