import type { ISocialOAuthProvider, OAuthAppCredentials } from './types.js'
import { defaultRedirectUri } from '../oauthApps.js'

// LinkedIn 3-legged OAuth (OIDC tabanlı).
// Paylaşım hedefleri (dinamik): kişisel profil (w_member_social) + yönetilen şirket
// sayfaları (w_organization_social — Community Management API onayı gerektirir).
// org scope onaysızsa authorize'da reddedilebilir; bu yüzden org scope'lar
// OPSİYONEL istenir ve organizasyon çekme çağrısı hata verirse sessizce atlanır —
// kişisel paylaşım her koşulda çalışır. Onay gelince şirket hedefleri otomatik dolar.
const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL     = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL  = 'https://api.linkedin.com/v2/userinfo'
const ORG_ACLS_URL  = 'https://api.linkedin.com/v2/organizationAcls'
const ORG_LOOKUP    = 'https://api.linkedin.com/v2/organizations'

// Temel scope'lar her zaman; org scope'ları LINKEDIN_ENABLE_ORG=true iken eklenir
// (Community Management API onayı sonrası). Onaysız istenirse authorize hata verebilir.
const BASE_SCOPES = ['openid', 'profile', 'w_member_social']
const ORG_SCOPES  = ['w_organization_social', 'r_organization_social', 'rw_organization_admin']

function scopesForConfig(): string[] {
  const orgEnabled = process.env.LINKEDIN_ENABLE_ORG?.trim().toLowerCase() === 'true'
  return orgEnabled ? [...BASE_SCOPES, ...ORG_SCOPES] : BASE_SCOPES
}

/** Paylaşım hedefi: kişi veya organizasyon. author URN olarak kullanılır. */
export type ShareTarget = {
  kind: 'person' | 'organization'
  urn: string          // urn:li:person:xxx | urn:li:organization:xxx
  name: string
}

/**
 * Kullanıcının ADMIN olduğu organizasyonları çeker. Onay/scope yoksa boş döner
 * (kişisel paylaşım etkilenmez). Hata fırlatmaz — best-effort.
 */
async function fetchOrganizationTargets(accessToken: string): Promise<ShareTarget[]> {
  try {
    const url = `${ORG_ACLS_URL}?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName)))`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
    })
    if (!res.ok) return []   // 403 = scope/onay yok → sessizce atla
    const json = await res.json() as {
      elements?: Array<{
        organization?: string
        'organization~'?: { id?: number | string; localizedName?: string }
      }>
    }
    const targets: ShareTarget[] = []
    for (const el of json.elements ?? []) {
      const embedded = el['organization~']
      const orgUrn = el.organization
      const id = embedded?.id ?? (typeof orgUrn === 'string' ? orgUrn.split(':').pop() : undefined)
      if (!id) continue
      targets.push({
        kind: 'organization',
        urn:  `urn:li:organization:${id}`,
        name: embedded?.localizedName ?? `Organizasyon ${id}`,
      })
    }
    return targets
  } catch {
    return []
  }
}

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
      scope:         scopesForConfig().join(' '),
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

    // Paylaşım hedefleri: kişisel her zaman; org'lar best-effort (onay/scope varsa)
    const personTarget: ShareTarget = {
      kind: 'person',
      urn:  `urn:li:person:${me.sub}`,
      name: me.name ?? 'Kişisel profil',
    }
    const orgTargets = await fetchOrganizationTargets(tokenJson.access_token)
    const shareTargets = [personTarget, ...orgTargets]

    return {
      accessToken:       tokenJson.access_token,
      refreshToken:      tokenJson.refresh_token,
      expiresAt:         tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : undefined,
      externalAccountId: me.sub,
      scopes:            scopesForConfig(),
      metadata:          {
        name: me.name ?? null,
        share_targets: shareTargets,
        default_share_target: personTarget.urn,   // kullanıcı panelden değiştirir
      },
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
