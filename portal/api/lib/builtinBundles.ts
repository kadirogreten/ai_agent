import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const FALLBACK: Record<string, string[]> = {
  'market-intel': ['weekly'],
  'e-ticaret': ['weekly-starter', 'monthly-merchandiser'],
  'hibe-yazimi': ['tubitak-1507-tam-paket', 'tubitak-1501-tam-paket', 'eic-accelerator-mini'],
  system: [],
}

export function listBuiltinBundleIds(domainPack: string): string[] {
  const dir = path.join(repoRoot, 'domain-packs', domainPack, 'bundles')
  try {
    const files = fs.readdirSync(dir)
    const ids = files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter(Boolean)
    if (ids.length > 0) return ids.sort()
  } catch {
    /* fallback */
  }
  return FALLBACK[domainPack] ?? []
}

export function assertBundleExists(domainPack: string, bundleId: string): void {
  const ids = listBuiltinBundleIds(domainPack)
  if (ids.length === 0) {
    throw new Error(`Domain pack "${domainPack}" için bundle tanımı bulunamadı.`)
  }
  if (!ids.includes(bundleId)) {
    throw new Error(
      `Bundle "${bundleId}" paket "${domainPack}" içinde yok. Geçerli bundle'lar: ${ids.join(', ')}`,
    )
  }
}
