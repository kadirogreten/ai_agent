import type { ISocialOAuthProvider, OAuthAppCredentials } from './types.js'
import { defaultRedirectUri } from '../oauthApps.js'

// Google Ads — standart Google OAuth 2.0 (offline access → refresh token).
// NOT: Ads API çağrıları için ayrıca GOOGLE_ADS_DEVELOPER_TOKEN gerekir (OAuth için değil).
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL     = 'https://oauth2.googleapis.com/token'
const USERINFO_URL  = 'https://openidconnect.googleapis.com/v1/userinfo'

const SCOPES = ['https://www.googleapis.com/auth/adwords', 'openid', 'email'].join(' ')

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} eksik`)
  return v
}

type TokenJson = {
  access_token?:      string
  refresh_token?:     string
  expires_in?:        number
  error?:             string
  error_description?: string
}

export class GoogleAdsOAuthProvider implements ISocialOAuthProvider {
  readonly slug = 'google_ads' as const
  readonly displayName = 'Google Ads'

  buildAuthorizeUrl(state: string, extras?: Record<string, unknown> & { appConfig?: OAuthAppCredentials }): string {
    const cfg = extras?.appConfig
    const clientId    = cfg?.appId ?? requireEnv('GOOGLE_ADS_APP_ID')
    const redirectUri = cfg?.redirectUri ?? process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('google_ads')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     clientId,
      redirect_uri:  redirectUri,
      scope:         SCOPES,
      state,
      access_type:   'offline',   // refresh token için zorunlu
      prompt:        'consent',   // refresh token'ın her bağlamada dönmesini garantiler
    })
    return `${AUTHORIZE_URL}?${params}`
  }

  async exchangeCode(code: string, context?: { oauthState?: Record<string, unknown>; appConfig?: OAuthAppCredentials }) {
    const cfg = context?.appConfig
    const clientId     = cfg?.appId ?? requireEnv('GOOGLE_ADS_APP_ID')
    const clientSecret = cfg?.appSecret ?? requireEnv('GOOGLE_ADS_APP_SECRET')
    const redirectUri  = cfg?.redirectUri ?? process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('google_ads')

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
    })

    const tokenRes  = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    const tokenJson = await tokenRes.json() as TokenJson
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? 'Google token exchange başarısız')
    }

    const meRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    const me = await meRes.json() as { sub?: string; email?: string }
    if (!meRes.ok || !me.sub) {
      throw new Error('Google userinfo başarısız')
    }

    return {
      accessToken:       tokenJson.access_token,
      refreshToken:      tokenJson.refresh_token,
      expiresAt:         tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      externalAccountId: me.sub,
      scopes:            SCOPES.split(' '),
      metadata:          { email: me.email ?? null },
    }
  }

  async refreshIfNeeded(row: {
    access_token_ciphertext: string
    refresh_token_ciphertext: string | null
    expires_at: string | null
  }, app?: OAuthAppCredentials) {
    // Google access token ~1 saat — refresh token varsa süresi yaklaşınca yenile.
    if (!row.expires_at || !row.refresh_token_ciphertext) return null
    const expires = new Date(row.expires_at).getTime()
    const soon    = Date.now() + 7 * 24 * 60 * 60 * 1000
    if (expires > soon) return null

    const { decryptToken } = await import('../../tokenEncryptor.js')
    const refreshToken = decryptToken(row.refresh_token_ciphertext)
    const clientId     = app?.appId ?? requireEnv('GOOGLE_ADS_APP_ID')
    const clientSecret = app?.appSecret ?? requireEnv('GOOGLE_ADS_APP_SECRET')

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
      throw new Error(json.error_description ?? json.error ?? 'Google token yenileme başarısız')
    }

    return {
      accessToken: json.access_token,
      // Google refresh token genelde sabit kalır — dönmezse mevcut korunur (tick zaten koruyor).
      refreshToken: json.refresh_token,
      expiresAt:    json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : undefined,
    }
  }
}
