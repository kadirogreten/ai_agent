import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  generateApiKeyPlaintext,
  hashApiKey,
  isApiKeyBearer,
  API_KEY_PREFIX,
} from '../apiKeys.js'
import {
  applyPublicApiRiskFloor,
  maxRisk,
} from '../publicApiRisk.js'
import { resolvePublicApiGate } from '../publicApiGate.js'
import {
  checkPublicApiRateLimit,
  resetPublicApiRateLimitForTests,
} from '../publicApiRateLimit.js'
import {
  assertSafeWebhookUrl,
  dispatchOperationWebhooks,
  signWebhookBody,
  verifyWebhookSignature,
} from '../webhookDispatcher.js'

describe('D4c apiKeys', () => {
  it('generates aak_ keys and hashes deterministically', () => {
    const plain = generateApiKeyPlaintext()
    expect(plain.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(isApiKeyBearer(plain)).toBe(true)
    expect(isApiKeyBearer('eyJhbGciOi')).toBe(false)
    const h = hashApiKey(plain)
    expect(h).toBe(createHash('sha256').update(plain, 'utf8').digest('hex'))
    expect(h).toHaveLength(64)
  })
})

describe('D4c publicApiRisk', () => {
  it('applies R2 floor', () => {
    expect(applyPublicApiRiskFloor('R0')).toBe('R2')
    expect(applyPublicApiRiskFloor('R1')).toBe('R2')
    expect(applyPublicApiRiskFloor('R2')).toBe('R2')
    expect(applyPublicApiRiskFloor('R3')).toBe('R3')
    expect(maxRisk('R1', 'R3')).toBe('R3')
  })
})

describe('D4c publicApiGate', () => {
  it('returns 503 when disabled (born closed)', () => {
    expect(resolvePublicApiGate(false)).toEqual({
      allowed: false,
      status: 503,
      error: 'public_api_disabled',
    })
    expect(resolvePublicApiGate(true).allowed).toBe(true)
  })
})

describe('D4c rateLimit', () => {
  it('returns 429 path when over limit', () => {
    resetPublicApiRateLimitForTests()
    const id = 'key-test-1'
    expect(checkPublicApiRateLimit(id, 2)).toBe(true)
    expect(checkPublicApiRateLimit(id, 2)).toBe(true)
    expect(checkPublicApiRateLimit(id, 2)).toBe(false)
  })
})

describe('D4c webhookDispatcher', () => {
  it('signs and verifies HMAC', () => {
    const secret = 'whsec_test'
    const body = JSON.stringify({ event: 'operation.done' })
    const sig = signWebhookBody(secret, body)
    expect(sig.startsWith('sha256=')).toBe(true)
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true)
    expect(verifyWebhookSignature(secret, body, 'sha256=deadbeef')).toBe(false)
  })

  it('rejects http and private URLs', () => {
    expect(() => assertSafeWebhookUrl('http://example.com/h')).toThrow(/https/)
    expect(() => assertSafeWebhookUrl('https://127.0.0.1/h')).toThrow(/private/)
    expect(() => assertSafeWebhookUrl('https://10.0.0.1/h')).toThrow(/private/)
    expect(() => assertSafeWebhookUrl('https://localhost/h')).toThrow(/private|local/)
    expect(() => assertSafeWebhookUrl('https://example.com/hooks')).not.toThrow()
  })

  it('skips webhook for non-public_api ops', async () => {
    const supabase = {
      from: () => {
        throw new Error('should not query webhooks for internal ops')
      },
    }
    const out = await dispatchOperationWebhooks(
      supabase as never,
      {
        id: 'op-1',
        owner_user_id: 'u-1',
        goal_text: 'internal',
        domain_pack: 'x',
        status: 'done',
        context_json: { source: 'portal' },
      },
      'operation.done',
    )
    expect(out.skipped).toBe(true)
    expect(out.attempted).toBe(0)
  })

  it('dispatches signed POST for public_api ops', async () => {
    const secret = 'whsec_abc'
    const calls: Array<{ url: string; headers: HeadersInit; body: string }> = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as HeadersInit,
        body: String(init?.body),
      })
      return { ok: true, status: 200 } as Response
    }) as typeof fetch

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: [{
                id: 'wh-1',
                url: 'https://hooks.example.com/aa',
                secret_enc: `plain:${secret}`,
                events: ['operation.done'],
                enabled: true,
              }],
              error: null,
            }),
          }),
        }),
      }),
    }

    const out = await dispatchOperationWebhooks(
      supabase as never,
      {
        id: 'op-pub',
        owner_user_id: 'u-1',
        goal_text: 'ext',
        domain_pack: 'pack',
        status: 'done',
        context_json: { source: 'public_api' },
      },
      'operation.done',
      fetchFn,
    )

    expect(out.skipped).toBe(false)
    expect(out.attempted).toBe(1)
    expect(out.ok).toBe(1)
    expect(calls).toHaveLength(1)
    const headers = calls[0]!.headers as Record<string, string>
    expect(headers['X-AgentArmy-Signature']).toBe(
      signWebhookBody(secret, calls[0]!.body),
    )
  })
})
