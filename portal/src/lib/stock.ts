import { supabase } from '@/lib/supabaseClient'

export type StockRow = {
  id: string
  owner_user_id: string
  product: string
  sku: string | null
  current_stock: number
  threshold: number
  target_stock: number
  warehouse: string | null
  source: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export type UpsertStockInput = {
  product: string
  sku?: string | null
  current_stock: number
  threshold: number
  target_stock?: number
  warehouse?: string | null
  enabled?: boolean
}

export async function listStock() {
  const res = await supabase
    .from('stock_levels')
    .select('*')
    .order('product', { ascending: true })
    .limit(500)
  return {
    data: (res.data ?? []) as StockRow[],
    error: res.error?.message ?? null,
  }
}

export async function createStock(input: UpsertStockInput) {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { id: null, error: 'Oturum bulunamadı' }

  const res = await supabase
    .from('stock_levels')
    .insert({
      owner_user_id: userData.user.id,
      product:       input.product,
      sku:           input.sku ?? null,
      current_stock: input.current_stock,
      threshold:     input.threshold,
      target_stock:  input.target_stock ?? 0,
      warehouse:     input.warehouse ?? null,
      enabled:       input.enabled ?? true,
      source:        'manual',
    })
    .select('id')
    .single()

  return {
    id: (res.data?.id as string | undefined) ?? null,
    error: res.error?.message ?? null,
  }
}

export async function updateStock(id: string, patch: Partial<UpsertStockInput>) {
  const res = await supabase.from('stock_levels').update(patch).eq('id', id)
  return { ok: !res.error, error: res.error?.message ?? null }
}

export async function toggleStock(id: string, enabled: boolean) {
  const res = await supabase.from('stock_levels').update({ enabled }).eq('id', id)
  return { ok: !res.error, error: res.error?.message ?? null }
}

export async function deleteStock(id: string) {
  const res = await supabase.from('stock_levels').delete().eq('id', id)
  return { ok: !res.error, error: res.error?.message ?? null }
}
