import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listPlaybooks, listDomainPacks, type PlaybookRow } from '@/lib/playbooks'

export default function PlaybooksPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<PlaybookRow[]>([])
  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [packId, setPackId] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { init() }, [init])
  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q, packId }), [q, packId])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    const res = await listPlaybooks({ q: filters.q, packId: filters.packId || undefined })
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
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya slug ara" />
          </div>
          <div className="w-full md:w-64">
            <div className="mb-1 text-xs text-white/60">Domain Pack</div>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm"
            >
              <option value="">Tümü</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setQ(''); setPackId('') }}>Temizle</Button>
            <Link to="/app/playbooks/new"><Button>Yeni Playbook</Button></Link>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Playbook'lar</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Ad</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Pack</th>
                <th className="px-4 py-2">Adım</th>
                <th className="px-4 py-2">Default Risk</th>
                <th className="px-4 py-2">v</th>
                <th className="px-4 py-2">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={7}>Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={7}>Henüz playbook yok</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2">
                      <Link to={`/app/playbooks/${r.id}/edit`} className="text-blue-200 hover:underline">{r.name}</Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-white/70">{r.slug}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.pack_id}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.steps?.length ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.default_risk}</td>
                    <td className="px-4 py-2 text-xs text-white/60">v{r.version}</td>
                    <td className="px-4 py-2">
                      <Link to={`/app/playbooks/${r.id}/edit`}>
                        <Button variant="outline" size="sm">Düzenle</Button>
                      </Link>
                    </td>
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
