/**
 * D4d — JWT owner-scoped usage API.
 */
import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { fetchUsageCurrent, fetchUsageSummary } from '../lib/usageSummary.js'

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

/** GET /api/usage/summary?months=6 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const months = typeof req.query.months === 'string' ? Number(req.query.months) : 6
    const body = await fetchUsageSummary(supabase, user.id, Number.isFinite(months) ? months : 6)
    return res.json(body)
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    console.error('[usage summary]', e)
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** GET /api/usage/current */
router.get('/current', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const body = await fetchUsageCurrent(supabase, user.id)
    return res.json(body)
  } catch (e) {
    const handled = authError(res, e as Error)
    if (handled) return handled
    console.error('[usage current]', e)
    return res.status(500).json({ error: (e as Error).message })
  }
})

export default router
