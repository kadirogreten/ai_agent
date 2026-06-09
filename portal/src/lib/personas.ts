import { supabase } from '@/lib/supabaseClient'

export type PersonaRow = {
  id: string
  slug: string
  pack_id: string | null
  tenant_id: string | null
  name: string
  role_description: string | null
  system_prompt: string | null
  behaviors: Record<string, unknown>
  risk_ceiling: 'R0' | 'R1' | 'R2' | 'R3'
  cost_class: 'low' | 'medium' | 'high'
  content_md: string | null
  created_at: string
  updated_at: string
}

/**
 * Persona davranış overlay'i. C# tarafında AgentBehaviorMerge.Apply ile
 * çekirdek ajan üzerine OR mantığıyla uygulanır.
 */
export type PersonaBehaviors = {
  requiresWebSearch?: boolean
  requiresFullContext?: boolean
  writesToFacts?: boolean
  writesToDecisions?: boolean
  capturesVerifierReport?: boolean
  triggersContrarian?: boolean
  acceptsRubric?: boolean
  prefersDomainAllowlist?: boolean
}

export const BEHAVIOR_FLAGS: { key: keyof PersonaBehaviors; label: string; hint: string }[] = [
  { key: 'requiresWebSearch',      label: 'Web araması zorunlu',     hint: 'Persona bu rolde her step\'te web_search tool\'u çağırsın (Researcher\'a tek başına bırakmaz).' },
  { key: 'requiresFullContext',    label: 'Tam bağlam',              hint: 'Sadece önceki adımın çıktısı değil, tüm Work dosyası bağlam olarak verilsin (Verifier/Editor için tipik).' },
  { key: 'writesToFacts',          label: 'Çıktıyı Facts\'e yaz',    hint: 'Adım çıktısı kalıcı kurumsal hafızaya (facts deposu) eklensin.' },
  { key: 'writesToDecisions',      label: 'Çıktıyı Decisions\'a yaz', hint: 'Adım çıktısı kararlar deposuna eklensin (Analyst için tipik).' },
  { key: 'capturesVerifierReport', label: 'Verifier raporu yakala',  hint: 'PASS/FAIL tespiti için çıktıyı denetim raporu olarak işaretle.' },
  { key: 'triggersContrarian',     label: 'Contrarian tetikle',      hint: 'Bu adım bitince otomatik Contrarian (karşıt görüş) adımı çalışsın.' },
  { key: 'acceptsRubric',          label: 'Rubrik politikası',       hint: 'Verifier rubric\'i ekstra policy olarak sistem prompt\'ına enjekte et.' },
  { key: 'prefersDomainAllowlist', label: 'Domain allowlist',        hint: 'Domain pack\'in allowed-domains listesi ekstra policy olarak verilsin (Researcher için tipik).' },
]

export type UpsertPersonaInput = {
  slug: string
  pack_id: string | null
  name: string
  role_description: string | null
  system_prompt: string | null
  content_md: string | null
  behaviors: PersonaBehaviors
  risk_ceiling: 'R0' | 'R1' | 'R2' | 'R3'
  cost_class: 'low' | 'medium' | 'high'
}

export async function listPersonas(params: { q: string; packId?: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('personas')
    .select('id,slug,pack_id,tenant_id,name,role_description,system_prompt,behaviors,risk_ceiling,cost_class,content_md,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (params.packId) {
    // Pack'a özel personalar + cross-domain (pack_id NULL) root personaları dahil et.
    // sync-to-db root personas/*.md dosyalarını pack_id NULL ile yazar; salt eq filtresi
    // bunları dışarda bırakıyordu, dropdown boş kalıyordu.
    query = query.or(`pack_id.eq.${params.packId},pack_id.is.null`)
  }
  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }

  const res = await query
  return {
    data: (res.data ?? []) as PersonaRow[],
    error: res.error?.message ?? null,
  }
}

export async function getPersona(personaId: string) {
  const res = await supabase
    .from('personas')
    .select('id,slug,pack_id,tenant_id,name,role_description,system_prompt,behaviors,risk_ceiling,cost_class,content_md,created_at,updated_at')
    .eq('id', personaId)
    .maybeSingle()

  return {
    data: (res.data ?? null) as PersonaRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createPersona(input: UpsertPersonaInput) {
  // RLS: personas_insert WITH CHECK (tenant_id = auth.uid()). Built-in (tenant NULL) içerik
  // yalnız service_role ile yazılır; portaldan oluşturulan içerik kullanıcının tenant'ına aittir.
  // Worker (service_role) RLS'siz okuduğu için bu satırları yine bulur.
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { id: null, error: 'Oturum bulunamadı' }

  const res = await supabase
    .from('personas')
    .insert({ ...input, tenant_id: userData.user.id })
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updatePersona(personaId: string, input: UpsertPersonaInput) {
  const res = await supabase
    .from('personas')
    .update(input)
    .eq('id', personaId)

  return {
    ok: !res.error,
    error: res.error?.message ?? null,
  }
}

export async function deletePersona(personaId: string) {
  const res = await supabase.from('personas').delete().eq('id', personaId)
  return { ok: !res.error, error: res.error?.message ?? null }
}
