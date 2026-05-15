import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listPlaybookBundles, type PlaybookBundleRow } from '@/lib/bundles'
import { listDomainPacks } from '@/lib/playbooks'

export default function PlaybookBundlesPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<PlaybookBundleRow[]>([])
  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [packId, setPackId] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { init() }, [init])
  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q, packId }), [q, packId])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    const res = await listPlaybookBundles({ q: filters.q, packId: filters.packId || undefined })
    if (res.error) { setErr(res.error); setRows([]) } else { setRows(res.data) }
    setLoading(false)
  }, [canQuery, filters.q, filters.packId])

  useEffect(() => {
    if (!canQuery) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canQuery])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <div className="mb-1 text-xs text-white/60">Arama</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya slug" />
          </div>
          <div className="w-full md:w-64">
            <div className="mb-1 text-xs text-white/60">Domain Pack</div>
            <select value={packId} onChange={(e) => setPackId(e.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm">
              <option value="">Tümü</option>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <Button variant="secondary" onClick={() => { setQ(''); setPackId('') }}>Temizle</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Playbook Paketleri (Bundles)</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Ad</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Pack</th>
                <th className="px-4 py-2">Playbook Sayısı</th>
                <th className="px-4 py-2">v</th>
                <th className="px-4 py-2">Güncellenme</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={6}>Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={6}>Henüz bundle yok</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 text-blue-200">{r.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-white/70">{r.slug}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.pack_id}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.playbook_slugs?.length ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-white/60">v{r.version}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
