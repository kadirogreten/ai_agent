/**
 * PR-S7a: App-level AES-256-GCM token şifreleme.
 * Format (base64): nonce(12) || ciphertext || tag(16) — C# CredentialResolver ile uyumlu.
 * Anahtar: SOCIAL_TOKEN_ENC_KEY (32 byte, base64).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const NONCE_LEN = 12
const TAG_LEN   = 16

function loadKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_ENC_KEY
  if (!raw?.trim()) {
    throw new Error('SOCIAL_TOKEN_ENC_KEY eksik (32 byte base64)')
  }
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) {
    throw new Error('SOCIAL_TOKEN_ENC_KEY 32 byte olmalı (base64)')
  }
  return key
}

export function encryptToken(plaintext: string): string {
  const key   = loadKey()
  const nonce = randomBytes(NONCE_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return Buffer.concat([nonce, enc, tag]).toString('base64')
}

export function decryptToken(ciphertextB64: string): string {
  const key  = loadKey()
  const buf  = Buffer.from(ciphertextB64, 'base64')
  if (buf.length < NONCE_LEN + TAG_LEN + 1) {
    throw new Error('Geçersiz ciphertext')
  }
  const nonce      = buf.subarray(0, NONCE_LEN)
  const tag        = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(NONCE_LEN, buf.length - TAG_LEN)
  const decipher   = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Test/dev: anahtar yoksa şifrelemeyi atla (yalnız unit test). */
export function encryptTokenOptional(plaintext: string): string {
  if (!process.env.SOCIAL_TOKEN_ENC_KEY?.trim()) return `plain:${plaintext}`
  return encryptToken(plaintext)
}
