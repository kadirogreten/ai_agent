import type { ISocialOAuthProvider, OAuthAppCredentials } from './types.js'
import { defaultRedirectUri } from '../oauthApps.js'

// TikTok Business API OAuth. Business access token uzun ömürlüdür (refresh yok);
// süresi yoktur, kullanıcı yetkiyi geri çekene kadar geçerlidir.
const AUTHORIZE_URL = 'https://business-api.tiktok.com/portal/auth'
const TOKEN_URL     = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/'
const ADVERTISER_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} eksik`)
  return v
}

export class TikTokOAuthProvider implements ISocialOAuthProvider {
  readonly slug = 'tiktok' as const
  readonly displayName = 'TikTok'

  buildAuthorizeUrl(state: string, extras?: Record<string, unknown> & { appConfig?: OAuthAppCredentials }): string {
    const cfg = extras?.appConfig
    const appId       = cfg?.appId ?? requireEnv('TIKTOK_APP_ID')
    const redirectUri = cfg?.redirectUri ?? process.env.TIKTOK_OAUTH_REDIRECT_URI?.trim() ?? defaultRedirectUri('tiktok')
    const params = new URLSearchParams({
      app_id:       appId,
      state,
      redirect_uri: redirectUri,
    })
    return `${AUTHORIZE_URL}?${params}`
  }

  async exchangeCode(code: string, context?: { oauthState?: Record<string, unknown>; appConfig?: OAuthAppCredentials }) {
    const cfg = context?.appConfig
    const appId  = cfg?.appId ?? requireEnv('TIKTOK_APP_ID')
    const secret = cfg?.appSecret ?? requireEnv('TIKTOK_APP_SECRET')

    const tokenRes = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app_id: appId, secret, auth_code: code }),
    })
    const tokenJson = await tokenRes.json() as {
      code?:    number
      message?: string
      data?:    { access_token?: string; scope?: number[] }
    }
    const accessToken = tokenJson.data?.access_token
    if (!tokenRes.ok || tokenJson.code !== 0 || !accessToken) {
      throw new Error(tokenJson.message ?? 'TikTok token exchange başarısız')
    }

    // Yetkili advertiser hesaplarını çek — external id olarak ilkini kullan.
    let externalAccountId = 'tiktok-business'
    let advertisers: Array<{ advertiser_id?: string; advertiser_name?: string }> = []
    try {
      const advRes = await fetch(
        `${ADVERTISER_URL}?app_id=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
        { headers: { 'Access-Token': accessToken } },
      )
      const advJson = await advRes.json() as {
        code?: number
        data?: { list?: Array<{ advertiser_id?: string; advertiser_name?: string }> }
      }
      advertisers = advJson.data?.list ?? []
      if (advertisers[0]?.advertiser_id) externalAccountId = String(advertisers[0].advertiser_id)
    } catch { /* advertiser listesi opsiyonel — token yine geçerli */ }

    return {
      accessToken,
      // Business token uzun ömürlü: expiresAt yok, refresh yok.
      externalAccountId,
      scopes: ['business'],
      metadata: {
        advertisers: advertisers
          .filter((a) => a.advertiser_id)
          .map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name ?? null })),
      },
    }
  }

  async refreshIfNeeded() {
    return null // uzun ömürlü token — yenileme gerekmez
  }
}
