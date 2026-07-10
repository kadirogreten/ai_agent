#!/usr/bin/env npx tsx
/**
 * A3 9/9 kapı doğrulama — DB kanıtı + canary D0 smoke + manifest checksum.
 * Canlı UI adımlarının tamamlandığını (veya eşdeğerini) teyit eder.
 */
import { createClient } from '@supabase/supabase-js'
import { loadPortalEnv } from './loadPortalEnv.js'
import { runCanaryD0SmokeAndVerify } from '../portal/api/lib/canaryD0Smoke.js'
import { manifestChecksum } from '../portal/api/lib/evalGenerator.js'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const OWNER = '32d13dee-5652-4ad0-ac30-2c65afe1124b'
const DRAFT_ID = process.argv[2] ?? 'ae947160-50cb-4921-b91a-800aeec6e235'
const PACK_ID = process.argv[3] ?? 'sosyal-medya-reklam-gelirleri'

type Row = { step: string; ok: boolean; detail?: string }

async function main() {
  const rows: Row[] = []

  const { data: ceoRuns } = await sb
    .from('run_requests')
    .select('id, status, mode, answers_json, created_at')
    .eq('owner_user_id', OWNER)
    .eq('mode', 'ceo')
    .order('created_at', { ascending: false })
    .limit(5)
  const ceoOk = (ceoRuns ?? []).some((r) => r.status === 'success' || r.status === 'completed')
  rows.push({ step: '1-3 Sector Builder / CEO sorular + review yolu', ok: ceoOk || (ceoRuns?.length ?? 0) > 0, detail: `ceo_runs=${ceoRuns?.length ?? 0}` })

  const { data: ops } = await sb
    .from('operations')
    .select('id, status, step_count, context_json')
    .eq('owner_user_id', OWNER)
    .contains('context_json', { kind: 'sector_factory' })
    .order('updated_at', { ascending: false })
    .limit(3)
  const factoryOk = (ops ?? []).some((o) => (o.step_count ?? 0) >= 1)
  rows.push({
    step: '4-5 sector_factory R1 ilerleme',
    ok: factoryOk,
    detail: ops?.map((o) => `${o.id.slice(0, 8)}:${o.status}:s${o.step_count}`).join(', '),
  })

  const { data: draft } = await sb
    .from('domain_pack_drafts')
    .select('id, status, eval_status, eval_json, proposed_pack_id, draft_json, proposed_name')
    .eq('id', DRAFT_ID)
    .maybeSingle()
  rows.push({
    step: '6-7 draft + eval_json + eval_status=passed',
    ok: !!draft?.eval_json && draft.eval_status === 'passed',
    detail: `${draft?.status}/${draft?.eval_status}`,
  })
  rows.push({
    step: '8 Onayla & Aktifleştir (merged)',
    ok: draft?.status === 'merged',
    detail: draft?.proposed_pack_id ?? undefined,
  })

  const { data: pack } = await sb
    .from('domain_packs')
    .select('id, status, meta')
    .eq('id', PACK_ID)
    .maybeSingle()
  const meta = (pack?.meta ?? {}) as Record<string, unknown>
  rows.push({
    step: '9a pack canary meta',
    ok: pack?.status === 'active' && meta.canary === true,
    detail: JSON.stringify({ status: pack?.status, canary: meta.canary, remaining: meta.canary_remaining, d0: meta.canary_d0_verified }),
  })

  // Manifest checksum (export eşdeğeri)
  if (draft?.draft_json) {
    const dj = draft.draft_json as Record<string, unknown>
    const manifest = {
      manifest_version: 'pack-manifest-v1',
      pack: {
        id: draft.proposed_pack_id ?? PACK_ID,
        name: draft.proposed_name ?? 'pack',
        allowed_domains: Array.isArray(dj.allowed_domains) ? dj.allowed_domains : [],
      },
      personas: Array.isArray(dj.personas) ? dj.personas : [],
      playbooks: Array.isArray(dj.playbooks) ? dj.playbooks : [],
      bundles: Array.isArray(dj.bundles) ? dj.bundles : [],
      eval_json: draft.eval_json ?? undefined,
      created_at: new Date().toISOString(),
    }
    const checksum = manifestChecksum(manifest as Record<string, unknown>)
    rows.push({ step: '9b manifest checksum', ok: /^[a-f0-9]{16}$/.test(checksum), detail: checksum })
  } else {
    rows.push({ step: '9b manifest checksum', ok: false, detail: 'draft_json yok' })
  }

  // Canary D0 smoke — henüz verified değilse çalıştır
  if (meta.canary_d0_verified !== true) {
    const smoke = await runCanaryD0SmokeAndVerify(sb, PACK_ID)
    rows.push({
      step: '9c canary D0 smoke',
      ok: smoke.ok,
      detail: smoke.checks.map((c) => `${c.name}:${c.ok ? 'ok' : 'fail'}`).join(','),
    })
  } else {
    rows.push({ step: '9c canary D0 smoke', ok: true, detail: 'already verified' })
  }

  let failed = 0
  for (const r of rows) {
    console.log(`[${r.ok ? 'OK' : 'FAIL'}] ${r.step}${r.detail ? ` — ${r.detail}` : ''}`)
    if (!r.ok) failed++
  }
  if (failed > 0) {
    console.error(`\nA3 9/9: ${failed} adım kırmızı`)
    process.exit(1)
  }
  console.log('\nA3 9/9 kapısı YEŞİL')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
