import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listPersonas, type PersonaRow } from '@/lib/personas'
import { listDomainPacks } from '@/lib/playbooks'

export default function PersonasPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<PersonaRow[]>([])
  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [packId, setPackId] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q, packId }), [q, packId])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    const res = await listPersonas({ q: filters.q, packId: filters.packId || undefined })
    if (res.error) {
      setErr(res.error)
      setRows([])
    } else {
      setRows(res.data)
    }
    setLoading(false)
  }, [canQuery, filters.q, filters.packId])

  useEffect(() => {
    if (!canQuery) return
    listDomainPacks().then((res) => setPacks(res.data))
  }, [canQuery])

  useEffect(() => {
    load()
  }, [load])

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
              <option value="">Tümü (cross-domain dahil)</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setQ('')
                setPackId('')
              }}
            >
              Temizle
            </Button>
            <Link to="/app/personas/new">
              <Button>Yeni Persona</Button>
            </Link>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Personalar</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Ad</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Pack</th>
                <th className="px-4 py-2">Risk Tavanı</th>
                <th className="px-4 py-2">Maliyet</th>
                <th className="px-4 py-2">Güncellenme</th>
                <th className="px-4 py-2">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={7}>Yükleniyor...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="px-4 py-3 text-white/60" colSpan={7}>Henüz persona yok</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2">
                      <Link to={`/app/personas/${r.id}/edit`} className="text-blue-200 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-white/70">{r.slug}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.pack_id ?? <span className="italic text-white/50">cross-domain</span>}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.risk_ceiling}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.cost_class}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{new Date(r.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <Link to={`/app/personas/${r.id}/edit`}>
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
