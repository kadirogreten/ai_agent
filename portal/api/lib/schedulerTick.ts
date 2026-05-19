/**
 * Kapı 3 — Çok-Günlü Otonomi: Scheduler Worker (iskelet)
 *
 * Bu modül vadesi gelmiş persona_schedules kayıtlarını bulup her birini
 * run_requests tablosuna insert eder. Asıl çalıştırmayı mevcut runRequestWorker
 * yapar — bu sadece tetikleme katmanıdır.
 *
 * Deploy: GitHub Actions ayrı bir cron workflow (örn. 5 dakikada bir) bunu çağırır.
 * Veya Supabase pg_cron + edge function ile bu mantık DB-içi yürütülebilir.
 *
 * TODO:
 *   - cron parse (cron-parser veya benzeri) ile next_fire_at hesaplaması
 *   - run_request insert sonrası last_run_id update
 *   - Run sonucu fail ise consecutive_failures++; anomaly_threshold aşılırsa enabled=false
 *
 * Şu an manuel test için: `npx tsx portal/api/lib/schedulerTick.ts`
 */
import { createClient } from '@supabase/supabase-js'
import { CronExpressionParser } from 'cron-parser'

function log(message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  if (!meta) { console.log(`[scheduler ${ts}] ${message}`); return }
  console.log(`[scheduler ${ts}] ${message}`, JSON.stringify(meta))
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik')
  return createClient(url, key, { auth: { persistSession: false } })
}

type Schedule = {
  id: string
  owner_user_id: string
  domain_pack: string
  persona_slug: string
  playbook_slug: string
  topic_template: string
  cron_expression: string
  timezone: string
  model: string | null
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
  web: boolean
  contrarian: boolean
  consecutive_failures: number
  anomaly_threshold: number
}

function expandTopic(template: string): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toISOString().slice(11, 16)
  return template
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{iso\}\}/g, now.toISOString())
}

function computeNextFire(cron: string, tz: string, after = new Date()): Date | null {
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: after, tz })
    return it.next().toDate()
  } catch (e) {
    log('cron parse error', { cron, tz, error: (e as Error).message })
    return null
  }
}

export async function tick() {
  const supabase = getSupabase()

  const due = await supabase.rpc('list_due_schedules')
  if (due.error) throw due.error
  const schedules = (due.data ?? []) as Schedule[]

  log(`due schedules: ${schedules.length}`)

  for (const s of schedules) {
    try {
      const topic = expandTopic(s.topic_template)

      // 1. run_request insert
      const ins = await supabase
        .from('run_requests')
        .insert({
          owner_user_id:   s.owner_user_id,
          mode:            'run',
          domain_pack:     s.domain_pack,
          request_text:    topic,
          answers_json: {
            playbookId: s.playbook_slug,
            persona:    s.persona_slug,
            topic,
            scheduled:  true,
            schedule_id: s.id,
          },
          model:           s.model,
          risk:            s.risk,
          allow_high_risk: s.allow_high_risk,
          web:             s.web,
          contrarian:      s.contrarian,
          status:          'pending',
        })
        .select('id')
        .single()

      if (ins.error) throw ins.error

      // 2. schedule güncelle — başarı: failures sıfırla, next_fire_at hesapla
      const next = computeNextFire(s.cron_expression, s.timezone)
      await supabase
        .from('persona_schedules')
        .update({
          last_fired_at:       new Date().toISOString(),
          next_fire_at:        next?.toISOString() ?? null,
          last_run_id:         ins.data?.id ?? null,
          consecutive_failures: 0,
        })
        .eq('id', s.id)

      log('fired', { schedule_id: s.id, run_request_id: ins.data?.id, next_fire_at: next?.toISOString() })
    } catch (e) {
      log('fire failed', { schedule_id: s.id, error: (e as Error).message })

      const newFailures = s.consecutive_failures + 1
      const hitThreshold = newFailures >= s.anomaly_threshold

      await supabase
        .from('persona_schedules')
        .update({
          consecutive_failures: newFailures,
          ...(hitThreshold ? { enabled: false } : {}),
        })
        .eq('id', s.id)

      if (hitThreshold) {
        log('schedule DISABLED — anomaly threshold reached', {
          schedule_id:          s.id,
          consecutive_failures: newFailures,
          anomaly_threshold:    s.anomaly_threshold,
        })
      }
    }
  }

  return { fired: schedules.length }
}

// Direkt CLI'dan çalıştırma desteği
import { fileURLToPath } from 'url'
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  tick()
    .then((r) => { console.log('OK', r); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
