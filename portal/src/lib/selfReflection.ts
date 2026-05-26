import { supabase } from '@/lib/supabaseClient'

/**
 * Self-Reflection signal — selfReflectionTick.ts'in haftalık ürettiği özel run_request.
 * `answers_json.self_reflection = true` ile işaretli.
 */
export type SelfReflectionSignal = {
  id: string
  status: 'pending' | 'running' | 'success' | 'fail' | 'cancelled'
  domain_pack: string
  playbook_slug: string
  fail_rate: number
  total_runs: number
  fail_runs: number
  analysis_window: string
  request_text: string
  result_json: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  finished_at: string | null
}

export async function listSelfReflectionSignals(limit = 50) {
  const res = await supabase
    .from('run_requests')
    .select('id,status,domain_pack,request_text,result_json,error_message,answers_json,created_at,finished_at')
    .eq('mode', 'ceo')
    .contains('answers_json', { self_reflection: true })
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (res.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const answersRaw = row.answers_json
    const a =
      answersRaw && typeof answersRaw === 'object' && !Array.isArray(answersRaw)
        ? (answersRaw as Record<string, unknown>)
        : {}
    return {
      id:               String(row.id ?? ''),
      status:           (row.status as SelfReflectionSignal['status']) ?? 'pending',
      domain_pack:      typeof row.domain_pack === 'string' ? row.domain_pack : '',
      playbook_slug:    String(a.playbook_slug ?? ''),
      fail_rate:        Number(a.fail_rate ?? 0),
      total_runs:       Number(a.total_runs ?? 0),
      fail_runs:        Number(a.fail_runs ?? 0),
      analysis_window:  String(a.analysis_window ?? ''),
      request_text:     typeof row.request_text === 'string' ? row.request_text : '',
      result_json:      (row.result_json as Record<string, unknown> | null) ?? null,
      error_message:    typeof row.error_message === 'string' ? row.error_message : null,
      created_at:       String(row.created_at ?? ''),
      finished_at:      (row.finished_at as string | null) ?? null,
    } as SelfReflectionSignal
  })

  return { data: rows, error: res.error?.message ?? null }
}

/**
 * Kullanıcı sinyalde önerilen iyileştirmeyi kabul ettiğinde çağrılır.
 * Mevcut sürümde: sadece result_json'a "applied_at" ekler — playbook güncellemesini
 * insan elle yapar. Sonraki sürümde: önerilen değişiklikleri parse edip playbooks
 * tablosundaki adımları otomatik patchleyebilir.
 */
export async function markSelfReflectionApplied(id: string, note?: string) {
  const { data: existing } = await supabase
    .from('run_requests')
    .select('result_json')
    .eq('id', id)
    .maybeSingle()

  const patched = {
    ...(existing?.result_json ?? {}),
    applied_at:   new Date().toISOString(),
    applied_note: note ?? null,
  }

  const res = await supabase
    .from('run_requests')
    .update({ result_json: patched })
    .eq('id', id)

  return { ok: !res.error, error: res.error?.message ?? null }
}
