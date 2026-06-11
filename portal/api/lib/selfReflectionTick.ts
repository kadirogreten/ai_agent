/**
 * Kapı 4 — Öz-Yansımalı Otonomi: Self-Reflection Scheduler
 *
 * Son 30 günde Verifier FAIL oranı yüksek playbook'ları bulup her biri için
 * CEO'ya "iyileştir" sinyali gönderir (mode=ceo run_request insert).
 *
 * Tasarım kararları:
 *   - Sadece MIN_RUNS eşiğini geçmiş playbook'lar değerlendirilir (istatistiksel güvenilirlik).
 *   - Aynı playbook için günde birden fazla sinyal gönderilmez (cooldown).
 *   - CEO ajanı request_text'i okuyup playbook'u nasıl değiştireceğini planlar;
 *     asıl güncelleme CeoReviewPage'de insan onayıyla yapılır (Kapı 4 yarı-otomatik).
 *
 * Deploy: .github/workflows/self-reflection.yml → her gece 02:00 UTC çalışır.
 * Manuel: npx tsx portal/api/lib/selfReflectionTick.ts
 */
import { createClient } from '@supabase/supabase-js'
import { getPolicy } from './policyReader.js'

// Kod sabitleri — policy_settings bulunamazsa kullanılır
const DEFAULT_FAIL_RATE_THRESHOLD = 0.4
const DEFAULT_MIN_RUNS            = 5
const DEFAULT_COOLDOWN_HOURS      = 24

function log(msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  if (!meta) { console.log(`[self-reflect ${ts}] ${msg}`); return }
  console.log(`[self-reflect ${ts}] ${msg}`, JSON.stringify(meta))
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

type PlaybookStats = {
  playbook_slug: string
  domain_pack: string
  total_runs: number
  fail_runs: number
  fail_rate: number
  last_signal_at: string | null
}

export async function selfReflectionTick() {
  const supabase = getSupabase()

  // policy_settings'ten yapılandırma yükle (global; service_role ile RLS bypass)
  const FAIL_RATE_THRESHOLD = await getPolicy<number>(supabase, null, 'selfreflect.fail_rate',    DEFAULT_FAIL_RATE_THRESHOLD)
  const MIN_RUNS            = await getPolicy<number>(supabase, null, 'selfreflect.min_runs',      DEFAULT_MIN_RUNS)
  const COOLDOWN_HOURS      = await getPolicy<number>(supabase, null, 'selfreflect.cooldown_hours', DEFAULT_COOLDOWN_HOURS)

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Son 30 günde Verifier sonucu olan run'ları playbook bazında grupla
  const { data: runs, error: runsErr } = await supabase
    .from('run_requests')
    .select('answers_json, status')
    .gte('created_at', since)
    .in('status', ['completed', 'failed'])
    .not('answers_json->playbookId', 'is', null)

  if (runsErr) throw runsErr

  // playbook_slug → {total, fail} sayacı
  const stats: Record<string, { total: number; fail: number; pack: string }> = {}
  for (const r of (runs ?? [])) {
    const answers = r.answers_json as Record<string, unknown>
    const slug = String(answers?.playbookId ?? '')
    const pack = String(answers?.domainPack ?? answers?.domain_pack ?? '')
    if (!slug) continue
    if (!stats[slug]) stats[slug] = { total: 0, fail: 0, pack }
    stats[slug].total++
    if (r.status === 'failed') stats[slug].fail++
  }

  // Son sinyal zamanlarını çek (cooldown kontrolü)
  const slugs = Object.keys(stats)
  const { data: recentSignals } = await supabase
    .from('run_requests')
    .select('answers_json, created_at')
    .eq('mode', 'ceo')
    .gte('created_at', new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString())
    .contains('answers_json', { self_reflection: true })

  const recentlySignaled = new Set<string>(
    (recentSignals ?? []).map((r) => {
      const a = r.answers_json as Record<string, unknown>
      return String(a?.playbook_slug ?? '')
    }).filter(Boolean)
  )

  // Sinyale aday playbook'ları belirle
  const candidates: PlaybookStats[] = Object.entries(stats)
    .filter(([slug, s]) =>
      s.total >= MIN_RUNS &&
      s.fail / s.total >= FAIL_RATE_THRESHOLD &&
      !recentlySignaled.has(slug)
    )
    .map(([slug, s]) => ({
      playbook_slug:   slug,
      domain_pack:     s.pack,
      total_runs:      s.total,
      fail_runs:       s.fail,
      fail_rate:       Math.round((s.fail / s.total) * 100) / 100,
      last_signal_at:  null,
    }))

  log(`candidates: ${candidates.length} / ${slugs.length} playbook değerlendirildi`)

  // Her aday için CEO run_request yarat
  let signaled = 0
  for (const c of candidates) {
    if (!c.domain_pack) {
      log('skip — domain_pack bilinmiyor', { playbook_slug: c.playbook_slug })
      continue
    }

    // Sistem kullanıcısı olarak owner_user_id bul (ilk admin user)
    const { data: adminUser } = await supabase.auth.admin.listUsers({ perPage: 1 })
    const ownerId = adminUser?.users?.[0]?.id
    if (!ownerId) { log('skip — admin user bulunamadı'); continue }

    const requestText =
      `Öz-yansıma analizi: "${c.playbook_slug}" playbook'u son 30 günde ` +
      `${c.total_runs} run'dan ${c.fail_runs} tanesinde başarısız oldu ` +
      `(%${Math.round(c.fail_rate * 100)} FAIL oranı). ` +
      `Bu playbook'un adımlarını, hedeflerini ve agent konfigürasyonunu inceleyerek ` +
      `başarısızlık nedenlerini belirle ve iyileştirme önerileri sun.`

    const { error: insErr } = await supabase
      .from('run_requests')
      .insert({
        owner_user_id: ownerId,
        mode:          'ceo',
        domain_pack:   c.domain_pack,
        request_text:  requestText,
        answers_json: {
          self_reflection:  true,
          playbook_slug:    c.playbook_slug,
          fail_rate:        c.fail_rate,
          total_runs:       c.total_runs,
          fail_runs:        c.fail_runs,
          analysis_window:  '30d',
        },
        risk:   'R1',
        web:    false,
        status: 'pending',
      })

    if (insErr) {
      log('insert failed', { playbook_slug: c.playbook_slug, error: insErr.message })
      continue
    }

    log('signal sent', { playbook_slug: c.playbook_slug, fail_rate: c.fail_rate, total_runs: c.total_runs })
    signaled++
  }

  return { evaluated: slugs.length, candidates: candidates.length, signaled }
}

import { fileURLToPath } from 'url'
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  selfReflectionTick()
    .then((r) => { console.log('OK', r); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
