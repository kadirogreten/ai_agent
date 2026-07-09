import { describe, it, expect } from 'vitest'
import { sanitizePlanStepSpec, type ToolMeta } from '../planStepSanitizer.js'

const toolMeta = new Map<string, ToolMeta>([
  ['social_inbox_fetch', { slug: 'social_inbox_fetch', side_effect: 'read', min_risk: 'R1' }],
  ['social_reply_send',  { slug: 'social_reply_send', side_effect: 'write', min_risk: 'R2' }],
  ['file_store',         { slug: 'file_store', side_effect: 'write', min_risk: 'R2' }],
  ['ads_campaign_pause', { slug: 'ads_campaign_pause', side_effect: 'write', min_risk: 'R2', compensation: 'pause' }],
])

describe('sanitizePlanStepSpec — untrusted taint → R3', () => {
  it('untrusted taint yokken risk korunur', () => {
    const spec = sanitizePlanStepSpec(
      { topic: 'yanıt', tools_spec: 'tools: social_reply_send; max_calls: 5', risk: 'R2' },
      false,
      toolMeta,
    )
    expect(spec.risk).toBe('R2')
  })

  it('untrusted taint altında yan etkili araç → min R3', () => {
    const spec = sanitizePlanStepSpec(
      { topic: 'dışa gönder', tools_spec: 'tools: file_store; max_calls: 5', risk: 'R1' },
      true,
      toolMeta,
    )
    expect(spec.risk).toBe('R3')
  })

  it('untrusted taint + yalnız read araç → R3 zorunlu değil', () => {
    const spec = sanitizePlanStepSpec(
      { topic: 'oku', tools_spec: 'tools: social_inbox_fetch; max_calls: 5', risk: 'R1' },
      true,
      toolMeta,
    )
    expect(spec.risk).toBe('R1')
  })
})
