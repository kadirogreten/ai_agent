import fs from 'fs/promises'
import path from 'path'
import { getSupabaseAdmin } from './supabaseAdmin.js'

type ImportResult = {
  runs: number
  bundles: number
  facts: number
}

type BundleManifestRun = {
  playbook?: string
  dir?: string
}

type BundleManifest = {
  id?: string
  title?: string
  domainPack?: string
  model?: string
  web?: boolean
  topic?: string
  createdAt?: string
  runs?: BundleManifestRun[]
}

type MinimalImportResult = ImportResult & {
  importedRunDirs?: string[]
}

type CeoRun = {
  mode?: string
  id?: string
  dir?: string
}

type CeoManifest = {
  domainPack?: string
  request?: string
  answers?: string
  model?: string
  dryRun?: boolean
  createdAt?: string
  runs?: CeoRun[]
}

type FactJson = {
  Id?: string
  Topic?: string
  Claim?: string
  EvidenceUrl?: string
  EvidenceQuote?: string
  SourceTitle?: string
  SourceDomain?: string
  Confidence?: number
}

async function readTextIfExists(p: string) {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}

async function readJsonIfExists<T>(p: string) {
  try {
    const txt = await fs.readFile(p, 'utf8')
    return JSON.parse(txt) as T
  } catch {
    return null
  }
}

