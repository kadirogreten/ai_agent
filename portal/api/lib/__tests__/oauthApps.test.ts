import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptToken } from '../tokenEncryptor.js'
import {
  listOAuthAppsSafeWith,
  resolveOAuthAppConfigWith,
} from '../social/oauthApps.js'

// PR-S7c: çözümleme sırası (owner > platform > env) + secret'ın GET yüzeyine sızmaması.

beforeAll(() => {
  process.env.SOCIAL_TOKEN_ENC_KEY ??= randomBytes(32).toString('base64')
  process.env.PORTAL_PUBLIC_URL = 'https://portal.example.com'
})

afterEach(() => {
  delete process.env.META_APP_ID
  delete process.env.META_APP_SECRET
  delete process.env.META_OAUTH_REDIRECT_URI
})

type Row = Record<string, unknown>

/** Thenable sorgu zinciri — supabase-js select zincirini taklit eder. */
function fakeClient(rows: Row[]) {
  const makeQuery = () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'or']) q[m] = () => q
    ;(q as { then: (r: (v: unknown) => void) => void }).then = (resolve) =>
      resolve({ data: rows, error: null })
    return q
  }
  return { from: () => makeQuery() } as never
}

function dbRow(overrides: Row = {}): Row {
  return {
    owner_user_id: null,
    platform: 'meta',
    app_id: 'platform-app',
    app_secret_ciphertext: encryptToken('platform-secret'),
    redirect_uri: null,
    enabled: true,
    updated_at: '2026-07-08T00:00:00Z',
    ...overrides,
  }
}

describe('resolveOAuthAppConfigWith — öncelik sırası', () => {
  it('owner satırı platform geneline tercih edilir', async () => {
    const rows = [
      dbRow(),
      dbRow({ owner_user_id: 'user-1', app_id: 'owner-app', app_secret_ciphertext: encryptToken('owner-secret') }),
    ]
    const cfg = await resolveOAuthAppConfigWith(fakeClient(rows), 'meta', 'user-1')
    expect(cfg?.appId).toBe('owner-app')
    expect(cfg?.appSecret).toBe('owner-secret')
    expect(cfg?.source).toBe('owner')
  })

  it('owner satırı yoksa platform geneli kullanılır', async () => {
    const cfg = await resolveOAuthAppConfigWith(fakeClient([dbRow()]), 'meta', 'user-1')
    expect(cfg?.appId).toBe('platform-app')
    expect(cfg?.source).toBe('platform')
  })

  it('DB boşsa env fallback devreye girer', async () => {
    process.env.META_APP_ID = 'env-app'
    process.env.META_APP_SECRET = 'env-secret'
    const cfg = await resolveOAuthAppConfigWith(fakeClient([]), 'meta', 'user-1')
    expect(cfg?.appId).toBe('env-app')
    expect(cfg?.source).toBe('env')
  })

  it('hiçbir kaynak yoksa null döner', async () => {
    const cfg = await resolveOAuthAppConfigWith(fakeClient([]), 'meta', 'user-1')
    expect(cfg).toBeNull()
  })

  it('redirect_uri boşsa PORTAL_PUBLIC_URL tabanlı öneri üretilir', async () => {
    const cfg = await resolveOAuthAppConfigWith(fakeClient([dbRow()]), 'meta', 'user-1')
    expect(cfg?.redirectUri).toBe('https://portal.example.com/api/social/meta/oauth/callback')
  })
})

describe('listOAuthAppsSafeWith — secret sızmaz', () => {
  it('çıktıda ciphertext/secret alanı yoktur, secret_set boolean döner', async () => {
    const rows = [dbRow({ owner_user_id: 'user-1', app_id: 'owner-app' })]
    const list = await listOAuthAppsSafeWith(fakeClient(rows), 'user-1', ['meta', 'x'])

    const meta = list.find((a) => a.platform === 'meta')
    expect(meta?.secret_set).toBe(true)
    expect(meta?.source).toBe('owner')

    const x = list.find((a) => a.platform === 'x')
    expect(x?.secret_set).toBe(false)
    expect(x?.source).toBeNull()

    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain('ciphertext')
    expect(serialized).not.toContain('secret-')       // düz metin secret paterni
    expect(serialized).not.toContain('app_secret":')  // alan adı bile dönmez (yalnız secret_set)
  })
})
