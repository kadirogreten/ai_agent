import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import {
  A2A_CARD_CACHE_CONTROL,
  loadAgentCard,
  publicCardBaseUrl,
} from '../lib/agentCard.js'

const router = Router()

function setCardHeaders(res: Response) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', A2A_CARD_CACHE_CONTROL)
}

async function serveCard(req: Request, res: Response) {
  try {
    const supabase = getSupabaseAdmin()
    const packId = typeof req.query.pack === 'string' ? req.query.pack : null
    const baseUrl = publicCardBaseUrl(
      req.get('x-forwarded-host') ?? req.get('host') ?? undefined,
      req.get('x-forwarded-proto') ?? undefined,
    )
    const result = await loadAgentCard(supabase, { packId, baseUrl })
    if ('status' in result) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(result.status).json({ error: result.error })
    }
    setCardHeaders(res)
    return res.status(200).json(result.card)
  } catch (e) {
    console.error('[a2a card]', e)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: (e as Error).message })
  }
}

/** GET /api/a2a/card?pack= */
router.get('/card', serveCard)

/** POST /api/a2a — invoke D4c'ye ertelendi */
router.post('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(501).json({
    error: 'D4c pending',
    message: 'Agent Card is discovery-only. Task invocation arrives with public API (D4c).',
  })
})

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    discovery: '/.well-known/agent-card.json',
    card: '/api/a2a/card',
    invoke: 'POST /api/a2a → 501 until D4c',
  })
})

/** Well-known handlers — app.ts root'a bağlanır */
export async function wellKnownAgentCard(req: Request, res: Response) {
  return serveCard(req, res)
}

export async function wellKnownAgentJsonAlias(req: Request, res: Response) {
  // Eski agent.json yolu → aynı payload (alias, 200; istemciler redirect takip etmeyebilir)
  return serveCard(req, res)
}

export default router
