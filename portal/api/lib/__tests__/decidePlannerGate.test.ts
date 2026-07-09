/**
 * D3a — planner.enabled=false byte-identical DECIDE çıktısı regresyon testi.
 */
import { describe, it, expect } from 'vitest'
import {
  buildDecideUserMessage,
  buildDecideSystemPrompt,
  parseDecideResponse,
  DECIDE_SYSTEM_PROMPT,
} from '../prompts/operationDecide.js'
import { createHash } from 'node:crypto'

const FIXTURE_OBS = {
  goalText:            'Stok tükenince sipariş ver',
  lastRunStatus:       'completed',
  lastVerifierOutcome: 'pass',
  consecutiveFails:    0,
  pendingApprovals:    0,
  stepCount:           2,
  maxSteps:            10,
  lastPlaybook:        'tedarik-arastirma',
  lastError:           null,
  lastResultSummary:   'Stok seviyesi düşük',
  availablePlaybooks:  ['tedarik-arastirma', 'tedarik-siparis', 'tedarik-kargo'],
  currentPhase:        'research',
  cargoPollCount:      0,
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

describe('decidePlannerGate — planner.enabled=false sıfır etki', () => {
  it('planner kapalıyken user message planner/untrusted bölümleri içermez', () => {
    const off = buildDecideUserMessage({ ...FIXTURE_OBS, plannerEnabled: false, untrustedTaint: false })
    const on  = buildDecideUserMessage({ ...FIXTURE_OBS, plannerEnabled: true, untrustedTaint: true })

    expect(off).not.toContain('Planlayıcı modu')
    expect(off).not.toContain('Untrusted taint')
    expect(on).toContain('Planlayıcı modu')
    expect(on).toContain('Untrusted taint')

    const offHash = sha256(off)
    const offAgain = sha256(buildDecideUserMessage({ ...FIXTURE_OBS, plannerEnabled: false }))
    expect(offAgain).toBe(offHash)
  })

  it('planner kapalıyken plan_step parse edilmez', () => {
    const raw = JSON.stringify({
      action: 'plan_step',
      reason: 'test',
      step_spec: { topic: 'x', tools_spec: 'tools: a', risk: 'R1' },
    })
    expect(parseDecideResponse(raw, false)).toBeNull()
    expect(parseDecideResponse(raw, true)?.action).toBe('plan_step')
  })

  it('planner kapalıyken system prompt hash değişmez (fallback base)', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [{ scope: 'base', content: DECIDE_SYSTEM_PROMPT }], error: null }),
        }),
      }),
    }
    const off = await buildDecideSystemPrompt(mockSupabase as never, 'base', false)
    const off2 = await buildDecideSystemPrompt(mockSupabase as never, 'base', false)
    expect(sha256(off)).toBe(sha256(off2))
    expect(off).not.toMatch(/plan_step/i)
  })
})
