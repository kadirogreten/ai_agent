import { supabase } from '@/lib/supabaseClient'

export type PersonaScheduleRow = {
  id: string
  owner_user_id: string
  tenant_id: string | null
  name: string
  description: string | null
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
  enabled: boolean
  last_fired_at: string | null
  next_fire_at: string | null
  last_run_id: string | null
  consecutive_failures: number
  anomaly_threshold: number
  created_at: string
  updated_at: string
}

export type UpsertScheduleInput = {
  name: string
  description?: string | null
  domain_pack: string
  persona_slug: string
  playbook_slug: string
  topic_template: string
  cron_expression: string
  timezone?: string
  model?: string | null
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk?: boolean
  web?: boolean
  contrarian?: boolean
  enabled?: boolean
}

export async function listSchedules() {
  const res = await supabase
    .from('persona_schedules')
    .select('*')
    .order('next_fire_at', { ascending: true, nullsFirst: true })
    .limit(200)
  return {
    data: (res.data ?? []) as PersonaScheduleRow[],
    error: res.error?.message ?? null,
  }
}

export async function createSchedule(input: UpsertScheduleInput) {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { id: null, error: 'Oturum bulunamadı' }

  const res = await supabase
    .from('persona_schedules')
    .insert({
      owner_user_id: userData.user.id,
      timezone:        input.timezone ?? 'Europe/Istanbul',
      allow_high_risk: input.allow_high_risk ?? false,
      web:             input.web ?? true,
      contrarian:      input.contrarian ?? false,
      enabled:         input.enabled ?? true,
      ...input,
    })
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function toggleSchedule(id: string, enabled: boolean) {
  const res = await supabase
    .from('persona_schedules')
    .update({ enabled })
    .eq('id', id)
  return { ok: !res.error, error: res.error?.message ?? null }
}

export async function deleteSchedule(id: string) {
  const res = await supabase.from('persona_schedules').delete().eq('id', id)
  return { ok: !res.error, error: res.error?.message ?? null }
}
