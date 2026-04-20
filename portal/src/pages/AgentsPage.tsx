import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { listAgents, type AgentRow } from '@/lib/agents'

export default function AgentsPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<AgentRow[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const canQuery = initialized && !!user
  const filters = useMemo(() => ({ q }), [q])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    const res = await listAgents({ q: filters.q })
    if (res.error) {
      setErr(res.error)
      setRows([])
    } else {
      setRows(res.data)
    }
    setLoading(false)
  }, [canQuery, filters.q])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <div className="mb-1 text-xs text-white/60">Arama</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya kod ara" />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setQ('')
              }}
            >
              Temizle
            </Button>
            <Link to="/app/agents/new">
              <Button>Yeni Ajan</Button>
            </Link>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Ajanlar</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Ad</th>
                <th className="px-4 py-2">Kod</th>
                <th className="px-4 py-2">Açıklama</th>
                <th className="px-4 py-2">Yetenek</th>
                <th className="px-4 py-2">Güncellenme</th>
                <th className="px-4 py-2">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={6}>
                    Yükleniyor...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={6}>
                    Henüz ajan yok
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2">
                      <Link to={`/app/agents/${r.id}/edit`} className="text-blue-200 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-white/70">{r.code}</td>
                    <td className="px-4 py-2 text-xs text-white/70">
                      {r.description ? r.description.slice(0, 80) : '-'}
                    </td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.capabilities?.length ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-white/60">{new Date(r.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <Link to={`/app/agents/${r.id}/edit`}>
                        <Button variant="outline" size="sm">
                          Düzenle
                        </Button>
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
