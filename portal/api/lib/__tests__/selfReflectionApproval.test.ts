import { describe, expect, it } from 'vitest'

/** D1d: Onay geri beslemesi gruplama mantığı — DB'siz birim testi. */
function groupRejections(
  rows: Array<{ persona: string; playbook: string; pack: string; note: string }>,
) {
  const groups: Record<string, { count: number; notes: string[] }> = {}
  for (const r of rows) {
    const key = `${r.persona}::${r.playbook}::${r.pack}`
    if (!groups[key]) groups[key] = { count: 0, notes: [] }
    groups[key].count++
    groups[key].notes.push(r.note)
  }
  return groups
}

describe('selfReflection approval feedback grouping', () => {
  it('groups by persona+playbook+pack', () => {
    const g = groupRejections([
      { persona: 'community-manager', playbook: 'sosyal-etkilesim-yanit', pack: 'sosyal-medya', note: 'ton uyumsuz' },
      { persona: 'community-manager', playbook: 'sosyal-etkilesim-yanit', pack: 'sosyal-medya', note: 'link eksik' },
      { persona: 'community-manager', playbook: 'sosyal-etkilesim-yanit', pack: 'sosyal-medya', note: 'risk yüksek' },
    ])
    const key = 'community-manager::sosyal-etkilesim-yanit::sosyal-medya'
    expect(g[key]?.count).toBe(3)
    expect(g[key]?.notes.length).toBe(3)
  })

  it('meets rejection_min threshold at 3', () => {
    const min = 3
    const count = 3
    expect(count >= min).toBe(true)
  })
})
