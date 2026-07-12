/** D4c — risk floor helpers for public API creates. */

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3'

const RANK: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }

export function isRiskLevel(v: unknown): v is RiskLevel {
  return v === 'R0' || v === 'R1' || v === 'R2' || v === 'R3'
}

/** Returns the higher of two risk levels. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RANK[a] >= RANK[b] ? a : b
}

/** Public API floor: at least R2 (approval gate). */
export function applyPublicApiRiskFloor(requested: RiskLevel): RiskLevel {
  return maxRisk(requested, 'R2')
}
