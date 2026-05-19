/**
 * Empirik Doğrulama Aracı — 4 kritik mekanizmayı DB'den ölçer.
 *
 * Kullanım: npx tsx portal/api/lib/empiricalCheck.ts [--check <1|2|3|4|all>]
 *
 * Check 1 — Facts Injection (Kapı 1 hafıza kanıtı)
 *   Aynı topic'te birden fazla run varsa: ikinci run'ın event log'unda
 *   "prior_facts_loaded" eventi var mı, kaç fact inject edildi?
 *
 * Check 2 — Persona Behaviors overlay
 *   prefers_domain_allowlist=true olan persona ile yapılan run'larda
 *   worker log'larında "allowed_domains policy applied" var mı?
 *
 * Check 3 — RiskGate
 *   R2/R3 risk'li run_request'ler approval_queue'ya yazılmış mı?
 *   Ortalama onay bekleme süresi nedir?
 *
 * Check 4 — Behaviors Heuristic (sektör keşfi)
 *   Son oluşturulan personaların behaviors alanı dolu mu boş mu?
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

function header(title: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function pass(msg: string) { console.log(`  ✓  ${msg}`) }
function warn(msg: string) { console.log(`  ⚠  ${msg}`) }
function fail(msg: string) { console.log(`  ✗  ${msg}`) }
function info(msg: string) { console.log(`     ${msg}`) }

// ─── Check 1: Facts Injection ───────────────────────────────────────────────

async function check1_factsInjection(sb: SupabaseClient) {
  header('Check 1 — Facts Injection (Kapı 1 Hafıza Kanıtı)')

  // Aynı request_text'e sahip en az 2 completed run'ı bul
  const { data: runs } = await sb
    .from('run_requests')
    .select('id, request_text, created_at, answers_json')
    .eq('status', 'completed')
    .not('request_text', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500)

  if (!runs?.length) { warn('Hiç completed run yok — test edilemedi.'); return }

  const byTopic: Record<string, typeof runs> = {}
  for (const r of runs) {
    const key = (r.request_text as string).trim().toLowerCase().slice(0, 120)
    if (!byTopic[key]) byTopic[key] = []
    byTopic[key].push(r)
  }

  const repeatedTopics = Object.values(byTopic).filter((g) => g.length >= 2)
  if (!repeatedTopics.length) {
    warn('Aynı topic ile birden fazla run yok. Test için aynı topic\'i 2 kez çalıştırın.')
    info('Öneri: "Rakip fiyat analizi" topic\'ini 2 kez çalıştır, ardından bu aracı tekrar çalıştır.')
    return
  }

  info(`${repeatedTopics.length} tekrarlı topic bulundu.`)

  let injectionFound = 0
  for (const group of repeatedTopics.slice(0, 5)) {
    const firstRun  = group[0]
    const secondRun = group[group.length - 1]

    // run event log'larında prior_facts_loaded var mı?
    const { data: events } = await sb
      .from('run_event_logs')
      .select('event_type, payload')
      .eq('run_request_id', secondRun.id)
      .eq('event_type', 'prior_facts_loaded')
      .limit(1)

    const topic = (secondRun.request_text as string).slice(0, 60)
    if (events?.length) {
      const factCount = (events[0].payload as Record<string, unknown>)?.fact_count ?? '?'
      pass(`"${topic}…" → ${factCount} fact inject edildi`)
      injectionFound++
    } else {
      fail(`"${topic}…" → prior_facts_loaded eventi yok`)
      info(`  İlk run: ${firstRun.id} (${firstRun.created_at?.slice(0, 10)})`)
      info(`  İkinci run: ${secondRun.id} (${secondRun.created_at?.slice(0, 10)})`)
    }
  }

  if (injectionFound === 0) {
    fail('Facts injection hiç doğrulanamadı. run_event_logs.event_type kontrolü gerekiyor.')
  } else {
    pass(`${injectionFound}/${Math.min(repeatedTopics.length, 5)} tekrarlı topic\'te injection kanıtlandı.`)
  }
}

// ─── Check 2: Persona Behaviors Overlay ─────────────────────────────────────

async function check2_behaviorsOverlay(sb: SupabaseClient) {
  header('Check 2 — Persona Behaviors Overlay')

  // prefers_domain_allowlist=true olan personalarla yapılmış run'lar
  const { data: personas } = await sb
    .from('personas')
    .select('id, slug, behaviors')
    .not('behaviors', 'is', null)
    .limit(200)

  const allowlistPersonas = (personas ?? []).filter((p) => {
    const b = p.behaviors as Record<string, unknown>
    return b?.prefers_domain_allowlist === true || b?.prefersDomainAllowlist === true
  })

  if (!allowlistPersonas.length) {
    warn('prefers_domain_allowlist=true olan persona yok. Bir personaya bu davranışı ekleyin ve çalıştırın.')
    return
  }

  info(`${allowlistPersonas.length} allowlist-persona bulundu: ${allowlistPersonas.map((p) => p.slug).join(', ')}`)

  // Bu personalarla yapılmış completed run'ları bul
  const personaSlugs = allowlistPersonas.map((p) => p.slug)
  const { data: runs } = await sb
    .from('run_requests')
    .select('id, answers_json, status')
    .eq('status', 'completed')
    .in('answers_json->persona', personaSlugs)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!runs?.length) {
    warn('Bu personalarla completed run yok. Önce bir çalıştırma yapın.')
    return
  }

  info(`${runs.length} run bulundu. Event log'larında policy uygulaması aranıyor…`)

  let confirmed = 0
  for (const r of runs.slice(0, 10)) {
    const { data: events } = await sb
      .from('run_event_logs')
      .select('event_type, payload')
      .eq('run_request_id', r.id)
      .ilike('event_type', '%domain_allowlist%')
      .limit(1)

    if (events?.length) {
      pass(`Run ${r.id.slice(0, 8)}… → domain_allowlist policy uygulandı`)
      confirmed++
    } else {
      // Alternatif: job log'larında "allowed-domains" string'i var mı?
      const { data: jobs } = await sb
        .from('jobs')
        .select('log_output')
        .eq('run_request_id', r.id)
        .limit(1)

      const logHasAllowlist = (jobs?.[0]?.log_output as string ?? '').toLowerCase().includes('allowed-domain')
      if (logHasAllowlist) {
        pass(`Run ${r.id.slice(0, 8)}… → job log'unda allowed-domains referansı var`)
        confirmed++
      } else {
        warn(`Run ${r.id.slice(0, 8)}… → policy uygulaması log'da bulunamadı`)
      }
    }
  }

  if (confirmed > 0) pass(`${confirmed} run'da behaviors overlay doğrulandı.`)
  else fail('Hiçbir run\'da overlay kanıtlanamadı. C# log satırları kontrol edin.')
}

// ─── Check 3: RiskGate ───────────────────────────────────────────────────────

async function check3_riskGate(sb: SupabaseClient) {
  header('Check 3 — RiskGate (R2/R3 Approval Flow)')

  const { data: queue, error } = await sb
    .from('approval_queue')
    .select('id, run_request_id, status, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) { fail(`approval_queue sorgusu başarısız: ${error.message}`); return }

  if (!queue?.length) {
    warn('approval_queue boş. R2/R3 riskli bir run_request oluşturun.')
    info('Öneri: RunWizard\'da default_risk=R2 olan bir playbook seçip çalıştırın.')
    return
  }

  const byStatus: Record<string, number> = {}
  const waitTimes: number[] = []
  for (const item of queue) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1
    if (item.resolved_at && item.created_at) {
      const wait = new Date(item.resolved_at).getTime() - new Date(item.created_at).getTime()
      waitTimes.push(wait)
    }
  }

  pass(`approval_queue'da ${queue.length} kayıt var:`)
  for (const [status, count] of Object.entries(byStatus)) {
    info(`  ${status}: ${count}`)
  }

  if (waitTimes.length) {
    const avg = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
    info(`Ortalama onay bekleme süresi: ${Math.round(avg / 60000)} dakika`)
  }

  // R2/R3 run_request'ler queue'ya yazılmış mı?
  const { data: highRiskRuns } = await sb
    .from('run_requests')
    .select('id, risk, status')
    .in('risk', ['R2', 'R3'])
    .limit(20)

  if (!highRiskRuns?.length) {
    warn('Hiç R2/R3 run_request yok — RiskGate tetiklenmemiş demektir.')
  } else {
    const queueIds = new Set(queue.map((q) => q.run_request_id))
    const gated = highRiskRuns.filter((r) => queueIds.has(r.id))
    if (gated.length > 0) {
      pass(`${gated.length}/${highRiskRuns.length} R2/R3 run approval_queue\'ya yazılmış.`)
    } else {
      fail(`${highRiskRuns.length} R2/R3 run var ama hiçbiri queue\'da — RiskGate devreye girmemiş olabilir.`)
    }
  }
}

// ─── Check 4: Behaviors Heuristic ───────────────────────────────────────────

async function check4_behaviorsHeuristic(sb: SupabaseClient) {
  header('Check 4 — Behaviors Heuristic (Sektör Keşfi Otomasyonu)')

  const { data: personas } = await sb
    .from('personas')
    .select('id, slug, name, behaviors, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (!personas?.length) { warn('Hiç persona yok.'); return }

  const withBehaviors = personas.filter((p) => {
    const b = p.behaviors as Record<string, unknown>
    return b && Object.values(b).some(Boolean)
  })

  const withoutBehaviors = personas.filter((p) => {
    const b = p.behaviors as Record<string, unknown>
    return !b || !Object.values(b).some(Boolean)
  })

  info(`Son 50 persona: ${withBehaviors.length} behaviors dolu / ${withoutBehaviors.length} boş`)

  if (withBehaviors.length === 0) {
    fail('Hiçbir personada behaviors dolu değil. Sektör keşfi heuristik çalışmıyor olabilir.')
    info('Öneri: SectorBuilderPage\'den yeni bir sektör keşfi başlatın ve sonucu kontrol edin.')
  } else if (withBehaviors.length / personas.length < 0.5) {
    warn(`Personaların yalnızca %${Math.round(withBehaviors.length / personas.length * 100)}'inde behaviors dolu.`)
    info('Boş persona\'lar manuel oluşturulmuş olabilir (heuristik sadece sektör keşfinde çalışır).')
  } else {
    pass(`Personaların %${Math.round(withBehaviors.length / personas.length * 100)}'inde behaviors dolu.`)
  }

  // Örnek dolu persona
  if (withBehaviors.length) {
    const ex = withBehaviors[0]
    const flags = Object.entries(ex.behaviors as Record<string, unknown>)
      .filter(([, v]) => v)
      .map(([k]) => k)
    info(`Örnek: "${ex.slug}" → ${flags.join(', ')}`)
  }

  // Son 7 günde oluşturulan personalar — sektör keşfinden gelenler büyük olasılıkla yeni
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const recentNew = personas.filter((p) => p.created_at > cutoff)
  if (recentNew.length) {
    const recentWithB = recentNew.filter((p) => {
      const b = p.behaviors as Record<string, unknown>
      return b && Object.values(b).some(Boolean)
    })
    info(`Son 7 gün: ${recentNew.length} yeni persona, ${recentWithB.length} tanesinde behaviors dolu`)
  }
}

// ─── Ana çalıştırıcı ─────────────────────────────────────────────────────────

async function main() {
  const arg  = process.argv[2]
  const which = arg === '--check' ? process.argv[3] : 'all'
  const sb   = getSupabase()

  console.log(`\nEmprik Doğrulama Aracı — ${new Date().toISOString()}`)
  console.log(`Kontrol: ${which ?? 'all'}`)

  if (which === '1' || which === 'all') await check1_factsInjection(sb)
  if (which === '2' || which === 'all') await check2_behaviorsOverlay(sb)
  if (which === '3' || which === 'all') await check3_riskGate(sb)
  if (which === '4' || which === 'all') await check4_behaviorsHeuristic(sb)

  console.log('\n' + '═'.repeat(60))
  console.log('  Tamamlandı.')
  console.log('═'.repeat(60) + '\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
