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

export interface ISocialOAuthProvider {
  readonly slug: SocialPlatformSlug
  readonly displayName: string
  /** Opsiyonel PKCE / platform özel state alanları (X). */
  createOAuthExtras?(): Record<string, unknown>
  buildAuthorizeUrl(state: string, extras?: Record<string, unknown>): string
  exchangeCode(
    code: string,
    context?: { oauthState?: Record<string, unknown> },
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
  }): Promise<{
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
  } | null>
}
