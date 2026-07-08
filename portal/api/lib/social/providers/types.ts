export type SocialPlatformSlug = 'meta' | 'x' | 'linkedin' | 'tiktok' | 'google_ads'

export type SocialAccountRow = {
  id: string
  platform: SocialPlatformSlug
  external_account_id: string
  scopes: string[]
  status: 'active' | 'revoked' | 'error'
  expires_at: string | null
  metadata: Record<string, unknown>
  updated_at: string
}

export type OAuthStartResult = {
  authorizeUrl: string
}

/** PR-S7c: app kimlik bilgileri çözümlenmiş config olarak enjekte edilir (owner > platform > env). */
export type OAuthAppCredentials = {
  appId: string
  appSecret: string
  redirectUri: string
}

export interface ISocialOAuthProvider {
  readonly slug: SocialPlatformSlug
  readonly displayName: string
  buildAuthorizeUrl(state: string, app: OAuthAppCredentials): string
  exchangeCode(code: string, app: OAuthAppCredentials): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
    externalAccountId: string
    scopes: string[]
    metadata?: Record<string, unknown>
  }>
  refreshIfNeeded(row: {
    access_token_ciphertext: string
    refresh_token_ciphertext: string | null
    expires_at: string | null
  }, app: OAuthAppCredentials): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
  } | null>
}
