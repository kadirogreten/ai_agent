import { describe, expect, it } from 'vitest'
import { encryptToken, decryptToken } from '../tokenEncryptor.js'

describe('tokenEncryptor', () => {
  const key = Buffer.alloc(32, 7).toString('base64')

  it('round-trips without leaking plaintext in ciphertext', () => {
    const prev = process.env.SOCIAL_TOKEN_ENC_KEY
    process.env.SOCIAL_TOKEN_ENC_KEY = key
    try {
      const plain = 'meta_oauth_access_xyz'
      const cipher = encryptToken(plain)
      expect(cipher).not.toContain(plain)
      expect(decryptToken(cipher)).toBe(plain)
    } finally {
      process.env.SOCIAL_TOKEN_ENC_KEY = prev
    }
  })
})
