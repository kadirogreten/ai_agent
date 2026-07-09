import type { ISocialOAuthProvider, OAuthAppCredentials } from './types.js'
import { defaultRedirectUri } from '../oauthApps.js'

// LinkedIn 3-legged OAuth (OIDC tabanlı). Üye adına paylaşım: w_member_social.
// Programatik refresh token yalnız onaylı LinkedIn app'lerinde döner; yoksa
// refreshIfNeeded null döner ve süre bitiminde kullanıcı yeniden bağlar.
const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL     = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL  = 'https://api.linkedin.com/v2/userinfo'

const SCOPES = ['openid', 'profile', 'w_member_social'].join(' ')

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} eksik`)
  return v
}

type TokenJson = {
  access_token?:             string
  expires_in?:               number
  refresh_token?:            string
  refresh_token_expires_in?: number
  error?:                    string
  error_description?:       string
}

export class LinkedInOAuthProvider implements ISocialOAuthProvider {
  readonly slug = 'linkedin' as const
  readonly displayName = 'LinkedIn'

  buildAuthorizeUrl(state: string, extras?: Record<string, unknown> & { appConfig?: OAuthAppCredentials }): string {
    const cfg = extras?.appConfig
    const clientId    = cfg?.appId ?? requireEnv('LINKEDIN_APP_ID')
    const redirectUri = cfg?.redirectUri ?? process.env.LINKEDIN_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('linkedin')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     clientId,
      redirect_uri:  redirectUri,
      state,
      scope:         SCOPES,
    })
    return `${AUTHORIZE_URL}?${params}`
  }

  async exchangeCode(code: string, context?: { oauthState?: Record<string, unknown>; appConfig?: OAuthAppCredentials }) {
    const cfg = context?.appConfig
    const clientId     = cfg?.appId ?? requireEnv('LINKEDIN_APP_ID')
    const clientSecret = cfg?.appSecret ?? requireEnv('LINKEDIN_APP_SECRET')
    const redirectUri  = cfg?.redirectUri ?? process.env.LINKEDIN_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('linkedin')

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    })

    const tokenRes  = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    const tokenJson = await tokenRes.json() as TokenJson
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? 'LinkedIn token exchange başarısız')
    }

    const meRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    const me = await meRes.json() as { sub?: string; name?: string; email?: string }
    if (!meRes.ok || !me.sub) {
      throw new Error('LinkedIn userinfo başarısız')
    }

    return {
      accessToken:       tokenJson.access_token,
      refreshToken:      tokenJson.refresh_token,
      expiresAt:         tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      externalAccountId: me.sub,
      scopes:            SCOPES.split(' '),
      metadata:          { name: me.name ?? null },
    }
  }

  async refreshIfNeeded(row: {
    access_token_ciphertext: string
    refresh_token_ciphertext: string | null
    expires_at: string | null
  }, app?: OAuthAppCredentials) {
    // Refresh token yoksa (standart LinkedIn app) yenileme yapılamaz.
    if (!row.expires_at || !row.refresh_token_ciphertext) return null
    const expires = new Date(row.expires_at).getTime()
    const soon    = Date.now() + 7 * 24 * 60 * 60 * 1000
    if (expires > soon) return null

    const { decryptToken } = await import('../../tokenEncryptor.js')
    const refreshToken = decryptToken(row.refresh_token_ciphertext)
    const clientId     = app?.appId ?? requireEnv('LINKEDIN_APP_ID')
    const clientSecret = app?.appSecret ?? requireEnv('LINKEDIN_APP_SECRET')

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    })

    const res  = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    const json = await res.json() as TokenJson
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description ?? json.error ?? 'LinkedIn token yenileme başarısız')
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
