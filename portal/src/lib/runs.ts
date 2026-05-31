import { supabase } from '@/lib/supabaseClient'

export type CreateRunRequestInput = {
  mode: 'run' | 'bundle' | 'ceo'
  domain_pack: string
  request_text?: string
  answers_json: Record<string, unknown>
  model?: string
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk?: boolean
  web?: boolean
  contrarian?: boolean
  /** PR2 ToolPermissions grameri; örn. "tools: web_scrape; max_calls: 3". Boş/null = araç yok. */
  tools?: string
}

/**
 * Yeni run_request yaratır. Worker en geç 2dk içinde claim edip dotnet'i tetikler.
 * Dönüş: yeni request ID — wizard sayfası bunu kullanıcıya gösterebilir.
 */
export async function createRunRequest(input: CreateRunRequestInput) {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    return { id: null, error: 'Oturum bulunamadı; lütfen tekrar giriş yapın.' }
  }

  const res = await supabase
    .from('run_requests')
    .insert({
      owner_user_id:   userData.user.id,
      mode:            input.mode,
      domain_pack:     input.domain_pack,
      request_text:    input.request_text ?? null,
      answers_json:    input.answers_json,
      model:           input.model ?? null,
      risk:            input.risk,
      allow_high_risk: input.allow_high_risk ?? false,
      web:             input.web ?? true,
      contrarian:      input.contrarian ?? false,
      tools:           input.tools?.trim() ? input.tools.trim() : null,
      status:          'pending',
    })
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}
