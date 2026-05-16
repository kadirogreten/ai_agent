/** Built-in bundle ids per domain pack (matches domain-packs bundle JSON files). */
export const BUNDLES_BY_DOMAIN: Record<string, { id: string; label: string }[]> = {
  'market-intel': [{ id: 'weekly', label: 'weekly' }],
  'e-ticaret': [
    { id: 'weekly-starter', label: 'weekly-starter' },
    { id: 'monthly-merchandiser', label: 'monthly-merchandiser' },
  ],
  'hibe-yazimi': [
    { id: 'tubitak-1507-tam-paket', label: 'TÜBİTAK 1507 tam paket' },
    { id: 'tubitak-1501-tam-paket', label: 'TÜBİTAK 1501 tam paket' },
    { id: 'eic-accelerator-mini', label: 'EIC accelerator mini' },
  ],
  system: [],
}

export const PLAYBOOKS_BY_DOMAIN: Record<string, string[]> = {
  'market-intel': ['mi-weekly-brief', 'mi-trend-radar'],
  'e-ticaret': ['e-ticaret-pazar-genel', 'e-ticaret-urun-aciklama-uret'],
  'hibe-yazimi': [
    'yenilik-iddiasi-uret',
    'tubitak-1507-iskelet',
    'tubitak-1501-is-paketleri',
    'hibe-butce-ceklistesi',
  ],
  system: ['sector-discovery-and-scaffold'],
}

export function defaultBundleIdForPack(domainPack: string): string {
  const list = BUNDLES_BY_DOMAIN[domainPack]
  return list?.[0]?.id ?? 'weekly'
}

export function defaultPlaybookIdForPack(domainPack: string): string {
  const list = PLAYBOOKS_BY_DOMAIN[domainPack]
  return list?.[0] ?? 'mi-weekly-brief'
}

export function bundleIdsForPack(domainPack: string): string[] {
  return (BUNDLES_BY_DOMAIN[domainPack] ?? []).map((b) => b.id)
}
