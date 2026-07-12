import { describe, expect, it } from 'vitest'
import {
  aggregateBillableRuns,
  computeBudgetStatus,
  isEvalMeta,
  partitionUsageBlocks,
} from '../usageSummary.js'

describe('D4d usageSummary — eval dışlama (D1→billing)', () => {
  it('isEvalMeta matches SQL IS DISTINCT FROM true semantics', () => {
    expect(isEvalMeta({ eval: true })).toBe(true)
    expect(isEvalMeta({ eval: 'true' })).toBe(true)
    expect(isEvalMeta({ eval: false })).toBe(false)
    expect(isEvalMeta({})).toBe(false)
    expect(isEvalMeta(null)).toBe(false)
    expect(isEvalMeta(undefined)).toBe(false)
  })

  it('aggregateBillableRuns excludes meta.eval=true from cost/count/tokens', () => {
    const agg = aggregateBillableRuns([
      { cost_usd: 1.5, tokens_in: 100, tokens_out: 50, meta: { eval: true } },
      { cost_usd: 0.25, tokens_in: 10, tokens_out: 5, meta: null },
      { cost_usd: 0.75, tokens_in: 20, tokens_out: 8, meta: { eval: false } },
      { cost_usd: 2.0, tokens_in: 200, tokens_out: 80, meta: { eval: 'true' } },
    ])
    expect(agg.run_count).toBe(2)
    expect(agg.llm_cost_usd).toBeCloseTo(1.0)
    expect(agg.tokens_in).toBe(30)
    expect(agg.tokens_out).toBe(13)
  })

  it('eval-only set yields zero billable totals (müşteri faturasına yansımaz)', () => {
    const agg = aggregateBillableRuns([
      { cost_usd: 9.99, tokens_in: 999, tokens_out: 999, meta: { eval: true } },
    ])
    expect(agg).toEqual({
      run_count: 0,
      llm_cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
    })
  })
})

describe('D4d usageSummary — LLM vs ads', () => {
  it('partitionUsageBlocks keeps currencies separate (never sums USD+TRY)', () => {
    const blocks = partitionUsageBlocks(
      [{
        period_month: '2026-07-01',
        domain_pack: 'sosyal-medya',
        run_count: 2,
        llm_cost_usd: 1.23,
        tokens_in: 10,
        tokens_out: 5,
      }],
      [{
        period_month: '2026-07-01',
        platform: 'meta',
        currency: 'TRY',
        spent: 100,
        campaign_count: 1,
      }],
    )
    expect(blocks.currencies.llm).toBe('USD')
    expect(blocks.currencies.ads).toEqual(['TRY'])
    expect(blocks.llm[0]!.llm_cost_usd).toBe(1.23)
    expect(blocks.ads[0]!.spent).toBe(100)
    // No combined total field that would mix currencies
    expect('total' in blocks).toBe(false)
  })
})

describe('D4d usageSummary — budget status', () => {
  it('null budget → unlimited', () => {
    const s = computeBudgetStatus(12, null, 80)
    expect(s.unlimited).toBe(true)
    expect(s.tone).toBe('unlimited')
    expect(s.used_pct).toBeNull()
  })

  it('amber at alert threshold, red at 100%', () => {
    expect(computeBudgetStatus(80, 100, 80).tone).toBe('amber')
    expect(computeBudgetStatus(79, 100, 80).tone).toBe('ok')
    expect(computeBudgetStatus(100, 100, 80).tone).toBe('red')
    expect(computeBudgetStatus(150, 100, 80).tone).toBe('red')
  })
})
