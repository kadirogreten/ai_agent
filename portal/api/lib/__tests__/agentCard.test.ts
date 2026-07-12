import { describe, it, expect } from 'vitest'
import {
  A2A_CARD_CACHE_CONTROL,
  buildAgentCardFromRows,
  isPackA2aPublic,
  playbookToSkill,
  sanitizePublicDescription,
  validateAgentCard,
} from '../agentCard.js'

describe('agentCard D4b', () => {
  it('sanitizePublicDescription strips tools: lines and truncates', () => {
    const d = sanitizePublicDescription(
      'Public inbox triage.\ntools: file_store, purchase_order\nHelp users.',
      'fallback',
    )
    expect(d).not.toMatch(/file_store/)
    expect(d).toContain('Public inbox')
    expect(d.length).toBeLessThanOrEqual(280)
  })

  it('playbookToSkill sets R3 human approval and omits required_tools', () => {
    const skill = playbookToSkill({
      slug: 'risky-act',
      name: 'Risky Act',
      description: 'Do a sensitive write',
      goal: null,
      default_risk: 'R3',
      tags: ['write'],
    })
    expect(skill['x-agentarmy.risk']).toBe('R3')
    expect(skill['x-agentarmy.requires_human_approval']).toBe(true)
    expect(skill).not.toHaveProperty('required_tools')
    expect(skill).not.toHaveProperty('system_prompt')
  })

  it('buildAgentCardFromRows is public-safe and validates', () => {
    const card = buildAgentCardFromRows({
      pack: {
        id: 'demo-pack',
        name: 'Demo Pack',
        description: 'Public social assist',
        status: 'active',
        version: 2,
        meta: { a2a_public: true },
      },
      playbooks: [
        {
          slug: 'inbox-triage',
          name: 'Inbox Triage',
          description: 'Classify and draft replies',
          goal: null,
          default_risk: 'R1',
          tags: ['social'],
        },
      ],
      personas: [
        { slug: 'operator', name: 'Operator' },
      ],
      baseUrl: 'https://agentarmy.example.com',
    })

    expect(card.url).toBe('https://agentarmy.example.com/api/a2a')
    expect(card.skills).toHaveLength(1)
    expect(card.additionalInterfaces?.[0]).toEqual({ slug: 'operator', name: 'Operator' })

    const json = JSON.stringify(card)
    expect(json).not.toContain('system_prompt')
    expect(json).not.toContain('required_tools')
    expect(json).not.toContain('glossary_md')

    const v = validateAgentCard(card)
    expect(v).toEqual({ ok: true })
  })

  it('validateAgentCard rejects leaked system_prompt on skill', () => {
    const card = buildAgentCardFromRows({
      pack: {
        id: 'x',
        name: 'X',
        description: 'd',
        status: 'active',
        version: 1,
        meta: {},
      },
      playbooks: [{
        slug: 'a',
        name: 'A',
        description: 'ok',
        goal: null,
        default_risk: 'R1',
        tags: [],
      }],
      personas: [],
      baseUrl: 'https://ex.com',
    }) as Record<string, unknown>
    ;(card.skills as Record<string, unknown>[])[0].system_prompt = 'SECRET'
    const v = validateAgentCard(card)
    expect(v.ok).toBe(false)
  })

  it('isPackA2aPublic and cache header constant', () => {
    expect(isPackA2aPublic({ a2a_public: true })).toBe(true)
    expect(isPackA2aPublic({ a2a_public: false })).toBe(false)
    expect(isPackA2aPublic({})).toBe(false)
    expect(A2A_CARD_CACHE_CONTROL).toBe('public, max-age=300')
  })
})
