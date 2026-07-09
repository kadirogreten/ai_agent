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

/**
 * PR-S7c: panelden yönetilen app kimlik bilgileri (owner > platform geneli > env).
 * Route katmanı çözümler ve extras.appConfig / context.appConfig ile enjekte eder.
 * GÜVENLİK: appConfig ASLA imzalı OAuth state'ine konmaz (state URL'de taşınır).
 */
export type OAuthAppCredentials = {
  appId: string
  appSecret: string
  redirectUri: string
}

export interface ISocialOAuthProvider {
  readonly slug: SocialPlatformSlug
  readonly displayName: string
  /** Opsiyonel PKCE / platform özel state alanları (X). */
  createOAuthExtras?(): Record<string, unknown>
  buildAuthorizeUrl(
    state: string,
    extras?: Record<string, unknown> & { appConfig?: OAuthAppCredentials },
  ): string
  exchangeCode(
    code: string,
    context?: { oauthState?: Record<string, unknown>; appConfig?: OAuthAppCredentials },
  ): Promise<{
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
  }, app?: OAuthAppCredentials): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
  } | null>
}
