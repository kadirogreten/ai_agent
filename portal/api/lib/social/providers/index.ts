import type { ISocialOAuthProvider, SocialPlatformSlug } from './types.js'
import { MetaOAuthProvider } from './meta.js'
import { XOAuthProvider } from './x.js'
import { LinkedInOAuthProvider } from './linkedin.js'
import { TikTokOAuthProvider } from './tiktok.js'
import { GoogleAdsOAuthProvider } from './google_ads.js'

const providers: Record<SocialPlatformSlug, ISocialOAuthProvider> = {
  meta:        new MetaOAuthProvider(),
  x:           new XOAuthProvider(),
  linkedin:    new LinkedInOAuthProvider(),
  tiktok:      new TikTokOAuthProvider(),
  google_ads:  new GoogleAdsOAuthProvider(),
}

export function getSocialProvider(slug: string): ISocialOAuthProvider | null {
  if (!slug || !(slug in providers)) return null
  return providers[slug as SocialPlatformSlug]
}

export function listSocialProviders(): Array<{ slug: SocialPlatformSlug; displayName: string; available: boolean }> {
  return (Object.keys(providers) as SocialPlatformSlug[]).map((slug) => ({
    slug,
    displayName: providers[slug].displayName,
    available: true,   // PR-S8: beş platformun da provider'ı mevcut
  }))
}
