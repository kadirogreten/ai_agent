/** D4c — public API enable gate (default closed). */

export function resolvePublicApiGate(enabled: boolean): {
  allowed: boolean
  status?: 503
  error?: 'public_api_disabled'
} {
  if (enabled) return { allowed: true }
  return { allowed: false, status: 503, error: 'public_api_disabled' }
}
