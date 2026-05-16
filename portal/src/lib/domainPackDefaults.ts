export type PackOption = { id: string; label: string }

/** Built-in domain packs (repo domain-packs/). DB'de yoksa bile formda görünür. */
export const BUILTIN_DOMAIN_PACKS: PackOption[] = [
  { id: 'market-intel', label: 'Market Intel' },
  { id: 'e-ticaret', label: 'E-Ticaret' },
  { id: 'hibe-yazimi', label: 'Hibe Yazımı (TÜBİTAK)' },
  { id: 'system', label: 'System' },
]

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

export function mergeDomainPackOptions(dbPacks: { id: string; name: string }[]): PackOption[] {
  const map = new Map<string, string>()
  for (const p of BUILTIN_DOMAIN_PACKS) {
    map.set(p.id, p.label)
  }
  for (const row of dbPacks) {
    if (row.id) map.set(row.id, row.name?.trim() || row.id)
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

export function mergeBundleOptions(
  packId: string,
  dbBundles: { slug: string; name: string }[],
): PackOption[] {
  const map = new Map<string, string>()
  for (const b of BUNDLES_BY_DOMAIN[packId] ?? []) {
    map.set(b.id, b.label)
  }
  for (const row of dbBundles) {
    const slug = row.slug?.trim()
    if (slug) map.set(slug, row.name?.trim() || slug)
  }
  return [...map.entries()].map(([id, label]) => ({ id, label }))
}

export function mergePlaybookOptions(
  packId: string,
  dbPlaybooks: { slug: string; name: string }[],
): PackOption[] {
  const map = new Map<string, string>()
  for (const slug of PLAYBOOKS_BY_DOMAIN[packId] ?? []) {
    map.set(slug, slug)
  }
  for (const row of dbPlaybooks) {
    const slug = row.slug?.trim()
    if (slug) map.set(slug, row.name?.trim() || slug)
  }
  return [...map.entries()].map(([id, label]) => ({ id, label }))
}
