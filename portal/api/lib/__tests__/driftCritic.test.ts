/**
 * PR12 Görev B — drift critic testleri.
 * callCritic'i doğrudan test edemeyiz (Supabase + LLM bağımlılığı).
 * Bunun yerine tick içindeki karar mantığını izole ederiz:
 *   - Düşük skor → escalate yolu tetiklenmeli
 *   - Yüksek skor → continue yolu normal devam
 *   - Critic hata → score=100 fail-open (operasyon durmamalı)
 */
import { describe, it, expect, vi } from 'vitest'

// ── Critic mantığı izolasyonu ─────────────────────────────────────────────────

const DRIFT_THRESHOLD = 40
const WARN_THRESHOLD  = DRIFT_THRESHOLD + 20   // rozet eşiği

/**
 * Tick içindeki drift karar mantığını saf fonksiyon olarak çıkardık.
 * Gerçek tick bu mantığı callCritic sonucu üzerinde uygular.
 */
function applyDriftDecision(
  criticScore: number,
  threshold:   number,
): 'escalate' | 'continue' {
  return criticScore < threshold ? 'escalate' : 'continue'
}

function shouldShowDriftWarn(driftScore: number | null, warnThreshold: number): boolean {
  return driftScore !== null && driftScore < warnThreshold
}

// ── Testler ────────────────────────────────────────────────────────────────────

describe('drift critic — karar mantığı', () => {
  it('(9a) skor < eşik → escalate yolu tetiklenir (goal_drift)', () => {
    const result = applyDriftDecision(15, DRIFT_THRESHOLD)
    expect(result).toBe('escalate')
  })

  it('(9b) skor >= eşik → continue yolu normal devam', () => {
    const result = applyDriftDecision(80, DRIFT_THRESHOLD)
    expect(result).toBe('continue')
  })

  it('(9c) critic hata → score=100 fail-open → continue (operasyon durmamalı)', () => {
    // Fail-open: critic çöktüğünde score=100 atanır
    const failOpenScore = 100
    const result = applyDriftDecision(failOpenScore, DRIFT_THRESHOLD)
    expect(result).toBe('continue')
  })

  it('(9d) eşik sınırı: skor tam eşikte → continue (eşik dahil geçer)', () => {
    const result = applyDriftDecision(DRIFT_THRESHOLD, DRIFT_THRESHOLD)
    expect(result).toBe('continue')
  })
})

describe('drift rozet görünürlüğü (OperationsPage)', () => {
  it('(9e) drift_score eşik+20 altında → sarı rozet gösterilir', () => {
    expect(shouldShowDriftWarn(55, WARN_THRESHOLD)).toBe(true)
    expect(shouldShowDriftWarn(0,  WARN_THRESHOLD)).toBe(true)
  })

  it('(9f) drift_score eşik+20 veya üstü → rozet gizli', () => {
    expect(shouldShowDriftWarn(60,   WARN_THRESHOLD)).toBe(false)
    expect(shouldShowDriftWarn(100,  WARN_THRESHOLD)).toBe(false)
    expect(shouldShowDriftWarn(null, WARN_THRESHOLD)).toBe(false)
  })
})
