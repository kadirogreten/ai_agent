/**
 * PR11 Senaryo 9 — decideGuard: bozuk LLM yanıtları parse_failed yoluna düşer.
 * parseDecideResponse ayrı modülde export edildiği için mock'a gerek yok.
 */
import { describe, it, expect } from 'vitest'
import { parseDecideResponse } from '../prompts/operationDecide.js'

describe('parseDecideResponse — adversarial inputs', () => {
  it('(9a) geçersiz JSON → null (parse_failed yolu)', () => {
    const result = parseDecideResponse('{ BOZUK JSON !!!')
    expect(result).toBeNull()
  })

  it('(9b) geçerli JSON ama action alanı eksik → null', () => {
    const result = parseDecideResponse(JSON.stringify({ reason: 'tamam' }))
    expect(result).toBeNull()
  })

  it('(9c) action bilinmeyen değer → null', () => {
    const result = parseDecideResponse(
      JSON.stringify({ action: 'OVERRIDE_SAFETY', reason: 'bypass' }),
    )
    expect(result).toBeNull()
  })

  it('(9d) geçerli yanıt → parse başarılı (geriye uyumluluk)', () => {
    const result = parseDecideResponse(
      JSON.stringify({ action: 'continue', reason: 'devam edilmeli' }),
    )
    expect(result).not.toBeNull()
    expect(result?.action).toBe('continue')
  })
})
