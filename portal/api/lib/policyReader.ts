/**
 * policy_settings tablosundan yapılandırma değeri okur.
 * owner→global (NULL) fallback zinciri; 5 dakika in-memory cache.
 * DB hatası veya parse hatası → sessizce fallback döner.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

interface CacheEntry {
  rawJson: unknown
  expiry: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 dakika

async function fetchRaw(
  supabase: SupabaseClient,
  ownerId: string | null,
  key: string,
): Promise<unknown | undefined> {
  const cacheKey = `${ownerId ?? ''}|${key}`
  const entry = cache.get(cacheKey)
  if (entry && entry.expiry > Date.now()) return entry.rawJson

  try {
    let query = supabase
      .from('policy_settings')
      .select('value')
      .eq('key', key)
      .limit(1)

    if (ownerId) {
      query = query.eq('owner_user_id', ownerId) as typeof query
    } else {
      query = query.is('owner_user_id', null) as typeof query
    }

    const { data, error } = await query
    if (error || !data || data.length === 0) return undefined

    const raw = (data[0] as { value: unknown }).value
    cache.set(cacheKey, { rawJson: raw, expiry: Date.now() + CACHE_TTL_MS })
    return raw
  } catch {
    return undefined
  }
}

/**
 * policy_settings'ten değer okur.
 * owner satırı → global satır → fallback zinciri.
 * Parse hatası veya DB yoksa fallback döner.
 */
export async function getPolicy<T>(
  supabase: SupabaseClient,
  ownerId: string | null | undefined,
  key: string,
  fallback: T,
): Promise<T> {
  const candidates: Array<string | null> = []
  if (ownerId) candidates.push(ownerId)
  candidates.push(null) // global

  for (const owner of candidates) {
    const raw = await fetchRaw(supabase, owner, key)
    if (raw === undefined || raw === null) continue
    // Değer zaten parse edilmiş JSONB değeri (Supabase JS otomatik parse eder)
    try {
      return raw as T
    } catch {
      continue
    }
  }

  return fallback
}

export function invalidatePolicyCache() {
  cache.clear()
}
