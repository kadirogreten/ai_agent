import { describe, it, expect } from 'vitest'
import {
  parseToolApproval,
  resolveCardKind,
  stripToolPrefix,
} from '../approvalCards'

describe('approvalCards', () => {
  it('stripToolPrefix removes tool: prefix', () => {
    expect(stripToolPrefix('tool:meta-social__post_publish')).toBe('meta-social__post_publish')
    expect(stripToolPrefix('purchase_order')).toBeNull()
  })

  it('parseToolApproval reads tool + args from action_detail', () => {
    const parsed = parseToolApproval({
      action_summary: 'tool:ads_campaign_activate',
      action_detail: {
        tool: 'ads_campaign_activate',
        args: { campaign_id: 'camp_demo_1' },
      },
    })
    expect(parsed.tool).toBe('ads_campaign_activate')
    expect(parsed.args).toEqual({ campaign_id: 'camp_demo_1' })
  })

  it('parseToolApproval falls back to action_summary prefix', () => {
    const parsed = parseToolApproval({
      action_summary: 'tool:social_reply_send',
      action_detail: null,
    })
    expect(parsed.tool).toBe('social_reply_send')
    expect(parsed.args).toBeNull()
  })

  it('resolveCardKind maps social tools', () => {
    expect(resolveCardKind('meta-social__post_publish')).toBe('post_preview')
    expect(resolveCardKind('social_reply_send')).toBe('post_preview')
    expect(resolveCardKind('ads_campaign_activate')).toBe('campaign_budget')
    expect(resolveCardKind('purchase_order')).toBe('generic')
    expect(resolveCardKind(null)).toBe('generic')
  })
})
