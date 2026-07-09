import { Router, type Request, type Response } from 'express'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { manifestChecksum } from '../lib/evalGenerator.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(__dirname, '../../../schemas/pack-manifest-v1.json')

function getBearerToken(req: Request) {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/.exec(h)
  return m?.[1] ?? null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error('Missing Authorization header')
  const supabase = getSupabaseAdmin()
  const user = await supabase.auth.getUser(token)
  if (user.error || !user.data.user) throw new Error('Invalid token')
  return { supabase, user: user.data.user }
}

function buildManifestFromDraft(draft: {
  draft_json: Record<string, unknown>
  eval_json?: unknown
  proposed_pack_id?: string | null
  proposed_name?: string | null
}) {
  const dj = draft.draft_json
  const manifest = {
    manifest_version: 'pack-manifest-v1' as const,
    pack: {
      id: draft.proposed_pack_id ?? (typeof dj.id === 'string' ? dj.id : 'unknown'),
      name: draft.proposed_name ?? (typeof dj.name === 'string' ? dj.name : 'Unknown'),
      description: typeof dj.description === 'string' ? dj.description : undefined,
      allowed_domains: Array.isArray(dj.allowed_domains) ? dj.allowed_domains : [],
      glossary_md: typeof dj.glossary_md === 'string' ? dj.glossary_md : undefined,
      regulatory_notes_md: typeof dj.regulatory_notes_md === 'string' ? dj.regulatory_notes_md : undefined,
      verifier_rubric_md: typeof dj.verifier_rubric_md === 'string' ? dj.verifier_rubric_md : undefined,
    },
    personas: Array.isArray(dj.personas) ? dj.personas : [],
    playbooks: Array.isArray(dj.playbooks) ? dj.playbooks : [],
    bundles: Array.isArray(dj.bundles) ? dj.bundles : [],
    eval_json: draft.eval_json ?? undefined,
    created_at: new Date().toISOString(),
  }
  return { ...manifest, checksum: manifestChecksum(manifest as unknown as Record<string, unknown>) }
}

function validateManifest(body: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Manifest bir JSON nesnesi olmalı' }
  }
  const m = body as Record<string, unknown>
  if (m.manifest_version !== 'pack-manifest-v1') {
    return { ok: false, error: 'manifest_version pack-manifest-v1 olmalı' }
  }
  const pack = m.pack
  if (!pack || typeof pack !== 'object') return { ok: false, error: 'pack zorunlu' }
  const p = pack as Record<string, unknown>
  if (typeof p.id !== 'string' || !p.id.trim()) return { ok: false, error: 'pack.id zorunlu' }
  if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'pack.name zorunlu' }
  return { ok: true, data: m }
}

// GET /api/packs/drafts/:id/export
router.get('/drafts/:id/export', async (req: Request, res: Response) => {
  try {
    await getAuthedUser(req)
    const supabase = getSupabaseAdmin()
    const { data: draft, error } = await supabase
      .from('domain_pack_drafts')
      .select('draft_json, eval_json, proposed_pack_id, proposed_name')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!draft) return res.status(404).json({ error: 'Taslak bulunamadı' })

    return res.json(buildManifestFromDraft(draft))
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// GET /api/packs/:id/export
router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { supabase } = await getAuthedUser(req)
    const packId = req.params.id

    const { data: pack, error } = await supabase
      .from('domain_packs')
      .select('*')
      .eq('id', packId)
      .maybeSingle()

    if (error) throw error
    if (!pack) return res.status(404).json({ error: 'Pack bulunamadı' })

    const { data: playbooks } = await supabase.from('playbooks').select('content_json').eq('pack_id', packId)
    const { data: personas }  = await supabase.from('personas').select('content_md,slug,name,role_description,system_prompt,behaviors,risk_ceiling,cost_class').eq('pack_id', packId)
    const { data: bundles }   = await supabase.from('playbook_bundles').select('content_json').eq('pack_id', packId)

    const manifest = {
      manifest_version: 'pack-manifest-v1',
      pack: {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        allowed_domains: pack.allowed_domains ?? [],
        glossary_md: pack.glossary_md,
        regulatory_notes_md: pack.regulatory_notes_md,
        verifier_rubric_md: pack.verifier_rubric_md,
      },
      personas: personas ?? [],
      playbooks: (playbooks ?? []).map((r) => r.content_json).filter(Boolean),
      bundles: (bundles ?? []).map((r) => r.content_json).filter(Boolean),
      created_at: new Date().toISOString(),
    }
    const out = { ...manifest, checksum: manifestChecksum(manifest as unknown as Record<string, unknown>) }
    return res.json(out)
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// POST /api/packs/import
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const validated = validateManifest(req.body)
    if (validated.ok !== true) {
      return res.status(400).json({ error: validated.error, schema: readFileSync(schemaPath, 'utf8') })
    }

    const m = validated.data
    const pack = m.pack as Record<string, unknown>
    const draftJson = {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      allowed_domains: pack.allowed_domains ?? [],
      glossary_md: pack.glossary_md,
      regulatory_notes_md: pack.regulatory_notes_md,
      verifier_rubric_md: pack.verifier_rubric_md,
      personas: m.personas ?? [],
      playbooks: m.playbooks ?? [],
      bundles: m.bundles ?? [],
    }

    const { data, error } = await supabase
      .from('domain_pack_drafts')
      .insert({
        tenant_id: user.id,
        sector_prompt: `import:${pack.id}`,
        proposed_pack_id: String(pack.id),
        proposed_name: String(pack.name),
        status: 'pending',
        draft_json: draftJson,
        eval_json: m.eval_json ?? null,
        eval_status: m.eval_json ? 'pending' : 'skipped',
      })
      .select('id')
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, draftId: data.id })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

export default router