async function listDirDirs(p: string) {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function existsDir(p: string) {
  try {
    const st = await fs.stat(p)
    return st.isDirectory()
  } catch {
    return false
  }
}

async function findBestOutputText(runDir: string) {
  const candidates = [
    'edit.Editor.md',
    'write.revised.Writer.md',
    'write.Writer.md',
    'work.md',
    'verify.Verifier.md',
    'analysis.Analyst.md',
  ]
  for (const f of candidates) {
    const t = await readTextIfExists(path.join(runDir, f))
    if (t && t.trim()) return t
  }
  return null
}

async function importPlaybookRun(ownerUserId: string, externalId: string, playbook: string, runDir: string, createdAt: string | null, sourceBundleId: string | null) {
  const outputText = await findBestOutputText(runDir)
  const playbookRunId = await upsertByExternalId('runs', ownerUserId, externalId, {
    title: playbook,
    status: outputText ? 'success' : 'fail',
    started_at: createdAt,
    finished_at: createdAt,
    error_message: outputText ? null : 'Missing output',
    output_text: outputText,
    created_at: createdAt ?? new Date().toISOString(),
  })

  let factsCount = 0
  const facts = await readJsonIfExists<FactJson[]>(path.join(runDir, 'facts.json'))
  if (!facts || !Array.isArray(facts)) return { runId: playbookRunId, factsCount: 0 }

  const supabase = getSupabaseAdmin()
  for (const f of facts) {
    const externalFactId = typeof f.Id === 'string' ? f.Id : null
    const claim = typeof f.Claim === 'string' ? f.Claim : null
    const url = typeof f.EvidenceUrl === 'string' ? f.EvidenceUrl : null
    const quote = typeof f.EvidenceQuote === 'string' ? f.EvidenceQuote : null
    const domain = typeof f.SourceDomain === 'string' ? f.SourceDomain : null
    const confidence = typeof f.Confidence === 'number' ? f.Confidence : null
    if (!claim) continue

    const md = [
      claim.trim(),
      '',
      url ? `Kaynak: ${url}` : null,
      quote ? `Alıntı: ${quote}` : null,
    ].filter(Boolean).join('\n')

    const title = claim.length > 120 ? claim.slice(0, 117) + '...' : claim
    const tags = [domain].filter(Boolean).join(',') || null
    const state = confidence !== null && confidence >= 0.9 ? 'verified' : 'draft'

    if (externalFactId) {
      const exists = await supabase
        .from('knowledge_facts')
        .select('id')
        .eq('owner_user_id', ownerUserId)
        .eq('external_id', externalFactId)
        .limit(1)
        .maybeSingle()
      if (exists.error) throw exists.error
      if (exists.data?.id) continue
    }

    const inserted = await supabase.from('knowledge_facts').insert({
      owner_user_id: ownerUserId,
      external_id: externalFactId,
      title,
      content: md,
      tags,
      state,
      source_type: 'run',
      source_run_id: playbookRunId,
      source_bundle_id: sourceBundleId,
      confidence,
    })
    if (inserted.error) throw inserted.error
    factsCount++
  }

  return { runId: playbookRunId, factsCount }
}

async function upsertByExternalId(table: string, ownerUserId: string, externalId: string, row: Record<string, unknown>) {
  const supabase = getSupabaseAdmin()
  const existing = await supabase
    .from(table)
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('external_id', externalId)
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  if (existing.data?.id) {
    const updated = await supabase
      .from(table)
      .update(row)
      .eq('id', existing.data.id)
      .select('id')
      .single()
    if (updated.error) throw updated.error
    return updated.data.id as string
  }

  const inserted = await supabase
    .from(table)
    .insert({ ...row, owner_user_id: ownerUserId, external_id: externalId })
    .select('id')
    .single()
  if (inserted.error) throw inserted.error
  return inserted.data.id as string
}

export async function importLocalAgentArmy(ownerUserId: string, rootDir?: string): Promise<ImportResult> {
  const resolvedRoot = rootDir && rootDir.trim() ? rootDir.trim() : process.env.LOCAL_AGENTARMY_ROOT
  const base = resolvedRoot && resolvedRoot.trim() ? resolvedRoot.trim() : path.resolve(process.cwd(), '..')
  const bundlesRoot = path.join(base, 'runs', 'bundles')
  const ceoRoot = path.join(base, 'runs', 'ceo')

  console.log('[import] base', base)
  console.log('[import] bundlesRoot exists', await existsDir(bundlesRoot), bundlesRoot)
  console.log('[import] ceoRoot exists', await existsDir(ceoRoot), ceoRoot)

  let runsCount = 0
  let bundlesCount = 0
  let factsCount = 0

  const bundleDirs = await listDirDirs(bundlesRoot)
  console.log('[import] bundleDirs', bundleDirs.length, bundleDirs.slice(0, 5))
  for (const dirName of bundleDirs) {
    const bundleDir = path.join(bundlesRoot, dirName)
    const bundleJson = await readJsonIfExists<BundleManifest>(path.join(bundleDir, 'bundle.json'))
    if (!bundleJson) continue

    const createdAt = typeof bundleJson.createdAt === 'string' ? bundleJson.createdAt : null
    const bundleRunExternalId = `bundle:${dirName}`
    const bundleRunId = await upsertByExternalId('runs', ownerUserId, bundleRunExternalId, {
      title: bundleJson.title ?? bundleJson.id ?? 'bundle',
      status: 'success',
      started_at: createdAt,
      finished_at: createdAt,
      error_message: null,
      output_text: null,
      created_at: createdAt ?? new Date().toISOString(),
    })
    runsCount++

    const bundleId = await upsertByExternalId('bundles', ownerUserId, dirName, {
      run_id: bundleRunId,
      name: bundleJson.title ?? bundleJson.id ?? dirName,
      tags: bundleJson.domainPack ?? null,
      payload_json: bundleJson,
      created_at: createdAt ?? new Date().toISOString(),
    })
    bundlesCount++

    const runs = Array.isArray(bundleJson.runs) ? bundleJson.runs : []
    for (const r of runs) {
      const playbook = typeof r.playbook === 'string' ? r.playbook : null
      const runDir = typeof r.dir === 'string' ? r.dir : null
      if (!playbook || !runDir) continue

      const externalId = `${dirName}:${playbook}`
      const imported = await importPlaybookRun(ownerUserId, externalId, playbook, runDir, createdAt, bundleId)
      runsCount++
      factsCount += imported.factsCount
    }
  }

  const ceoDirs = await listDirDirs(ceoRoot)
  console.log('[import] ceoDirs', ceoDirs.length, ceoDirs.slice(0, 5))
  for (const dirName of ceoDirs) {
    const ceoDir = path.join(ceoRoot, dirName)
    const ceoPath = path.join(ceoDir, 'ceo.json')
    const hasCeoJson = await readTextIfExists(ceoPath)
    console.log('[import] ceo dir', dirName, 'has ceo.json', !!hasCeoJson)
    const ceoJson = await readJsonIfExists<CeoManifest>(path.join(ceoDir, 'ceo.json'))
    if (!ceoJson) continue

    const createdAt = typeof ceoJson.createdAt === 'string' ? ceoJson.createdAt : null

    const ceoExternalId = `ceo:${dirName}`
    const requestText = typeof ceoJson.request === 'string' ? ceoJson.request : 'ceo'
    const questionsMd = await readTextIfExists(path.join(ceoDir, 'questions.md'))
    const planJson = await readJsonIfExists<Record<string, unknown>>(path.join(ceoDir, 'plan.json'))
    const ceoOutputText = [
      requestText,
      '',
      questionsMd?.trim() ? questionsMd.trim() : null,
      planJson ? `Plan: ${JSON.stringify(planJson)}` : null,
    ].filter(Boolean).join('\n')

    await upsertByExternalId('runs', ownerUserId, ceoExternalId, {
      title: `ceo: ${requestText.length > 80 ? requestText.slice(0, 77) + '...' : requestText}`,
      status: 'success',
      started_at: createdAt,
      finished_at: createdAt,
      error_message: null,
      output_text: ceoOutputText || null,
      created_at: createdAt ?? new Date().toISOString(),
    })
    runsCount++

    const runs = Array.isArray(ceoJson.runs) ? ceoJson.runs : []
    for (const r of runs) {
      const mode = typeof r.mode === 'string' ? r.mode : null
      const id = typeof r.id === 'string' ? r.id : null
      const runDir = typeof r.dir === 'string' ? r.dir : null
      if (!mode || !id || !runDir) continue
      if (mode.toLowerCase() === 'bundle') continue

      const externalId = `ceo:${dirName}:${id}`
      const imported = await importPlaybookRun(ownerUserId, externalId, id, runDir, createdAt, null)
      runsCount++
      factsCount += imported.factsCount
    }
  }

  return { runs: runsCount, bundles: bundlesCount, facts: factsCount }
}

async function importBundleDir(ownerUserId: string, bundleDir: string): Promise<ImportResult> {
  console.log('[importBundleDir] Starting import for bundle directory:', bundleDir)
  
  const bundleJsonPath = path.join(bundleDir, 'bundle.json')
  console.log('[importBundleDir] Reading bundle.json from:', bundleJsonPath)
  
  let bundleJson: BundleManifest | null = null
  try {
    bundleJson = await readJsonIfExists<BundleManifest>(bundleJsonPath)
    console.log('[importBundleDir] bundle.json parsed successfully:', !!bundleJson)
    if (bundleJson) {
      console.log('[importBundleDir] bundleJson keys:', Object.keys(bundleJson))
      console.log('[importBundleDir] bundleJson.title:', bundleJson.title)
      console.log('[importBundleDir] bundleJson.id:', bundleJson.id)
      console.log('[importBundleDir] bundleJson.createdAt:', bundleJson.createdAt)
      console.log('[importBundleDir] bundleJson.runs count:', Array.isArray(bundleJson.runs) ? bundleJson.runs.length : 'not an array')
    }
  } catch (parseError) {
    console.error('[importBundleDir] Error parsing bundle.json:', parseError)
    const rawContent = await readTextIfExists(bundleJsonPath)
    console.log('[importBundleDir] Raw bundle.json content:', rawContent)
  }
  
  if (!bundleJson) {
    console.log('[importBundleDir] No valid bundle.json found, returning 0 results')
    return { runs: 0, bundles: 0, facts: 0 }
  }

  const dirName = path.basename(bundleDir)
  const createdAt = typeof bundleJson.createdAt === 'string' ? bundleJson.createdAt : null

  const bundleRunExternalId = `bundle:${dirName}`
  console.log('[importBundleDir] Upserting bundle run with externalId:', bundleRunExternalId)
  
  const bundleRunId = await upsertByExternalId('runs', ownerUserId, bundleRunExternalId, {
    title: bundleJson.title ?? bundleJson.id ?? 'bundle',
    status: 'success',
    started_at: createdAt,
    finished_at: createdAt,
    error_message: null,
    output_text: null,
    created_at: createdAt ?? new Date().toISOString(),
  })

  const bundleId = await upsertByExternalId('bundles', ownerUserId, dirName, {
    run_id: bundleRunId,
    name: bundleJson.title ?? bundleJson.id ?? dirName,
    tags: bundleJson.domainPack ?? null,
    payload_json: bundleJson,
    created_at: createdAt ?? new Date().toISOString(),
  })

  let runsCount = 1
  const bundlesCount = 1
  let factsCount = 0

  const runs = Array.isArray(bundleJson.runs) ? bundleJson.runs : []
  console.log('[importBundleDir] Processing runs, count:', runs.length)
  
  for (const r of runs) {
    console.log('[importBundleDir] Processing run:', r)
    const playbook = typeof r.playbook === 'string' ? r.playbook : null
    const runDir = typeof r.dir === 'string' ? r.dir : null
    console.log('[importBundleDir] Run details - playbook:', playbook, 'runDir:', runDir)
    
    if (!playbook || !runDir) {
      console.log('[importBundleDir] Skipping run due to missing fields')
      continue
    }
    
    console.log('[importBundleDir] Importing playbook run')
    const externalId = `${dirName}:${playbook}`
    const imported = await importPlaybookRun(ownerUserId, externalId, playbook, runDir, createdAt, bundleId)
    runsCount++
    factsCount += imported.factsCount
  }

  console.log('[importBundleDir] Final results - runs:', runsCount, 'bundles:', bundlesCount, 'facts:', factsCount)
  return { runs: runsCount, bundles: bundlesCount, facts: factsCount }
}

async function importCeoDir(ownerUserId: string, ceoDir: string): Promise<ImportResult> {
  const dirName = path.basename(ceoDir)
  console.log('[importCeoDir] Starting import for CEO directory:', dirName)
  console.log('[importCeoDir] Full path:', ceoDir)
  
  const ceoJsonPath = path.join(ceoDir, 'ceo.json')
  console.log('[importCeoDir] Reading ceo.json from:', ceoJsonPath)
  
  let ceoJson: CeoManifest | null = null
  try {
    ceoJson = await readJsonIfExists<CeoManifest>(ceoJsonPath)
    console.log('[importCeoDir] ceo.json parsed successfully:', !!ceoJson)
    if (ceoJson) {
      console.log('[importCeoDir] ceoJson keys:', Object.keys(ceoJson))
      console.log('[importCeoDir] ceoJson.request:', ceoJson.request)
      console.log('[importCeoDir] ceoJson.createdAt:', ceoJson.createdAt)
      console.log('[importCeoDir] ceoJson.runs count:', Array.isArray(ceoJson.runs) ? ceoJson.runs.length : 'not an array')
    }
  } catch (parseError) {
    console.error('[importCeoDir] Error parsing ceo.json:', parseError)
    const rawContent = await readTextIfExists(ceoJsonPath)
    console.log('[importCeoDir] Raw ceo.json content:', rawContent)
  }
  
  if (!ceoJson) {
    console.log('[importCeoDir] No valid ceo.json found, returning 0 results')
    return { runs: 0, bundles: 0, facts: 0 }
  }

  const createdAt = typeof ceoJson.createdAt === 'string' ? ceoJson.createdAt : null
  const requestText = typeof ceoJson.request === 'string' ? ceoJson.request : 'ceo'
  const questionsMd = await readTextIfExists(path.join(ceoDir, 'questions.md'))
  const planJson = await readJsonIfExists<Record<string, unknown>>(path.join(ceoDir, 'plan.json'))
  
  console.log('[importCeoDir] questions.md exists:', !!questionsMd)
  console.log('[importCeoDir] plan.json exists:', !!planJson)
  
  const ceoOutputText = [
    requestText,
    '',
    questionsMd?.trim() ? questionsMd.trim() : null,
    planJson ? `Plan: ${JSON.stringify(planJson)}` : null,
  ].filter(Boolean).join('\n')

  console.log('[importCeoDir] Upserting CEO run with title:', `ceo: ${requestText.length > 80 ? requestText.slice(0, 77) + '...' : requestText}`)
  
  await upsertByExternalId('runs', ownerUserId, `ceo:${dirName}`, {
    title: `ceo: ${requestText.length > 80 ? requestText.slice(0, 77) + '...' : requestText}`,
    status: 'success',
    started_at: createdAt,
    finished_at: createdAt,
    error_message: null,
    output_text: ceoOutputText || null,
    created_at: createdAt ?? new Date().toISOString(),
  })

  let runsCount = 1
  let bundlesCount = 0
  let factsCount = 0

  const runs = Array.isArray(ceoJson.runs) ? ceoJson.runs : []
  console.log('[importCeoDir] Processing runs, count:', runs.length)
  
  for (const r of runs) {
    console.log('[importCeoDir] Processing run:', r)
    const mode = typeof r.mode === 'string' ? r.mode : null
    const id = typeof r.id === 'string' ? r.id : null
    const runDir = typeof r.dir === 'string' ? r.dir : null
    console.log('[importCeoDir] Run details - mode:', mode, 'id:', id, 'runDir:', runDir)
    
    if (!mode || !id || !runDir) {
      console.log('[importCeoDir] Skipping run due to missing fields')
      continue
    }

    if (mode.toLowerCase() === 'bundle') {
      console.log('[importCeoDir] Processing bundle run')
      const res = await importBundleDir(ownerUserId, runDir)
      runsCount += res.runs
      bundlesCount += res.bundles
      factsCount += res.facts
      continue
    }

    console.log('[importCeoDir] Processing playbook run')
    const externalId = `ceo:${dirName}:${id}`
    const imported = await importPlaybookRun(ownerUserId, externalId, id, runDir, createdAt, null)
    runsCount++
    factsCount += imported.factsCount
  }

  console.log('[importCeoDir] Final results - runs:', runsCount, 'bundles:', bundlesCount, 'facts:', factsCount)
  return { runs: runsCount, bundles: bundlesCount, facts: factsCount }
}

export async function importFromRunDir(ownerUserId: string, runDir: string): Promise<MinimalImportResult> {
  console.log('[importFromRunDir] Starting import with runDir:', runDir)
  console.log('[importFromRunDir] Current working directory:', process.cwd())
  console.log('[importFromRunDir] Path exists check:', await fs.stat(runDir).then(() => true).catch(() => false))
  
  const normalized = runDir.trim()
  if (!normalized) {
    console.log('[importFromRunDir] Empty runDir, returning 0 results')
    return { runs: 0, bundles: 0, facts: 0, importedRunDirs: [] }
  }

  console.log('[importFromRunDir] Normalized path:', normalized)
  
  if (normalized.includes('/runs/ceo/')) {
    console.log('[importFromRunDir] Detected CEO run, calling importCeoDir')
    const res = await importCeoDir(ownerUserId, normalized)
    console.log('[importFromRunDir] importCeoDir result:', res)
    return { ...res, importedRunDirs: [normalized] }
  }

  if (normalized.includes('/runs/bundles/')) {
    console.log('[importFromRunDir] Detected bundle run, calling importBundleDir')
    const res = await importBundleDir(ownerUserId, normalized)
    console.log('[importFromRunDir] importBundleDir result:', res)
    return { ...res, importedRunDirs: [normalized] }
  }

  console.log('[importFromRunDir] Unknown run type, returning 0 results')
  return { runs: 0, bundles: 0, facts: 0, importedRunDirs: [normalized] }
}
