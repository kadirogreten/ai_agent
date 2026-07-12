/**
 * D4c — in-memory sliding-window rate limit (tek process / systemd).
 */

type Bucket = { timestamps: number[] }

const buckets = new Map<string, Bucket>()

export function resetPublicApiRateLimitForTests() {
  buckets.clear()
}

/**
 * @returns true if allowed; false if over limit
 */
export function checkPublicApiRateLimit(
  keyId: string,
  limitPerMinute: number,
  nowMs = Date.now(),
): boolean {
  const windowMs = 60_000
  const limit = Math.max(1, Math.floor(limitPerMinute))
  let bucket = buckets.get(keyId)
  if (!bucket) {
    bucket = { timestamps: [] }
    buckets.set(keyId, bucket)
  }
  bucket.timestamps = bucket.timestamps.filter((t) => nowMs - t < windowMs)
  if (bucket.timestamps.length >= limit) return false
  bucket.timestamps.push(nowMs)
  return true
}
