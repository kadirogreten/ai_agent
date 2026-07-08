/**
 * PR-S7a: Tüm platformlar için credential yenileme döngüsü (cron).
 * S7a: Meta refreshIfNeeded tam; diğerleri stub.
 */
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { encryptToken } from './tokenEncryptor.js'
import { getSocialProvider } from './social/providers/index.js'
import { resolveOAuthAppConfig } from './social/oauthApps.js'

const SELECT =
  'id,owner_user_id,platform,access_token_ciphertext,refresh_token_ciphertext,expires_at,status'

export async function credentialRefreshTick(): Promise<{ refreshed: number; errors: number }> {
  const supabase = getSupabaseAdmin()
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('user_social_accounts')
    .select(SELECT)
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lte('expires_at', soon)

  if (error) throw error

  let refreshed = 0
  let errors    = 0

  for (const row of data ?? []) {
    const provider = getSocialProvider(row.platform)
    if (!provider) continue

    try {
      // PR-S7c: app config satır sahibine göre çözümlenir (owner > platform > env)
      const app = await resolveOAuthAppConfig(row.platform, row.owner_user_id)
      if (!app) {
        console.error(`[credentialRefreshTick] ${row.platform}/${row.id}: app yapılandırması yok — atlandı`)
        continue
      }
      const result = await provider.refreshIfNeeded(row, app)
      if (!result) continue

      const { error: upErr } = await supabase
        .from('user_social_accounts')
        .update({
          access_token_ciphertext: encryptToken(result.accessToken),
          refresh_token_ciphertext: result.refreshToken
            ? encryptToken(result.refreshToken)
            : row.refresh_token_ciphertext,
          expires_at: result.expiresAt?.toISOString() ?? row.expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (upErr) throw upErr
      refreshed++
    } catch (e) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[credentialRefreshTick] ${row.platform}/${row.id}: ${msg}`)
      await supabase
        .from('user_social_accounts')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('id', row.id)
    }
  }

  return { refreshed, errors }
}
