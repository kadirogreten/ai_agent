import { createHmac, randomBytes } from 'node:crypto'
import type { ISocialOAuthProvider, OAuthAppCredentials } from './types.js'
import { decryptToken, encryptToken } from '../../tokenEncryptor.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} eksik`)
  return v
}

function oauthStateSecret(): string {
  return process.env.SOCIAL_OAUTH_STATE_SECRET?.trim()
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 32)
    ?? 'dev-oauth-state-secret'
}

export function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig  = createHmac('sha256', oauthStateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyOAuthState(state: string): Record<string, unknown> | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', oauthStateSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    const exp = typeof json.exp === 'number' ? json.exp : 0
    if (Date.now() > exp) return null
    return json
  } catch {
    return null
  }
}

export class MetaOAuthProvider implements ISocialOAuthProvider {
  readonly slug = 'meta' as const
  readonly displayName = 'Meta (Facebook / Instagram)'

  buildAuthorizeUrl(state: string, extras?: Record<string, unknown> & { appConfig?: OAuthAppCredentials }): string {
    const cfg = extras?.appConfig
    const clientId    = cfg?.appId ?? requireEnv('META_APP_ID')
    const redirectUri = cfg?.redirectUri ?? requireEnv('META_OAUTH_REDIRECT_URI')
    const scopes = [
      'pages_manage_posts',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish',
      'ads_management',
    ].join(',')
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      state,
      scope:         scopes,
      response_type: 'code',
    })
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`
  }

  async exchangeCode(code: string, context?: { oauthState?: Record<string, unknown>; appConfig?: OAuthAppCredentials }) {
    const cfg = context?.appConfig
    const clientId     = cfg?.appId ?? requireEnv('META_APP_ID')
    const clientSecret = cfg?.appSecret ?? requireEnv('META_APP_SECRET')
    const redirectUri  = cfg?.redirectUri ?? requireEnv('META_OAUTH_REDIRECT_URI')

    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', clientId)
    tokenUrl.searchParams.set('client_secret', clientSecret)
    tokenUrl.searchParams.set('redirect_uri', redirectUri)
    tokenUrl.searchParams.set('code', code)

    const tokenRes = await fetch(tokenUrl)
    const tokenJson = await tokenRes.json() as {
      access_token?: string
      expires_in?: number
      error?: { message?: string }
    }
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error?.message ?? 'Meta token exchange başarısız')
    }

    let accessToken = tokenJson.access_token
    let expiresAt: Date | undefined
    if (tokenJson.expires_in) {
      expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000)
    }

    // Uzun ömürlü token
    const longUrl = new URL(`${GRAPH}/oauth/access_token`)
    longUrl.searchParams.set('grant_type', 'fb_exchange_token')
    longUrl.searchParams.set('client_id', clientId)
    longUrl.searchParams.set('client_secret', clientSecret)
    longUrl.searchParams.set('fb_exchange_token', accessToken)
    const longRes = await fetch(longUrl)
    const longJson = await longRes.json() as { access_token?: string; expires_in?: number }
    if (longRes.ok && longJson.access_token) {
      accessToken = longJson.access_token
      if (longJson.expires_in) {
        expiresAt = new Date(Date.now() + longJson.expires_in * 1000)
      }
    }

    const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`)
    const me = await meRes.json() as { id?: string; name?: string; error?: { message?: string } }
    if (!meRes.ok || !me.id) {
      throw new Error(me.error?.message ?? 'Meta /me başarısız')
    }

    return {
      accessToken,
      expiresAt,
      externalAccountId: me.id,
      scopes: [
        'pages_manage_posts',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
        'ads_management',
      ],
      metadata: { name: me.name ?? null },
    }
  }

  async refreshIfNeeded(row: {
    access_token_ciphertext: string
    refresh_token_ciphertext: string | null
    expires_at: string | null
  }, app?: OAuthAppCredentials) {
    if (!row.expires_at) return null
    const expires = new Date(row.expires_at).getTime()
    const soon = Date.now() + 7 * 24 * 60 * 60 * 1000
    if (expires > soon) return null

    const current = decryptToken(row.access_token_ciphertext)
    const clientId     = app?.appId ?? requireEnv('META_APP_ID')
    const clientSecret = app?.appSecret ?? requireEnv('META_APP_SECRET')

    const url = new URL(`${GRAPH}/oauth/access_token`)
    url.searchParams.set('grant_type', 'fb_exchange_token')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('client_secret', clientSecret)
    url.searchParams.set('fb_exchange_token', current)

    const res  = await fetch(url)
    const json = await res.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
    if (!res.ok || !json.access_token) {
      throw new Error(json.error?.message ?? 'Meta token yenileme başarısız')
    }

    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : undefined,
    }
  }
}

export { encryptToken, decryptToken }
