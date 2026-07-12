#!/usr/bin/env npx tsx
/**
 * D4d — usage_monthly / ad_spend_monthly + billing policy seeds.
 * Eval filtresi view tanımında olmalı.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../supabase/migrations/20260713190000_d4d_metering.sql',
  )
  const sql = readFileSync(migrationPath, 'utf8')
  checks.push({
    step: 'migration SQL has eval IS DISTINCT FROM filter',
    ok: sql.includes("(meta->>'eval') IS DISTINCT FROM 'true'"),
  })
  checks.push({
    step: 'migration SQL has security_invoker',
    ok: sql.includes('security_invoker'),
  })

  const { error: uErr } = await sb.from('usage_monthly').select('owner_user_id').limit(1)
  checks.push({
    step: 'usage_monthly view selectable',
    ok: !uErr || !String(uErr.message).toLowerCase().includes('does not exist'),
    detail: uErr?.message,
  })

  const { error: aErr } = await sb.from('ad_spend_monthly').select('owner_user_id').limit(1)
  checks.push({
    step: 'ad_spend_monthly view selectable',
    ok: !aErr || !String(aErr.message).toLowerCase().includes('does not exist'),
    detail: aErr?.message,
  })

  // Stronger: if view missing, PostgREST returns clear error
  if (uErr?.message?.includes('Could not find') || uErr?.code === '42P01') {
    checks[checks.length - 2]!.ok = false
  }
  if (aErr?.message?.includes('Could not find') || aErr?.code === '42P01') {
    checks[checks.length - 1]!.ok = false
  }

  const { data: budget } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'billing.monthly_llm_budget_usd')
    .is('owner_user_id', null)
    .maybeSingle()
  checks.push({
    step: 'billing.monthly_llm_budget_usd seed (null/limitsiz)',
    ok: budget != null && (budget.value === null || budget.value === 'null'),
    detail: JSON.stringify(budget?.value),
  })

  const { data: alert } = await sb
    .from('policy_settings')
    .select('value')
    .eq('key', 'billing.alert_threshold_pct')
    .is('owner_user_id', null)
    .maybeSingle()
  const alertVal = typeof alert?.value === 'number' ? alert.value : Number(alert?.value)
  checks.push({
    step: 'billing.alert_threshold_pct=80',
    ok: alertVal === 80,
    detail: JSON.stringify(alert?.value),
  })

  let failed = 0
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.step}${c.detail ? ` — ${c.detail}` : ''}`)
    if (!c.ok) failed++
  }
  if (failed > 0) {
    console.error(`\n${failed} D4d ön koşul kırmızı`)
    process.exit(1)
  }
  console.log('\nD4d DB ön koşulları hazır (görünürlük only; Stripe/hard cap yok).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
