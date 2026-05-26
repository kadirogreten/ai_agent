import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import {
  createSchedule, deleteSchedule, listSchedules, toggleSchedule,
  type PersonaScheduleRow,
} from '@/lib/schedules'
import { listDomainPacks } from '@/lib/playbooks'
import { Clock, Plus, Trash2 } from 'lucide-react'

export default function SchedulesPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const canQuery    = initialized && !!user

  const [rows,   setRows]   = useState<PersonaScheduleRow[]>([])
  const [packs,  setPacks]  = useState<{ id: string; name: string }[]>([])
  const [err,    setErr]    = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [showForm,   setShowForm]   = useState(false)
  const [fName,      setFName]      = useState('')
  const [fPack,      setFPack]      = useState('')
  const [fPersona,   setFPersona]   = useState('')
  const [fPlaybook,  setFPlaybook]  = useState('')
  const [fTopic,     setFTopic]     = useState('')
  const [fCron,      setFCron]      = useState('0 8 * * *')
  const [fRisk,      setFRisk]      = useState<'R0' | 'R1' | 'R2' | 'R3'>('R1')
  const [saving,     setSaving]     = useState(false)
  const [formErr,    setFormErr]    = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    const res = await listSchedules()
    if (res.error) setErr(res.error)
    else setRows(res.data)
    setLoading(false)
  }, [canQuery])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (canQuery) listDomainPacks().then((r) => setPacks(r.data))
  }, [canQuery])

  async function onCreate() {
    if (!fName || !fPack || !fPersona || !fPlaybook || !fTopic || !fCron) {
      setFormErr('Tüm zorunlu alanları doldur.')
      return
    }
    setSaving(true)
    try {
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
      if (res.error) { setFormErr(res.error); return }
      setShowForm(false)
      setFName(''); setFPack(''); setFPersona(''); setFPlaybook(''); setFTopic(''); setFCron('0 8 * * *'); setFRisk('R1')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<PersonaScheduleRow>[] = [
    {
      key: 'name', header: 'Ad',
      render: (r) => <span className="font-medium text-white/80 text-sm">{r.name}</span>,
    },
    {
      key: 'domain_pack', header: 'Pack', width: '100px',
      render: (r) => <span className="text-xs font-mono text-white/50">{r.domain_pack}</span>,
    },
    {
      key: 'persona_slug', header: 'Persona', width: '120px',
      render: (r) => <span className="text-xs font-mono text-white/50">{r.persona_slug}</span>,
    },
    {
      key: 'playbook_slug', header: 'Playbook', width: '120px',
      render: (r) => <span className="text-xs font-mono text-white/50">{r.playbook_slug}</span>,
    },
    {
      key: 'cron_expression', header: 'Cron', width: '120px',
      render: (r) => <span className="text-xs font-mono text-white/40">{r.cron_expression}</span>,
    },
    {
      key: 'risk', header: 'Risk', width: '70px',
      render: (r) => <Badge tone={r.risk === 'R0' ? 'green' : r.risk === 'R1' ? 'blue' : r.risk === 'R2' ? 'yellow' : 'red'}>{r.risk}</Badge>,
    },
    {
      key: 'enabled', header: 'Durum', width: '90px',
      render: (r) => (
        <span className={r.enabled ? 'text-emerald-400 text-xs' : 'text-white/40 text-xs'}>
          {r.enabled ? 'aktif' : 'pasif'}
        </span>
      ),
    },
    {
      key: 'actions', header: '', width: '110px',
      render: (r) => (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              toggleSchedule(r.id, !r.enabled).then(() => load())
            }}
          >
            {r.enabled ? 'Durdur' : 'Başlat'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              if (!confirm('Sil?')) return
              deleteSchedule(r.id).then(() => load())
            }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zamanlanmış Çalıştırmalar"
        description="Persona + playbook eşleşmesi cron'a göre tetiklenir"
        icon={<Clock size={18} />}
        actions={
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={13} className="mr-1" /> {showForm ? 'Kapat' : 'Yeni Schedule'}
          </Button>
        }
      />

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {showForm && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Yeni Schedule</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/40">Ad</label>
                <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Sabah pazar brief'i" />
              </div>
              <div>
                <Select
                  label="Domain Pack"
                  value={fPack}
                  onChange={(e) => setFPack(e.target.value)}
                >
                  <option value="">Seç...</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/40">Persona Slug</label>
                <Input value={fPersona} onChange={(e) => setFPersona(e.target.value)} placeholder="pazar-arastirmaci" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/40">Playbook Slug</label>
                <Input value={fPlaybook} onChange={(e) => setFPlaybook(e.target.value)} placeholder="mi-weekly-brief" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-white/40">Topic Şablonu (her tetiklemede kullanılacak)</label>
                <Input value={fTopic} onChange={(e) => setFTopic(e.target.value)} placeholder="AI ajan platformları" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/40">Cron (standart 5-alan)</label>
                <Input value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder="0 8 * * *" />
                <div className="mt-1 text-xs text-white/30">"0 8 * * *" → her gün 08:00. "0 9 * * 1" → her Pazartesi 09:00.</div>
              </div>
              <div>
                <Select
                  label="Risk"
                  value={fRisk}
                  onChange={(e) => setFRisk(e.target.value as 'R0' | 'R1' | 'R2' | 'R3')}
                >
                  <option value="R0">R0</option>
                  <option value="R1">R1</option>
                  <option value="R2">R2</option>
                  <option value="R3">R3</option>
                </Select>
              </div>
            </div>

            {formErr && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {formErr}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowForm(false)} disabled={saving}>İptal</Button>
              <Button size="sm" onClick={onCreate} disabled={saving}>Kaydet</Button>
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card className="overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
            {rows.length} schedule
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            empty={<EmptyState icon={<Clock size={24} />} title="Henüz schedule yok" />}
          />
        </Card>
      </motion.div>
    </div>
  )
}
