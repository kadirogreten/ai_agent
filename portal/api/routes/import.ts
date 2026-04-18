import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { importLocalAgentArmy } from '../lib/localImporter.js'

const router = Router()

function getBearerToken(req: Request) {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/.exec(h)
  return m?.[1] ?? null
}

router.post('/local', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req)
    if (!token) {
      res.status(401).json({ success: false, error: 'Missing Authorization header' })
      return
    }

    const supabase = getSupabaseAdmin()
    const user = await supabase.auth.getUser(token)
    if (user.error || !user.data.user) {
      res.status(401).json({ success: false, error: 'Invalid token' })
      return
    }

    const rootDir = typeof req.body?.rootDir === 'string' ? req.body.rootDir : undefined
    const result = await importLocalAgentArmy(user.data.user.id, rootDir)
    res.status(200).json({ success: true, result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Import failed'
    res.status(500).json({ success: false, error: message })
  }
})

export default router
