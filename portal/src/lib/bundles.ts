import { supabase } from '@/lib/supabaseClient'

export type PlaybookBundleRow = {
  id: string
  slug: string
  pack_id: string
  tenant_id: string | null
  name: string
  description: string | null
  playbook_slugs: string[]
  default_risk: 'R0' | 'R1' | 'R2' | 'R3'
  content_json: Record<string, unknown> | null
  version: number
  created_at: string
  updated_at: string
}

export type UpsertBundleInput = {
  slug: string
  pack_id: string
  name: string
  description: string | null
  playbook_slugs: string[]
  default_risk: 'R0' | 'R1' | 'R2' | 'R3'
  version: number
}

export async function listPlaybookBundles(params: { q: string; packId?: string; limit?: number }) {
  const limit = params.limit ?? 200
  let query = supabase
    .from('playbook_bundles')
    .select('id,slug,pack_id,tenant_id,name,description,playbook_slugs,default_risk,content_json,version,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (params.packId) query = query.eq('pack_id', params.packId)
  if (params.q.trim()) {
    const term = `%${params.q.trim()}%`
    query = query.or(`name.ilike.${term},slug.ilike.${term}`)
  }

  const res = await query
  return {
    data: (res.data ?? []) as PlaybookBundleRow[],
    error: res.error?.message ?? null,
  }
}

export async function getPlaybookBundle(bundleId: string) {
  const res = await supabase
    .from('playbook_bundles')
    .select('id,slug,pack_id,tenant_id,name,description,playbook_slugs,default_risk,content_json,version,created_at,updated_at')
    .eq('id', bundleId)
    .maybeSingle()
  return {
    data: (res.data ?? null) as PlaybookBundleRow | null,
    error: res.error?.message ?? null,
  }
}

export async function createPlaybookBundle(input: UpsertBundleInput) {
  const res = await supabase.from('playbook_bundles').insert(input).select('id').single()
  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updatePlaybookBundle(bundleId: string, input: UpsertBundleInput) {
  const res = await supabase.from('playbook_bundles').update(input).eq('id', bundleId)
  return { ok: !res.error, error: res.error?.message ?? null }
}

export async function deletePlaybookBundle(bundleId: string) {
  const res = await supabase.from('playbook_bundles').delete().eq('id', bundleId)
  return { ok: !res.error, error: res.error?.message ?? null }
}
