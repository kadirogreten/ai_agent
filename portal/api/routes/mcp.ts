import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import {
  approveMcpServer,
  proposeMcpServer,
  rejectMcpServer,
  refreshRegistryCache,
  searchCachedRegistry,
  suggestMcpForMissingTools,
  type RegistryEntry,
} from '../lib/mcpRegistry.js'

const router = Router()

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error('Missing Authorization header')
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid token')
  return { supabase, user: data.user }
}

function authError(res: Response, err: Error) {
  if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
  if (err.message === 'Invalid token') return res.status(401).json({ error: err.message })
  return null
}

/** GET /api/mcp/registry/search?q=filesystem */
router.get('/registry/search', async (req: Request, res: Response) => {
  try {
    const { supabase } = await getAuthedUser(req)
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    if (!q.trim()) return res.status(400).json({ error: 'q zorunlu' })

    const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
    if (refresh) {
      try {
        await refreshRegistryCache(supabase, q)
      } catch (e) {
        console.warn('[mcp] registry refresh', (e as Error).message)
      }
    }

    const results = await searchCachedRegistry(supabase, q, { refreshIfStale: !refresh })
    return res.json({
      results: results.map((r) => ({
        ...r,
        bindable: typeof r.endpoint === 'string' && r.endpoint.startsWith('https://'),
      })),
    })
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    console.error('[mcp search]', err)
    return res.status(500).json({ error: err.message })
  }
})

/** POST /api/mcp/registry/refresh  body: { q?: string } */
router.post('/registry/refresh', async (req: Request, res: Response) => {
  try {
    const { supabase } = await getAuthedUser(req)
    const q = typeof req.body?.q === 'string' ? req.body.q : 'mcp'
    const out = await refreshRegistryCache(supabase, q)
    return res.json(out)
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(500).json({ error: err.message })
  }
})

/** POST /api/mcp/propose  body: RegistryEntry fields */
router.post('/propose', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const b = req.body as Partial<RegistryEntry>
    if (typeof b.slug !== 'string' || !b.slug.trim()) {
      return res.status(400).json({ error: 'slug zorunlu' })
    }
    const entry: Parameters<typeof proposeMcpServer>[2] = {
      slug: b.slug.trim(),
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : b.slug.trim(),
      description: typeof b.description === 'string' ? b.description : null,
      transport: (b.transport as RegistryEntry['transport']) ?? 'http',
      endpoint: typeof b.endpoint === 'string' ? b.endpoint : null,
      homepage: typeof b.homepage === 'string' ? b.homepage : null,
      auth_env_hint: typeof b.auth_env_hint === 'string' ? b.auth_env_hint : null,
      risk_hint: (b.risk_hint as RegistryEntry['risk_hint']) ?? 'R1',
    }
    const row = await proposeMcpServer(supabase, user.id, entry)
    return res.status(201).json(row)
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(400).json({ error: err.message })
  }
})

/** GET /api/mcp/servers?status=pending_approval */
router.get('/servers', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const status = typeof req.query.status === 'string' ? req.query.status : null
    let q = supabase
      .from('mcp_servers')
      .select('id, slug, display_name, transport, endpoint, auth_env, enabled, status, registry_slug, homepage, risk_hint, created_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw error
    return res.json({ servers: data ?? [] })
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(500).json({ error: err.message })
  }
})

/** POST /api/mcp/servers/:id/approve */
router.post('/servers/:id/approve', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const row = await approveMcpServer(supabase, user.id, req.params.id)
    return res.json({
      ...row,
      hint: 'Bağlantı aktif. Araç listesi için: dotnet run -- mcp-sync --server ' + row.slug,
    })
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(400).json({ error: err.message })
  }
})

/** POST /api/mcp/servers/:id/reject */
router.post('/servers/:id/reject', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    await rejectMcpServer(supabase, user.id, req.params.id)
    return res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(400).json({ error: err.message })
  }
})

/** POST /api/mcp/suggest-missing  body: { tools: string[] } */
router.post('/suggest-missing', async (req: Request, res: Response) => {
  try {
    const { supabase } = await getAuthedUser(req)
    const tools = Array.isArray(req.body?.tools)
      ? (req.body.tools as unknown[]).filter((t): t is string => typeof t === 'string')
      : []
    if (tools.length === 0) return res.status(400).json({ error: 'tools[] zorunlu' })
    const suggestions = await suggestMcpForMissingTools(supabase, tools)
    return res.json({ suggestions })
  } catch (e) {
    const err = e as Error
    const handled = authError(res, err)
    if (handled) return handled
    return res.status(500).json({ error: err.message })
  }
})

export default router
