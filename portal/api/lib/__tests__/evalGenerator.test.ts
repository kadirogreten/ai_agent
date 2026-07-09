import { describe, it, expect } from 'vitest'
import { buildD0Cases, buildRubricCases, generateEvalJsonFromDraft } from '../evalGenerator.js'

describe('evalGenerator D2b', () => {
  const draft = {
    id: 'test-pack',
    name: 'Test Pack',
    playbooks: [
      {
        slug: 'inbox-triage',
        name: 'Inbox Triage',
        goal: 'Gelen kutusunu sınıflandır',
        required_tools: ['social_inbox_fetch', 'social_reply_send', 'file_store'],
      },
    ],
  }

  it('buildD0Cases produces >= 4 security cases', () => {
    const cases = buildD0Cases(draft, 'test-pack')
    expect(cases.length).toBeGreaterThanOrEqual(4)
    expect(cases.every((c) => c.expect.source === 'd0_security')).toBe(true)
  })

  it('generateEvalJsonFromDraft has isolated context and source_mix', () => {
    const evalJson = generateEvalJsonFromDraft(draft, 'test-pack')
    expect(evalJson.generator_context).toBe('isolated')
    expect(evalJson.source_mix.d0_security).toBeGreaterThanOrEqual(4)
    expect(evalJson.source_mix.pack_rubric).toBeGreaterThanOrEqual(1)
  })

  it('buildRubricCases uses pack playbooks', () => {
    const cases = buildRubricCases(draft, 'test-pack')
    expect(cases.length).toBeGreaterThanOrEqual(1)
    expect(cases[0].expect.source).toBe('pack_rubric')
  })
})
