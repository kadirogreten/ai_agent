/**
 * D4d — Usage summary helpers + owner-scoped view readers.
 * Eval dışlama SQL ile aynı anlam: (meta->>'eval') IS DISTINCT FROM 'true'
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPolicy } from './policyReader.js'

/** Same semantics as SQL: (meta->>'eval') IS DISTINCT FROM 'true' */
export function isEvalMeta(meta: unknown): boolean {
  if (meta == null || typeof meta !== 'object') return false
  const ev = (meta as Record<string, unknown>).eval
  return ev === true || ev === 'true'
}

export type RunUsageRow = {
  owner_user_id?: string
  cost_usd?: number | null
  tokens_in?: number | null
  tokens_out?: number | null
  meta?: unknown
}

/** Aggregate billable runs only (eval excluded). Pure — mirrors usage_monthly filter. */
export function aggregateBillableRuns(rows: RunUsageRow[]): {
  run_count: number
  llm_cost_usd: number
  tokens_in: number
  tokens_out: number
} {
  let run_count = 0
  let llm_cost_usd = 0
  let tokens_in = 0
  let tokens_out = 0
  for (const r of rows) {
    if (isEvalMeta(r.meta)) continue
    run_count++
    llm_cost_usd += Number(r.cost_usd ?? 0)
    tokens_in += Number(r.tokens_in ?? 0)
    tokens_out += Number(r.tokens_out ?? 0)
  }
  return { run_count, llm_cost_usd, tokens_in, tokens_out }
}

export type LlmMonthRow = {
  period_month: string
  domain_pack: string | null
  run_count: number
  llm_cost_usd: number
  tokens_in: number
  tokens_out: number
}

export type AdsMonthRow = {
  period_month: string
  platform: string
  currency: string
  spent: number
  campaign_count: number
}

/** Keep LLM (USD) and ads (multi-currency) as separate blocks — never sum currencies. */
export function partitionUsageBlocks(llm: LlmMonthRow[], ads: AdsMonthRow[]) {
  return {
    llm,
    ads,
    currencies: {
      llm: 'USD' as const,
      ads: [...new Set(ads.map((a) => a.currency))],
    },
  }
}

export type BudgetTone = 'ok' | 'amber' | 'red' | 'unlimited'

export function computeBudgetStatus(
  spentUsd: number,
  budgetUsd: number | null | undefined,
  alertThresholdPct: number,
): {
  unlimited: boolean
  budget_usd: number | null
  used_pct: number | null
  remaining_usd: number | null
  tone: BudgetTone
} {
  if (budgetUsd == null || Number.isNaN(Number(budgetUsd)) || Number(budgetUsd) <= 0) {
    return {
      unlimited: true,
      budget_usd: null,
      used_pct: null,
      remaining_usd: null,
      tone: 'unlimited',
    }
  }
  const budget = Number(budgetUsd)
  const used_pct = (spentUsd / budget) * 100
  const remaining_usd = Math.max(0, budget - spentUsd)
  const alert = alertThresholdPct > 0 ? alertThresholdPct : 80
  let tone: BudgetTone = 'ok'
  if (used_pct >= 100) tone = 'red'
  else if (used_pct >= alert) tone = 'amber'
  return { unlimited: false, budget_usd: budget, used_pct, remaining_usd, tone }
}

function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

function monthsAgoStart(months: number): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (months - 1))
  return d.toISOString().slice(0, 10)
}

export async function fetchUsageSummary(
  supabase: SupabaseClient,
  ownerUserId: string,
  months = 6,
): Promise<ReturnType<typeof partitionUsageBlocks>> {
  const since = monthsAgoStart(Math.min(24, Math.max(1, months)))

  const [llmRes, adsRes] = await Promise.all([
    supabase
      .from('usage_monthly')
      .select('period_month, domain_pack, run_count, llm_cost_usd, tokens_in, tokens_out')
      .eq('owner_user_id', ownerUserId)
      .gte('period_month', since)
      .order('period_month', { ascending: true }),
    supabase
      .from('ad_spend_monthly')
      .select('period_month, platform, currency, spent, campaign_count')
      .eq('owner_user_id', ownerUserId)
      .gte('period_month', since)
      .order('period_month', { ascending: true }),
  ])

  if (llmRes.error) throw new Error(llmRes.error.message)
  if (adsRes.error) throw new Error(adsRes.error.message)

  const llm = (llmRes.data ?? []).map((r) => ({
    period_month: String(r.period_month).slice(0, 10),
    domain_pack: r.domain_pack as string | null,
    run_count: Number(r.run_count ?? 0),
    llm_cost_usd: Number(r.llm_cost_usd ?? 0),
    tokens_in: Number(r.tokens_in ?? 0),
    tokens_out: Number(r.tokens_out ?? 0),
  }))

  const ads = (adsRes.data ?? []).map((r) => ({
    period_month: String(r.period_month).slice(0, 10),
    platform: String(r.platform),
    currency: String(r.currency ?? 'TRY'),
    spent: Number(r.spent ?? 0),
    campaign_count: Number(r.campaign_count ?? 0),
  }))

  return partitionUsageBlocks(llm, ads)
}

export async function fetchUsageCurrent(
  supabase: SupabaseClient,
  ownerUserId: string,
) {
  const period = monthStartIso()
  const { data, error } = await supabase
    .from('usage_monthly')
    .select('run_count, llm_cost_usd, tokens_in, tokens_out')
    .eq('owner_user_id', ownerUserId)
    .eq('period_month', period)

  if (error) throw new Error(error.message)

  const rows = data ?? []
  const llm_cost_usd = rows.reduce((s, r) => s + Number(r.llm_cost_usd ?? 0), 0)
  const tokens_in = rows.reduce((s, r) => s + Number(r.tokens_in ?? 0), 0)
  const tokens_out = rows.reduce((s, r) => s + Number(r.tokens_out ?? 0), 0)
  const run_count = rows.reduce((s, r) => s + Number(r.run_count ?? 0), 0)

  const budgetRaw = await getPolicy<number | null>(
    supabase,
    ownerUserId,
    'billing.monthly_llm_budget_usd',
    null,
  )
  const alertThresholdPct = await getPolicy<number>(
    supabase,
    ownerUserId,
    'billing.alert_threshold_pct',
    80,
  )

  const budget =
    budgetRaw === null || budgetRaw === undefined
      ? null
      : Number(budgetRaw)

  const status = computeBudgetStatus(
    llm_cost_usd,
    Number.isFinite(budget as number) ? budget : null,
    Number(alertThresholdPct) || 80,
  )

  return {
    period_month: period,
    llm_cost_usd,
    tokens_in,
    tokens_out,
    run_count,
    alert_threshold_pct: Number(alertThresholdPct) || 80,
    ...status,
  }
}
