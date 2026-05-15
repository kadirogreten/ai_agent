import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

type DomainPackRow = {
  id: string
  name: string
  description: string | null
  tenant_id: string | null
  status: 'active' | 'draft' | 'archived'
  allowed_domains: string[]
  glossary_md: string | null
  regulatory_notes_md: string | null
  verifier_rubric_md: string | null
  created_at: string
  updated_at: string
}

export default function DomainPacksPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<DomainPackRow[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<DomainPackRow | null>(null)

  useEffect(() => { init() }, [init])
  const canQuery = initialized && !!user

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    let query = supabase
      .from('domain_packs')
      .select('id,name,description,tenant_id,status,allowed_domains,glossary_md,regulatory_notes_md,verifier_rubric_md,created_at,updated_at')
      .order('name')
    if (q.trim()) {
      const term = `%${q.trim()}%`
      query = query.or(`name.ilike.${term},id.ilike.${term}`)
    }
    const res = await query
    if (res.error) { setErr(res.error.message); setRows([]) }
    else setRows((res.data ?? []) as DomainPackRow[])
    setLoading(false)
  }, [canQuery, q])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <div className="mb-1 text-xs text-white/60">Arama</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pack id veya ad" />
          </div>
          <Button variant="secondary" onClick={() => setQ('')}>Temizle</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Domain Pack'ler</div>
          {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#0B1020]">
                <tr className="border-b border-white/10 text-xs text-white/60">
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Ad</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Domain Sayısı</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-4 py-3 text-white/60" colSpan={4}>Yükleniyor...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td className="px-4 py-3 text-white/60" colSpan={4}>Henüz pack yok</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r)}
                      className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${selected?.id === r.id ? 'bg-white/10' : ''}`}>
                    <td className="px-4 py-2 font-mono text-xs text-white/70">{r.id}</td>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.status}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.allowed_domains?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          {selected ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-white/50">ID</div>
                <div className="font-mono">{selected.id}</div>
              </div>
              <div>
                <div className="text-xs text-white/50">Ad</div>
                <div>{selected.name}</div>
              </div>
              {selected.description && (
                <div>
                  <div className="text-xs text-white/50">Açıklama</div>
                  <div className="whitespace-pre-wrap">{selected.description}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-white/50">İzinli Domain'ler ({selected.allowed_domains?.length ?? 0})</div>
                <div className="max-h-32 overflow-auto rounded bg-[#0B1020] p-2 font-mono text-xs">
                  {(selected.allowed_domains ?? []).slice(0, 50).join('\n') || '—'}
                  {(selected.allowed_domains?.length ?? 0) > 50 ? '\n... +' + (selected.allowed_domains.length - 50) : ''}
                </div>
              </div>
              {selected.verifier_rubric_md && (
                <div>
                  <div className="text-xs text-white/50">Verifier Rubric</div>
                  <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[#0B1020] p-2 text-xs">{selected.verifier_rubric_md}</div>
                </div>
              )}
              {selected.glossary_md && (
                <div>
                  <div className="text-xs text-white/50">Glossary</div>
                  <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[#0B1020] p-2 text-xs">{selected.glossary_md}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-white/60">Detay için sol listeden bir pack seç.</div>
          )}
        </Card>
      </div>
    </div>
  )
}
