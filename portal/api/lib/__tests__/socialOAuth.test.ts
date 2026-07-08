import { describe, expect, it } from 'vitest'
import { signOAuthState, verifyOAuthState } from '../social/providers/meta.js'

describe('oauth state', () => {
  it('signs and verifies payload without token in state', () => {
    const state = signOAuthState({
      userId: 'user-1',
      provider: 'meta',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    expect(state).not.toContain('access')
    const payload = verifyOAuthState(state)
    expect(payload?.userId).toBe('user-1')
    expect(payload?.provider).toBe('meta')
  })
})
