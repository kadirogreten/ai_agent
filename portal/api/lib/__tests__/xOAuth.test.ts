import { describe, expect, it } from 'vitest'
import { XOAuthProvider } from '../social/providers/x.js'

describe('X OAuth provider', () => {
  it('createOAuthExtras includes PKCE verifier and challenge', () => {
    const p = new XOAuthProvider()
    const extras = p.createOAuthExtras()
    expect(typeof extras.codeVerifier).toBe('string')
    expect(typeof extras.codeChallenge).toBe('string')
    expect((extras.codeVerifier as string).length).toBeGreaterThan(10)
  })
})
