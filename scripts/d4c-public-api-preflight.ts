#!/usr/bin/env npx tsx
/**
 * D4c — Public API ön koşul: tablolar + public_api.enabled=false seed.
 * Aktivasyon (enabled=true) bu script'in işi değil.
 */
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'

loadPortalEnv()
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY gerekli')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

type Check = { step: string; ok: boolean; detail?: string }

async function tableExists(name: string): Promise<boolean> {
  const { error } = await sb.from(name).select('id').limit(1)
  // relation missing → error code often PGRST205 / 42P01
  if (!error) return true
  const msg = error.message.toLowerCase()
  if (msg.includes('does not exist') || msg.includes('could not find') || error.code === '42P01') {
    return false
  }
  // empty table still "exists"
  return true
}

async function main() {
  const checks: Check[] = []

  checks.push({
    step: 'api_keys table',
    ok: await tableExists('api_keys'),
  })
  checks.push({
    step: 'webhook_endpoints table',
    ok: await tableExists('webhook_endpoints'),
  })

  const { data: enabled } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'public_api.enabled')
    .is('owner_user_id', null)
    .maybeSingle()
  checks.push({
    step: 'public_api.enabled global false',
    ok: enabled?.value === false || enabled?.value === 'false',
    detail: JSON.stringify(enabled?.value),
  })

  const { data: rate } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'public_api.rate_limit_per_minute')
    .is('owner_user_id', null)
    .maybeSingle()
  const rateVal = typeof rate?.value === 'number' ? rate.value : Number(rate?.value)
  checks.push({
    step: 'public_api.rate_limit_per_minute=30',
    ok: rateVal === 30,
    detail: JSON.stringify(rate?.value),
  })

  let failed = 0
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.step}${c.detail ? ` — ${c.detail}` : ''}`)
    if (!c.ok) failed++
  }
  if (failed > 0) {
    console.error(`\n${failed} D4c ön koşul kırmızı — migration uygulandı mı?`)
    process.exit(1)
  }
  console.log('\nD4c DB ön koşulları hazır (enabled=false). Aktivasyon ayrı insan kararı.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
