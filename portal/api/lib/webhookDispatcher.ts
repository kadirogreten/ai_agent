/**
 * D4c — signed webhook dispatch (HTTPS only, SSRF guard, HMAC-SHA256).
 * Fire-and-forget; no retry queue in v1.
 */
import { createHmac, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken, encryptTokenOptional } from './tokenEncryptor.js'

export type WebhookEvent = 'operation.done' | 'operation.escalated'

export type WebhookPayload = {
  event: WebhookEvent
  operation_id: string
  status: string
  goal_text: string
  domain_pack: string
  ts: string
}

const PRIVATE_IPV4 =
  /^(10\.|127\.|169\.254\.|192\.168\.|0\.0\.0\.0$|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/

function isIpv6Local(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  )
}

/** Pure URL SSRF / scheme guard — used by create + dispatch. */
export function assertSafeWebhookUrl(urlStr: string): void {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error('Geçersiz webhook URL')
  }
  if (u.protocol !== 'https:') {
    throw new Error('Webhook URL yalnız https:// olabilir')
  }
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new Error('Webhook URL private/local host reddedildi')
  }
  if (PRIVATE_IPV4.test(host) || isIpv6Local(host)) {
    throw new Error('Webhook URL private IP reddedildi')
  }
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

export function signWebhookBody(secret: string, body: string): string {
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return `sha256=${hex}`
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = signWebhookBody(secret, body)
  if (expected.length !== header.length) return false
  // timing-safe-ish compare via hmac of both
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function decryptSecret(enc: string): string {
  if (enc.startsWith('plain:')) return enc.slice(6)
  return decryptToken(enc)
}

export async function createWebhookEndpoint(
  supabase: SupabaseClient,
  ownerUserId: string,
  opts: { url: string; events?: string[] },
): Promise<{ id: string; url: string; events: string[]; secret: string }> {
  assertSafeWebhookUrl(opts.url)
  const events = (opts.events?.length
    ? opts.events
    : ['operation.done', 'operation.escalated']
  ).filter((e) => e === 'operation.done' || e === 'operation.escalated')
  if (events.length === 0) throw new Error('events zorunlu')

  const secret = generateWebhookSecret()
  const secret_enc = encryptTokenOptional(secret)

  const { data, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      owner_user_id: ownerUserId,
      url: opts.url.trim(),
      secret_enc,
      events,
      enabled: true,
    })
    .select('id, url, events')
    .single()

  if (error) throw error
  return { id: data.id, url: data.url, events: data.events, secret }
}

export type OperationWebhookSource = {
  id: string
  owner_user_id: string
  goal_text: string
  domain_pack: string
  status: string
  context_json?: Record<string, unknown> | null
}

/**
 * Dispatch signed webhooks only for public_api-sourced ops.
 */
export async function dispatchOperationWebhooks(
  supabase: SupabaseClient,
  op: OperationWebhookSource,
  event: WebhookEvent,
  fetchFn: typeof fetch = fetch,
): Promise<{ skipped: boolean; attempted: number; ok: number }> {
  const source = op.context_json?.source
  if (source !== 'public_api') {
    return { skipped: true, attempted: 0, ok: 0 }
  }

  const { data: endpoints, error } = await supabase
    .from('webhook_endpoints')
    .select('id, url, secret_enc, events, enabled')
    .eq('owner_user_id', op.owner_user_id)
    .eq('enabled', true)

  if (error || !endpoints?.length) {
    return { skipped: false, attempted: 0, ok: 0 }
  }

  const payload: WebhookPayload = {
    event,
    operation_id: op.id,
    status: op.status,
    goal_text: op.goal_text,
    domain_pack: op.domain_pack,
    ts: new Date().toISOString(),
  }
  const body = JSON.stringify(payload)

  let attempted = 0
  let ok = 0

  for (const ep of endpoints) {
    const events = (ep.events ?? []) as string[]
    if (!events.includes(event)) continue

    try {
      assertSafeWebhookUrl(ep.url)
    } catch (e) {
      console.warn('[webhook] URL reddedildi', ep.id, (e as Error).message)
      continue
    }

    let secret: string
    try {
      secret = decryptSecret(ep.secret_enc)
    } catch (e) {
      console.warn('[webhook] secret decrypt', ep.id, (e as Error).message)
      continue
    }

    const signature = signWebhookBody(secret, body)
    attempted++
    try {
      const res = await fetchFn(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentArmy-Signature': signature,
          'User-Agent': 'AgentArmy-Webhook/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) ok++
      else console.warn('[webhook] non-2xx', ep.id, res.status)
    } catch (e) {
      console.warn('[webhook] POST failed', ep.id, (e as Error).message)
    }
  }

  return { skipped: false, attempted, ok }
}
