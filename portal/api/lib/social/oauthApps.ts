/**
 * PR-S7c: OAuth app kimlik bilgisi çözümleme + panel CRUD.
 * Çözümleme sırası: owner satırı → platform geneli satır → env fallback.
 * Secret yalnız server-side decrypt edilir; GET yanıtlarına ASLA konmaz.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { decryptToken, encryptToken } from '../tokenEncryptor.js'
import type { SocialPlatformSlug } from './providers/types.js'

export type OAuthAppConfig = {
  appId: string
  appSecret: string
  redirectUri: string
  source: 'owner' | 'platform' | 'env'
}

export type OAuthAppSafeInfo = {
  platform: SocialPlatformSlug
  app_id: string | null
  redirect_uri: string | null
  secret_set: boolean
  source: 'owner' | 'platform' | 'env' | null
  updated_at: string | null
}

/** Platform başına env fallback değişken adları (geriye uyum — kaldırılmadı). */
const ENV_MAP: Record<SocialPlatformSlug, { appId: string; appSecret: string; redirectUri: string }> = {
  meta:       { appId: 'META_APP_ID',       appSecret: 'META_APP_SECRET',       redirectUri: 'META_OAUTH_REDIRECT_URI' },
  x:          { appId: 'X_APP_ID',          appSecret: 'X_APP_SECRET',          redirectUri: 'X_OAUTH_REDIRECT_URI' },
  linkedin:   { appId: 'LINKEDIN_APP_ID',   appSecret: 'LINKEDIN_APP_SECRET',   redirectUri: 'LINKEDIN_OAUTH_REDIRECT_URI' },
  tiktok:     { appId: 'TIKTOK_APP_ID',     appSecret: 'TIKTOK_APP_SECRET',     redirectUri: 'TIKTOK_OAUTH_REDIRECT_URI' },
  google_ads: { appId: 'GOOGLE_ADS_APP_ID', appSecret: 'GOOGLE_ADS_APP_SECRET', redirectUri: 'GOOGLE_ADS_OAUTH_REDIRECT_URI' },
}

export function defaultRedirectUri(platform: SocialPlatformSlug): string {
  const base = process.env.PORTAL_PUBLIC_URL?.replace(/\/$/, '') ?? 'http://localhost:5173'
  return `${base}/api/social/${platform}/oauth/callback`
}

type AppRow = {
  owner_user_id: string | null
  platform: SocialPlatformSlug
  app_id: string
  app_secret_ciphertext: string
  redirect_uri: string | null
  enabled: boolean
  updated_at: string
}

function envConfig(platform: SocialPlatformSlug): OAuthAppConfig | null {
  const names  = ENV_MAP[platform]
  const appId  = process.env[names.appId]?.trim()
  const secret = process.env[names.appSecret]?.trim()
  if (!appId || !secret) return null
  return {
    appId,
    appSecret:   secret,
    redirectUri: process.env[names.redirectUri]?.trim() ?? defaultRedirectUri(platform),
    source: 'env',
  }
}

/** Test edilebilirlik için client enjekte edilebilir. */
export async function resolveOAuthAppConfigWith(
  client: Pick<SupabaseClient, 'from'>,
  platform: SocialPlatformSlug,
  ownerUserId?: string | null,
): Promise<OAuthAppConfig | null> {
  let query = client
    .from('social_oauth_apps')
    .select('owner_user_id,platform,app_id,app_secret_ciphertext,redirect_uri,enabled,updated_at')
    .eq('platform', platform)
    .eq('enabled', true)

  query = ownerUserId
    ? query.or(`owner_user_id.eq.${ownerUserId},owner_user_id.is.null`)
    : query.is('owner_user_id', null)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as AppRow[]
  // Öncelik: owner satırı > platform geneli
  const row = rows.find((r) => r.owner_user_id !== null) ?? rows.find((r) => r.owner_user_id === null)
  if (row) {
    return {
      appId:       row.app_id,
      appSecret:   decryptToken(row.app_secret_ciphertext),
      redirectUri: row.redirect_uri?.trim() || defaultRedirectUri(platform),
      source:      row.owner_user_id ? 'owner' : 'platform',
    }
  }
  return envConfig(platform)
}

