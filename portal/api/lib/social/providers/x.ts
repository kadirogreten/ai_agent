import { createHash, randomBytes } from 'node:crypto'
import type { ISocialOAuthProvider } from './types.js'
import { defaultRedirectUri } from '../oauthApps.js'

const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize'
const API_BASE = 'https://api.twitter.com/2'

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ')

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} eksik`)
  return v
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export class XOAuthProvider implements ISocialOAuthProvider {
  readonly slug = 'x' as const
  readonly displayName = 'X (Twitter)'

  createOAuthExtras(): Record<string, unknown> {
    const codeVerifier = randomBytes(32).toString('base64url')
    return {
      codeVerifier,
      codeChallenge: pkceChallenge(codeVerifier),
    }
  }

  buildAuthorizeUrl(state: string, extras?: Record<string, unknown>): string {
    const clientId    = requireEnv('X_APP_ID')
    const redirectUri = process.env.X_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('x')
    const challenge   = typeof extras?.codeChallenge === 'string'
      ? extras.codeChallenge
      : pkceChallenge(randomBytes(32).toString('base64url'))

    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             clientId,
      redirect_uri:          redirectUri,
      scope:                 SCOPES,
      state,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
    })
    return `${AUTHORIZE_URL}?${params}`
  }

  async exchangeCode(code: string, context?: { oauthState?: Record<string, unknown> }) {
    const clientId     = requireEnv('X_APP_ID')
    const clientSecret = requireEnv('X_APP_SECRET')
    const redirectUri  = process.env.X_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('x')
    const verifier     = typeof context?.oauthState?.codeVerifier === 'string'
      ? context.oauthState.codeVerifier
      : null
    if (!verifier) throw new Error('OAuth PKCE code_verifier state içinde yok')

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const body  = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      code_verifier: verifier,
    })

    const tokenRes = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization:   `Basic ${basic}`,
      },
      body: body.toString(),
    })

    const tokenJson = await tokenRes.json() as {
      access_token?:  string
      refresh_token?: string
      expires_in?:    number
      error?:         string
      error_description?: string
    }

    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? 'X token exchange başarısız')
    }

    const meRes = await fetch(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    const me = await meRes.json() as { data?: { id?: string; username?: string }; errors?: Array<{ message?: string }> }
    if (!meRes.ok || !me.data?.id) {
      throw new Error(me.errors?.[0]?.message ?? 'X /users/me başarısız')
    }

    return {
      accessToken:         tokenJson.access_token,
      refreshToken:        tokenJson.refresh_token,
      expiresAt:           tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      externalAccountId:   me.data.id,
      scopes:              SCOPES.split(' '),
      metadata:            { username: me.data.username ?? null },
    }
  }

  async refreshIfNeeded(row: {
    access_token_ciphertext: string
    refresh_token_ciphertext: string | null
    expires_at: string | null
  }) {
    if (!row.expires_at || !row.refresh_token_ciphertext) return null
    const expires = new Date(row.expires_at).getTime()
    const soon    = Date.now() + 7 * 24 * 60 * 60 * 1000
    if (expires > soon) return null

    const { decryptToken } = await import('../../tokenEncryptor.js')
    const refreshToken = decryptToken(row.refresh_token_ciphertext)
    const clientId     = requireEnv('X_APP_ID')
    const clientSecret = requireEnv('X_APP_SECRET')
    const basic        = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    })

    const res  = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${basic}`,
      },
      body: body.toString(),
    })
    const json = await res.json() as {
      access_token?:  string
      refresh_token?: string
      expires_in?:    number
      error?:         string
    }
    if (!res.ok || !json.access_token) {
      throw new Error(json.error ?? 'X token yenileme başarısız')
    }

    return {
      accessToken:  json.access_token,
      refreshToken: json.refresh_token,
      expiresAt:    json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : undefined,
    }
  }
}
