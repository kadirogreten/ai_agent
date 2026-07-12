/**
 * D4c — JWT yönetim: API keys + webhook endpoints.
 */
import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createApiKey, listApiKeys, revokeApiKey } from '../lib/apiKeys.js'
import {
  assertSafeWebhookUrl,
  createWebhookEndpoint,
} from '../lib/webhookDispatcher.js'
import { getPolicy } from '../lib/policyReader.js'

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

/** GET /api/public-api/status — portal UI için enabled bayrağı */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const enabled = await getPolicy<boolean>(supabase, user.id, 'public_api.enabled', false)
    const rate = await getPolicy<number>(supabase, user.id, 'public_api.rate_limit_per_minute', 30)
    return res.json({ enabled, rate_limit_per_minute: rate })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** GET /api/public-api/keys */
router.get('/keys', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const keys = await listApiKeys(supabase, user.id)
    return res.json({ keys })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** POST /api/public-api/keys  { name, scopes } */
router.post('/keys', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const scopes = Array.isArray(req.body?.scopes)
      ? (req.body.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
      : ['operations:write', 'operations:read']

    const { row, plaintext } = await createApiKey(supabase, user.id, { name, scopes })
    return res.status(201).json({
      key: row,
      plaintext,
      warning: 'Düz metin anahtar yalnız bir kez gösterilir; kaydedin.',
    })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(400).json({ error: (e as Error).message })
  }
})

/** DELETE /api/public-api/keys/:id */
router.delete('/keys/:id', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const ok = await revokeApiKey(supabase, user.id, req.params.id)
    if (!ok) return res.status(404).json({ error: 'not_found' })
    return res.json({ ok: true })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** GET /api/public-api/webhooks */
router.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select('id, url, events, enabled, created_at, updated_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return res.json({ webhooks: data ?? [] })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** POST /api/public-api/webhooks  { url, events? } */
router.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    const events = Array.isArray(req.body?.events)
      ? (req.body.events as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined

    assertSafeWebhookUrl(url)
    const created = await createWebhookEndpoint(supabase, user.id, { url, events })
    return res.status(201).json({
      webhook: { id: created.id, url: created.url, events: created.events },
      secret: created.secret,
      warning: 'Webhook secret yalnız bir kez gösterilir; kaydedin.',
    })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(400).json({ error: (e as Error).message })
  }
})

/** DELETE /api/public-api/webhooks/:id */
router.delete('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_user_id', user.id)
      .select('id')
    if (error) throw error
    if (!data?.length) return res.status(404).json({ error: 'not_found' })
    return res.json({ ok: true })
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    return res.status(500).json({ error: (e as Error).message })
  }
})

export default router