export async function resolveOAuthAppConfig(
  platform: SocialPlatformSlug,
  ownerUserId?: string | null,
): Promise<OAuthAppConfig | null> {
  return resolveOAuthAppConfigWith(getSupabaseAdmin(), platform, ownerUserId)
}

/** Panel listesi — secret asla dönmez, yalnız secret_set:boolean. */
export async function listOAuthAppsSafeWith(
  client: Pick<SupabaseClient, 'from'>,
  ownerUserId: string,
  platforms: SocialPlatformSlug[],
): Promise<OAuthAppSafeInfo[]> {
  const { data, error } = await client
    .from('social_oauth_apps')
    .select('owner_user_id,platform,app_id,redirect_uri,enabled,updated_at')
    .or(`owner_user_id.eq.${ownerUserId},owner_user_id.is.null`)
  if (error) throw error

  const rows = (data ?? []) as Omit<AppRow, 'app_secret_ciphertext'>[]
  return platforms.map((platform) => {
    const own  = rows.find((r) => r.platform === platform && r.owner_user_id !== null && r.enabled)
    const glob = rows.find((r) => r.platform === platform && r.owner_user_id === null && r.enabled)
    const row  = own ?? glob
    if (row) {
      return {
        platform,
        app_id:       row.app_id,
        redirect_uri: row.redirect_uri?.trim() || defaultRedirectUri(platform),
        secret_set:   true,
        source:       own ? 'owner' : 'platform',
        updated_at:   row.updated_at,
      }
    }
    const env = envConfig(platform)
    return {
      platform,
      app_id:       env?.appId ?? null,
      redirect_uri: env ? env.redirectUri : null,
      secret_set:   Boolean(env),
      source:       env ? 'env' : null,
      updated_at:   null,
    }
  })
}

export async function upsertOAuthApp(params: {
  ownerUserId: string
  platform: SocialPlatformSlug
  appId: string
  appSecret?: string | null   // boş → mevcut secret korunur
  redirectUri?: string | null
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const appId = params.appId.trim()
  if (!appId) throw new Error('app_id boş olamaz')

  const { data: existing, error: selErr } = await supabase
    .from('social_oauth_apps')
    .select('id,app_secret_ciphertext')
    .eq('platform', params.platform)
    .eq('owner_user_id', params.ownerUserId)
    .maybeSingle()
  if (selErr) throw selErr

  const newSecret = params.appSecret?.trim()
  if (!newSecret && !existing) {
    throw new Error('İlk kayıtta app_secret zorunlu')
  }

  const row = {
    owner_user_id:         params.ownerUserId,
    platform:              params.platform,
    app_id:                appId,
    app_secret_ciphertext: newSecret ? encryptToken(newSecret) : existing!.app_secret_ciphertext,
    redirect_uri:          params.redirectUri?.trim() || null,
    enabled:               true,
    updated_at:            new Date().toISOString(),
  }

  const { error } = existing
    ? await supabase.from('social_oauth_apps').update(row).eq('id', existing.id)
    : await supabase.from('social_oauth_apps').insert(row)
  if (error) throw error

  await auditOAuthApp(params.ownerUserId, params.platform, existing ? 'social_oauth_app.update' : 'social_oauth_app.create')
}

export async function deleteOAuthApp(ownerUserId: string, platform: SocialPlatformSlug): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('social_oauth_apps')
    .delete()
    .eq('platform', platform)
    .eq('owner_user_id', ownerUserId)
  if (error) throw error
  await auditOAuthApp(ownerUserId, platform, 'social_oauth_app.delete')
}

async function auditOAuthApp(ownerUserId: string, platform: string, action: string): Promise<void> {
  try {
    await getSupabaseAdmin().from('audit_log').insert({
      owner_user_id: ownerUserId,
      actor_type:    'user',
      actor_id:      ownerUserId,
      action,
      resource_type: 'social_oauth_app',
      severity:      'info',
      detail:        { platform },   // secret/app_id detayına yazılmaz
    })
  } catch (e) {
    console.error(`[oauthApps] audit_log yazılamadı: ${(e as Error).message}`)
  }
}
