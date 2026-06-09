import { supabase } from '@/lib/supabaseClient'

// Tedarik rapor panosu verisi — tamamen DB'den dinamik.
// Kaynaklar:
//  - run_requests (stok tetikleri / araştırma işleri)  → answers_json.stock_trigger_product
//  - tool_invocations (purchase_order / cargo_track)    → output jsonb içinde tüm detay
//  - approval_queue (bekleyen satın alma onayları)

export type StockTrigger = {
  id: string
  product: string
  current_stock: number | null
  threshold: number | null
  reorder_quantity: number | null
  status: string
  created_at: string
}

export type OrderRow = {
  id: string
  order_id: string | null
  product: string | null
  supplier: string | null
  quantity: number | null
  total: number | null
  currency: string | null
  tracking_number: string | null
  carrier: string | null
  estimated_delivery: string | null
  status: string // succeeded | blocked
  created_at: string
}

export type CargoRow = {
  id: string
  tracking_number: string | null
  carrier: string | null
  status: string | null
  estimated_delivery: string | null
  created_at: string
}

export type PendingApproval = {
  id: string
  action_summary: string
  risk_level: string | null
  created_at: string
}

export type TedarikReport = {
  triggers: StockTrigger[]
  orders: OrderRow[]
  cargo: CargoRow[]
  pendingApprovals: PendingApproval[]
  error: string | null
}

export async function decideApproval(approvalId: string, decision: 'approved' | 'rejected') {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Oturum bulunamadı' }
  const { error } = await supabase.rpc('decide_approval', {
    p_approval_id: approvalId,
    p_reviewer_id: userData.user.id,
    p_decision: decision,
    p_reviewer_note: null,
  })
  return { ok: !error, error: error?.message ?? null }
}

type Json = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export async function fetchTedarikReport(): Promise<TedarikReport> {
  const errors: string[] = []

  // 1) Stok tetikleri / araştırma işleri
  const rr = await supabase
    .from('run_requests')
    .select('id, request_text, status, answers_json, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (rr.error) errors.push(rr.error.message)
  const triggers: StockTrigger[] = (rr.data ?? [])
    .filter((r) => {
      const a = (r.answers_json ?? {}) as Json
      return typeof a.stock_trigger_product === 'string'
    })
    .map((r) => {
      const a = (r.answers_json ?? {}) as Json
      return {
        id: r.id as string,
        product: (a.stock_trigger_product as string) ?? '—',
        current_stock: num(a.current_stock),
        threshold: num(a.threshold),
        reorder_quantity: num(a.reorder_quantity),
        status: (r.status as string) ?? 'pending',
        created_at: r.created_at as string,
      }
    })

  // 2) Satın alma siparişleri (purchase_order çağrıları)
  const po = await supabase
    .from('tool_invocations')
    .select('id, output, status, created_at')
    .eq('tool_slug', 'purchase_order')
    .order('created_at', { ascending: false })
    .limit(100)
  if (po.error) errors.push(po.error.message)
  const seenOrder = new Set<string>()
  const orders: OrderRow[] = (po.data ?? [])
    .map((iv) => {
      const o = (iv.output ?? {}) as Json
      return {
        id: iv.id as string,
        order_id: str(o.order_id),
        product: str(o.product),
        supplier: str(o.supplier),
        quantity: num(o.quantity),
        total: num(o.total),
        currency: str(o.currency),
        tracking_number: str(o.tracking_number),
        carrier: str(o.carrier),
        estimated_delivery: str(o.estimated_delivery),
        status: (iv.status as string) ?? 'pending',
        created_at: iv.created_at as string,
      }
    })
    // Aynı sipariş no'yu tekilleştir (en günceli kalır — created_at desc sıralı geldi).
    .filter((o) => {
      if (!o.order_id) return true
      if (seenOrder.has(o.order_id)) return false
      seenOrder.add(o.order_id)
      return true
    })

  // 3) Kargo takibi (cargo_track çağrıları)
  const ct = await supabase
    .from('tool_invocations')
    .select('id, output, status, created_at')
    .eq('tool_slug', 'cargo_track')
    .order('created_at', { ascending: false })
    .limit(100)
  if (ct.error) errors.push(ct.error.message)
  const seenTrack = new Set<string>()
  const cargo: CargoRow[] = (ct.data ?? [])
    .map((iv) => {
      const o = (iv.output ?? {}) as Json
      return {
        id: iv.id as string,
        tracking_number: str(o.tracking_number),
        carrier: str(o.carrier),
        status: str(o.status),
        estimated_delivery: str(o.estimated_delivery),
        created_at: iv.created_at as string,
      }
    })
    // Aynı takip no'yu tekilleştir (en güncel durum kalır).
    .filter((c) => {
      if (!c.tracking_number) return true
      if (seenTrack.has(c.tracking_number)) return false
      seenTrack.add(c.tracking_number)
      return true
    })

  // 4) Bekleyen satın alma onayları
  const aq = await supabase
    .from('approval_queue')
    .select('id, action_summary, status, risk_level, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)
  if (aq.error) errors.push(aq.error.message)
  const pendingApprovals: PendingApproval[] = (aq.data ?? [])
    .filter((a) => ((a.action_summary as string) ?? '').includes('purchase_order'))
    .map((a) => ({
      id: a.id as string,
      action_summary: (a.action_summary as string) ?? 'tool:purchase_order',
      risk_level: str(a.risk_level),
      created_at: a.created_at as string,
    }))

  return { triggers, orders, cargo, pendingApprovals, error: errors[0] ?? null }
}
