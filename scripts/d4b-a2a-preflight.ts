#!/usr/bin/env npx tsx
/**
 * D4b — Agent Card ön koşul: policy seed + canary pack a2a_public.
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

async function main() {
  const checks: Check[] = []

  const { data: enabled } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'a2a.card_enabled')
    .is('owner_user_id', null)
    .maybeSingle()
  checks.push({
    step: 'a2a.card_enabled global false',
    ok: enabled?.value === false || enabled?.value === 'false',
    detail: JSON.stringify(enabled?.value),
  })

  const { data: defPack } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'a2a.default_pack_id')
    .is('owner_user_id', null)
    .maybeSingle()
  const packId = typeof defPack?.value === 'string'
    ? defPack.value
    : (defPack?.value as unknown)
  checks.push({
    step: 'a2a.default_pack_id set',
    ok: packId === 'sosyal-medya-reklam-gelirleri' || packId === '"sosyal-medya-reklam-gelirleri"',
    detail: JSON.stringify(defPack?.value),
  })

  const { data: pack } = await sb
    .from('domain_packs')
    .select('id, status, meta')
    .eq('id', 'sosyal-medya-reklam-gelirleri')
    .maybeSingle()
  const meta = (pack?.meta ?? {}) as Record<string, unknown>
  checks.push({
    step: 'canary pack a2a_public',
    ok: pack?.status === 'active' && meta.a2a_public === true,
    detail: JSON.stringify({ status: pack?.status, a2a_public: meta.a2a_public }),
  })

  let failed = 0
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.step}${c.detail ? ` — ${c.detail}` : ''}`)
    if (!c.ok) failed++
  }
  if (failed > 0) {
    console.error(`\n${failed} D4b ön koşul kırmızı`)
    process.exit(1)
  }
  console.log('\nD4b DB ön koşulları hazır. Kart: GET /.well-known/agent-card.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
