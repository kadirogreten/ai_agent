import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { strArg } from '@/lib/approvalCards'

type LedgerRow = {
  platform: string
  daily_budget: number
  total_budget_cap: number
  currency: string
  status: string
  spent: number
}

type Props = {
  args: Record<string, unknown> | null
}

function fmtMoney(v: number | null | undefined, currency: string | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency ?? 'TRY'}`
}

export function CampaignBudgetCard({ args }: Props) {
  const campaignId = strArg(args, 'campaign_id')
  const [ledger, setLedger] = useState<LedgerRow | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(!!campaignId)

  useEffect(() => {
    if (!campaignId) {
      setLoading(false)
      setLedger(null)
      setMissing(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('ad_spend_ledger')
      .select('platform,daily_budget,total_budget_cap,currency,status,spent')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setLedger(null)
          setMissing(true)
        } else {
          setLedger(data as LedgerRow)
          setMissing(false)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [campaignId])

  return (
    <div className="rounded-xl border border-red-500/20 bg-black/25 overflow-hidden">
      <div className="flex items-start gap-2 border-b border-red-500/15 bg-red-500/10 px-3 py-2">
        <AlertTriangle size={16} className="shrink-0 text-red-400 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-red-300">Bu onay para harcar</p>
          <p className="text-xs text-red-300/70">Kampanya aktivasyonu (R3) — günlük bütçe üzerinden harcama başlar.</p>
        </div>
      </div>
      <div className="px-3 py-3 space-y-2 text-sm">
        <div className="flex gap-2 text-xs">
          <span className="text-white/35 w-28 shrink-0">Kampanya</span>
          <span className="font-mono text-white/70 break-all">{campaignId ?? '—'}</span>
        </div>
        {loading && (
          <p className="text-xs text-white/35 animate-pulse">Ledger yükleniyor…</p>
        )}
        {!loading && missing && (
          <p className="text-xs text-amber-400/90">Ledger kaydı bulunamadı — onay/red yine uygulanabilir.</p>
        )}
        {!loading && ledger && (
          <div className="grid gap-1.5 text-xs border-t border-white/[0.06] pt-2 mt-1">
            <Row label="Platform" value={ledger.platform} />
            <Row label="Günlük bütçe" value={fmtMoney(ledger.daily_budget, ledger.currency)} />
            <Row label="Toplam cap" value={fmtMoney(ledger.total_budget_cap, ledger.currency)} />
            <Row label="Harcanan (demo)" value={fmtMoney(ledger.spent, ledger.currency)} />
            <Row label="Durum" value={ledger.status} />
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-white/35 w-28 shrink-0">{label}</span>
      <span className="text-white/70">{value}</span>
    </div>
  )
}
