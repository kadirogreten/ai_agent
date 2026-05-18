import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import {
  createSchedule, deleteSchedule, listSchedules, toggleSchedule,
  type PersonaScheduleRow,
} from '@/lib/schedules'
import { listDomainPacks } from '@/lib/playbooks'

/**
 * Kapı 3 — Çok-Günlü Otonomi UI iskeleti.
 * Scheduler worker (henüz ayrı workflow olarak deploy edilmedi) bu tabloyu okuyup
 * vadesi gelmiş schedule'ları run_requests'e otomatik insert edecek.
 */
export default function SchedulesPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const canQuery    = initialized && !!user

  const [rows, setRows]   = useState<PersonaScheduleRow[]>([])
  const [packs, setPacks] = useState<{ id: string; name: string }[]>([])
  const [err, setErr]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // New schedule form
  const [showForm, setShowForm] = useState(false)
  const [fName, setFName]       = useState('')
  const [fPack, setFPack]       = useState('')
  const [fPersona, setFPersona] = useState('')
  const [fPlaybook, setFPlaybook] = useState('')
  const [fTopic, setFTopic]     = useState('')
  const [fCron, setFCron]       = useState('0 8 * * *')
  const [fRisk, setFRisk]       = useState<'R0' | 'R1' | 'R2' | 'R3'>('R1')

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    const res = await listSchedules()
    if (res.error) setErr(res.error); else setRows(res.data)
    setLoading(false)
  }, [canQuery])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (canQuery) listDomainPacks().then((r) => setPacks(r.data))
  }, [canQuery])

  async function onCreate() {
    if (!fName || !fPack || !fPersona || !fPlaybook || !fTopic || !fCron) {
      setErr('Tüm zorunlu alanları doldur.')
      return
    }
    const res = await createSchedule({
      name:            fName.trim(),
      domain_pack:     fPack,
      persona_slug:    fPersona.trim(),
      playbook_slug:   fPlaybook.trim(),
      topic_template:  fTopic.trim(),
      cron_expression: fCron.trim(),
      risk:            fRisk,
      allow_high_risk: fRisk === 'R2' || fRisk === 'R3',
    })
    if (res.error) { setErr(res.error); return }
    setShowForm(false)
    setFName(''); setFPack(''); setFPersona(''); setFPlaybook(''); setFTopic('')
    await load()
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Zamanlanmış Çalıştırmalar (Kapı 3 — iskelet)</div>
            <div className="text-xs text-white/60">
              Bir persona + playbook eşleşmesi cron'a göre tetiklenir. Scheduler worker'ı henüz
              ayrı workflow olarak deploy edilmedi — bu sayfa şu an manifest yazımı için.
            </div>
          </div>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'İptal' : '+ Yeni Schedule'}
          </Button>
        </div>
      </Card>

      {err ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>
      ) : null}

      {showForm ? (
        <Card className="space-y-3 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-white/60">Ad</div>
              <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Sabah pazar brief'i" />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Domain Pack</div>
              <select value={fPack} onChange={(e) => setFPack(e.target.value)}
                className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm">
                <option value="">Seç...</option>
                {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Persona Slug</div>
              <Input value={fPersona} onChange={(e) => setFPersona(e.target.value)} placeholder="pazar-arastirmaci" />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Playbook Slug</div>
              <Input value={fPlaybook} onChange={(e) => setFPlaybook(e.target.value)} placeholder="mi-weekly-brief" />
            </div>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">Topic Şablonu (her tetiklemede kullanılacak)</div>
              <Input value={fTopic} onChange={(e) => setFTopic(e.target.value)} placeholder="AI ajan platformları" />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Cron (standart 5-alan)</div>
              <Input value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder="0 8 * * *" />
              <div className="mt-1 text-xs text-white/40">"0 8 * * *" → her gün 08:00. "0 9 * * 1" → her Pazartesi 09:00.</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Risk</div>
              <select value={fRisk} onChange={(e) => setFRisk(e.target.value as 'R0'|'R1'|'R2'|'R3')}
                className="h-10 w-full rounded-md border border-white/10 bg-[#111A33] px-3 text-sm">
                <option value="R0">R0</option><option value="R1">R1</option><option value="R2">R2</option><option value="R3">R3</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onCreate}>Kaydet</Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Aktif Schedule'lar</div>
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#0B1020]">
            <tr className="border-b border-white/10 text-xs text-white/60">
              <th className="px-4 py-2">Ad</th>
              <th className="px-4 py-2">Pack</th>
              <th className="px-4 py-2">Persona</th>
              <th className="px-4 py-2">Playbook</th>
              <th className="px-4 py-2">Cron</th>
              <th className="px-4 py-2">Sonraki</th>
              <th className="px-4 py-2">Risk</th>
              <th className="px-4 py-2">Durum</th>
              <th className="px-4 py-2">Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-3 text-white/60">Yükleniyor...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-3 text-white/60">Henüz schedule yok</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-xs font-mono text-white/70">{r.domain_pack}</td>
                <td className="px-4 py-2 text-xs font-mono text-white/70">{r.persona_slug}</td>
                <td className="px-4 py-2 text-xs font-mono text-white/70">{r.playbook_slug}</td>
                <td className="px-4 py-2 text-xs font-mono text-white/70">{r.cron_expression}</td>
                <td className="px-4 py-2 text-xs text-white/60">
                  {r.next_fire_at ? new Date(r.next_fire_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 text-xs">{r.risk}</td>
                <td className="px-4 py-2 text-xs">
                  {r.enabled
                    ? <span className="text-green-400">aktif</span>
                    : <span className="text-white/50">pasif</span>}
                  {r.consecutive_failures > 0
                    ? <span className="ml-2 text-orange-300">⚠{r.consecutive_failures}</span>
                    : null}
                </td>
                <td className="px-4 py-2">
                  <Button variant="outline" size="sm"
                    onClick={async () => { await toggleSchedule(r.id, !r.enabled); await load() }}>
                    {r.enabled ? 'Durdur' : 'Başlat'}
                  </Button>{' '}
                  <Button variant="ghost" size="sm"
                    onClick={async () => {
                      if (!confirm('Sil?')) return
                      await deleteSchedule(r.id); await load()
                    }}>Sil</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
