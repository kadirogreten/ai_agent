import type { ISocialOAuthProvider, SocialPlatformSlug } from './types.js'
import { MetaOAuthProvider } from './meta.js'
import { XOAuthProvider } from './x.js'

const providers: Record<SocialPlatformSlug, ISocialOAuthProvider> = {
  meta:        new MetaOAuthProvider(),
  x:           new XOAuthProvider(),
  linkedin:    stubProvider('linkedin', 'LinkedIn'),
  tiktok:      stubProvider('tiktok', 'TikTok'),
  google_ads:  stubProvider('google_ads', 'Google Ads'),
}

function stubProvider(slug: SocialPlatformSlug, displayName: string): ISocialOAuthProvider {
  return {
    slug,
    displayName,
    buildAuthorizeUrl: () => { throw new Error(`${displayName} OAuth PR-S8'de`) },
    exchangeCode: async () => { throw new Error(`${displayName} OAuth PR-S8'de`) },
    refreshIfNeeded: async () => null,
  }
}

export function getSocialProvider(slug: string): ISocialOAuthProvider | null {
  if (!slug || !(slug in providers)) return null
  return providers[slug as SocialPlatformSlug]
}

export function listSocialProviders(): Array<{ slug: SocialPlatformSlug; displayName: string; available: boolean }> {
  return (Object.keys(providers) as SocialPlatformSlug[]).map((slug) => ({
    slug,
    displayName: providers[slug].displayName,
    available: slug === 'meta' || slug === 'x',
  }))
}
