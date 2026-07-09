import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { encryptToken } from '../lib/tokenEncryptor.js'
import {
  getSocialProvider,
  listSocialProviders,
} from '../lib/social/providers/index.js'
import {
  signOAuthState,
  verifyOAuthState,
} from '../lib/social/providers/meta.js'

const router = Router({ mergeParams: true })

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

const SAFE_SELECT =
  'id,platform,external_account_id,scopes,status,expires_at,metadata,updated_at'

// GET /api/social/providers
router.get('/providers', async (_req: Request, res: Response) => {
  return res.status(200).json(listSocialProviders())
})

// GET /api/social/accounts — bağlı hesaplar (token yok)
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const { data, error } = await supabase
      .from('user_social_accounts')
      .select(SAFE_SELECT)
      .eq('owner_user_id', user.id)
      .order('platform')
    if (error) throw error
    return res.status(200).json(data ?? [])
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/social/:provider/oauth/start
router.get('/:provider/oauth/start', async (req: Request, res: Response) => {
  try {
    const { user } = await getAuthedUser(req)
    const provider = getSocialProvider(req.params.provider ?? '')
    if (!provider) return res.status(404).json({ error: 'Bilinmeyen platform' })

    const extras = provider.createOAuthExtras?.() ?? {}
    const state = signOAuthState({
      userId:   user.id,
      provider: provider.slug,
      nonce:    cryptoRandom(),
      exp:      Date.now() + 15 * 60 * 1000,
      ...extras,
    })

    const authorizeUrl = provider.buildAuthorizeUrl(state, extras)
    return res.status(200).json({ authorizeUrl })
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/social/:provider/oauth/callback — Meta redirect (auth header yok)
router.get('/:provider/oauth/callback', async (req: Request, res: Response) => {
  const portalBase = process.env.PORTAL_PUBLIC_URL?.replace(/\/$/, '') ?? 'http://localhost:5173'
  const redirectFail = `${portalBase}/app/social-accounts?oauth=error`

  try {
    const provider = getSocialProvider(req.params.provider ?? '')
    if (!provider) {
      res.redirect(redirectFail)
      return
    }

    const code  = typeof req.query.code === 'string' ? req.query.code : null
    const state = typeof req.query.state === 'string' ? req.query.state : null
    if (!code || !state) {
      res.redirect(redirectFail)
      return
    }

    const payload = verifyOAuthState(state)
    if (!payload || payload.provider !== provider.slug || typeof payload.userId !== 'string') {
      res.redirect(redirectFail)
      return
    }

    const exchanged = await provider.exchangeCode(code, { oauthState: payload })
    const supabase  = getSupabaseAdmin()

    const row = {
      owner_user_id:            payload.userId,
      platform:                 provider.slug,
      external_account_id:      exchanged.externalAccountId,
      scopes:                   exchanged.scopes,
      access_token_ciphertext:  encryptToken(exchanged.accessToken),
      refresh_token_ciphertext: exchanged.refreshToken
        ? encryptToken(exchanged.refreshToken)
        : null,
      expires_at:               exchanged.expiresAt?.toISOString() ?? null,
      status:                   'active' as const,
      metadata:                 exchanged.metadata ?? {},
      updated_at:               new Date().toISOString(),
    }

    const { error } = await supabase
      .from('user_social_accounts')
      .upsert(row, { onConflict: 'owner_user_id,platform,external_account_id' })

    if (error) throw error

    res.redirect(`${portalBase}/app/social-accounts?oauth=success&platform=${provider.slug}`)
  } catch {
    res.redirect(redirectFail)
  }
})

// POST /api/social/:provider/disconnect
router.post('/:provider/disconnect', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const provider = getSocialProvider(req.params.provider ?? '')
    if (!provider) return res.status(404).json({ error: 'Bilinmeyen platform' })

    const { error } = await supabase
      .from('user_social_accounts')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('owner_user_id', user.id)
      .eq('platform', provider.slug)
      .eq('status', 'active')

    if (error) throw error
    return res.status(200).json({ ok: true })
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

function cryptoRandom(): string {
  return randomBytes(16).toString('hex')
}

export default router
