/**
 * D4c — API key create / verify / revoke.
 * Format: aak_ + 32 byte hex. DB stores SHA-256 hash + key_prefix.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const API_KEY_PREFIX = 'aak_'
export type ApiKeyScope = 'operations:write' | 'operations:read' | 'packs:read'

export type ApiKeyRow = {
  id: string
  owner_user_id: string
  name: string
  key_prefix: string
  key_hash: string
  scopes: string[]
  enabled: boolean
  last_used_at: string | null
  created_at: string
}

export type VerifiedApiKey = {
  id: string
  ownerUserId: string
  scopes: string[]
  name: string
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

export function generateApiKeyPlaintext(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`
}

export function isApiKeyBearer(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX)
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex')
    const bb = Buffer.from(b, 'hex')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export async function createApiKey(
  supabase: SupabaseClient,
  ownerUserId: string,
  opts: { name: string; scopes: string[] },
): Promise<{ row: Omit<ApiKeyRow, 'key_hash'>; plaintext: string }> {
  const name = opts.name.trim()
  if (!name) throw new Error('name zorunlu')
  const scopes = opts.scopes.filter(Boolean)
  if (scopes.length === 0) throw new Error('scopes zorunlu')

  const plaintext = generateApiKeyPlaintext()
  const key_hash = hashApiKey(plaintext)
  const key_prefix = plaintext.slice(0, 8)

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      owner_user_id: ownerUserId,
      name,
      key_prefix,
      key_hash,
      scopes,
      enabled: true,
    })
    .select('id, owner_user_id, name, key_prefix, scopes, enabled, last_used_at, created_at')
    .single()

  if (error) throw error
  return { row: data as Omit<ApiKeyRow, 'key_hash'>, plaintext }
}

export async function verifyApiKey(
  supabase: SupabaseClient,
  plaintext: string,
): Promise<VerifiedApiKey | null> {
  if (!isApiKeyBearer(plaintext)) return null
  const key_hash = hashApiKey(plaintext)

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, owner_user_id, name, key_hash, scopes, enabled')
    .eq('key_hash', key_hash)
    .maybeSingle()

  if (error || !data) return null
  if (!data.enabled) return null
  if (!safeEqualHex(data.key_hash, key_hash)) return null

  // last_used_at — fire-and-forget
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return {
    id: data.id,
    ownerUserId: data.owner_user_id,
    scopes: (data.scopes ?? []) as string[],
    name: data.name,
  }
}

export function keyHasScope(key: VerifiedApiKey, scope: ApiKeyScope): boolean {
  return key.scopes.includes(scope)
}

export async function listApiKeys(supabase: SupabaseClient, ownerUserId: string) {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, owner_user_id, name, key_prefix, scopes, enabled, last_used_at, created_at')
    .eq('owner_user_id', ownerUserId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function revokeApiKey(
  supabase: SupabaseClient,
  ownerUserId: string,
  keyId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', keyId)
    .eq('owner_user_id', ownerUserId)
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}
