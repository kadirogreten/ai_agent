import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { listPlaybookBundles } from '@/lib/bundles'
import { listDomainPacks, listPlaybooksForPack, type PlaybookRow } from '@/lib/domainPacks'
import {
  BUILTIN_DOMAIN_PACKS,
  mergeBundleOptions,
  mergeDomainPackOptions,
  mergePlaybookOptions,
  type PackOption,
} from '@/lib/domainPackDefaults'
import { Zap, Plus } from 'lucide-react'

type JobStatus = 'pending' | 'running' | 'success' | 'fail' | 'cancelled'
type JobMode = 'ceo' | 'ceo-iterate' | 'run' | 'bundle'

type JobRow = {
  id: string
  status: JobStatus
  mode: JobMode
  domain_pack: string | null
  request_text: string | null
  model: string | null
  web: boolean
  contrarian: boolean
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

type AgentRow = {
  code: string
  name: string
}

function statusTone(s: JobStatus): 'green' | 'red' | 'yellow' | 'gray' {
  if (s === 'success') return 'green'
  if (s === 'fail') return 'red'
  if (s === 'running') return 'yellow'
  if (s === 'pending') return 'gray'
  return 'gray'
}

const SELECT_CLS = 'h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white outline-none focus:border-blue-500/60'

export default function JobsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows,   setRows]   = useState<JobRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err,    setErr]    = useState<string | null>(null)
  const [q,      setQ]      = useState('')
  const [status, setStatus] = useState<'all' | JobStatus>('all')
  const [mode,   setMode]   = useState<'all' | JobMode>('all')

  const [formOpen,     setFormOpen]     = useState(false)
  const [formMode,     setFormMode]     = useState<JobMode>('ceo')
  const [domainPack,   setDomainPack]   = useState('market-intel')
  const [requestText,  setRequestText]  = useState('')
  const [answersJson,  setAnswersJson]  = useState('{}')
  const [playbookId,   setPlaybookId]   = useState('brand-site')
  const [bundleId,     setBundleId]     = useState('weekly')
  const [availableAgents, setAvailableAgents] = useState<AgentRow[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [modelText,    setModelText]    = useState('gpt-4.1')
  const [web,         setWeb]          = useState(true)
  const [contrarian,   setContrarian]   = useState(false)
  const [risk,        setRisk]         = useState<'R0' | 'R1' | 'R2' | 'R3'>('R1')
  const [allowHighRisk, setAllowHighRisk] = useState(false)
  const [saving,      setSaving]       = useState(false)
  const [formErr,     setFormErr]      = useState<string | null>(null)
  const [domainPackOptions, setDomainPackOptions] = useState<PackOption[]>(BUILTIN_DOMAIN_PACKS)
  const [bundleOptions, setBundleOptions] = useState<PackOption[]>(() => mergeBundleOptions('market-intel', []))
  const [playbookOptions, setPlaybookOptions] = useState<PackOption[]>(() => mergePlaybookOptions('market-intel', []))

  const canQuery = initialized && !!user

  useEffect(() => {
    async function loadAgents() {
      if (!canQuery || !formOpen) return
      const res = await supabase.from('agents').select('code,name').order('name', { ascending: true })
      if (res.error) {
        setAvailableAgents([])
        return
      }
      setAvailableAgents((res.data ?? []) as unknown as AgentRow[])
    }
    loadAgents()
  }, [canQuery, formOpen])

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!formOpen || !canQuery) return
    let cancelled = false
    ;(async () => {
      try {
        const packs = await listDomainPacks()
        if (!cancelled) setDomainPackOptions(mergeDomainPackOptions(packs.map((p) => ({ id: p.id, name: p.name }))))
      } catch {
        if (!cancelled) setDomainPackOptions(BUILTIN_DOMAIN_PACKS)
      }
    })()
    return () => { cancelled = true }
  }, [formOpen, canQuery])

  useEffect(() => {
    if (!domainPack) return
    let cancelled = false
    ;(async () => {
      const [bundleRes, playbookRows] = await Promise.all([
        listPlaybookBundles({ q: '', packId: domainPack, limit: 50 }),
        listPlaybooksForPack(domainPack).catch((): PlaybookRow[] => []),
      ])
      if (cancelled) return
      const bundles = mergeBundleOptions(domainPack, (bundleRes.data ?? []).map((b) => ({ slug: b.slug, name: b.name })))
      const playbooks = mergePlaybookOptions(domainPack, playbookRows.map((p) => ({ slug: p.slug, name: p.name })))
      setBundleOptions(bundles)
      setPlaybookOptions(playbooks)
    })()
    return () => { cancelled = true }
  }, [domainPack])

  useEffect(() => {
    if (domainPack === 'hibe-yazimi') {
      setRisk('R2'); setAllowHighRisk(true)
    } else if (domainPack === 'market-intel') {
      setRisk('R1'); setAllowHighRisk(false)
    }
  }, [domainPack])

  useEffect(() => {
    if (bundleOptions.length === 0) return
    if (!bundleOptions.some((b) => b.id === bundleId)) setBundleId(bundleOptions[0].id)
  }, [bundleOptions, bundleId])

  useEffect(() => {
    if (playbookOptions.length === 0) return
    if (!playbookOptions.some((p) => p.id === playbookId)) setPlaybookId(playbookOptions[0].id)
  }, [playbookOptions, playbookId])

  const filters = useMemo(() => ({ q, status, mode }), [q, status, mode])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true); setErr(null)
    let query = supabase
      .from('run_requests')
      .select('id,status,mode,domain_pack,request_text,model,web,contrarian,risk,allow_high_risk,started_at,finished_at,error_message,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.mode !== 'all') query = query.eq('mode', filters.mode)
    if (filters.q.trim()) {
      const term = `%${filters.q.trim()}%`
      query = query.or(`request_text.ilike.${term},domain_pack.ilike.${term}`)
    }

    const res = await query
    if (res.error) {
      setErr(res.error.message); setRows([])
    } else {
      setRows((res.data ?? []) as unknown as JobRow[])
    }
    setLoading(false)
  }, [canQuery, filters.mode, filters.q, filters.status])

  useEffect(() => { load() }, [load])

  const hasActive = useMemo(() => rows.some((r) => r.status === 'pending' || r.status === 'running'), [rows])

  useEffect(() => {
    if (!canQuery || !hasActive) return
    const id = window.setInterval(() => { load() }, 5000)
    return () => window.clearInterval(id)
  }, [canQuery, hasActive, load])

  async function createJob() {
    if (!user) return
    setSaving(true); setFormErr(null)
    try {
      let answers: unknown = null
      if (formMode === 'ceo-iterate') {
        try {
          answers = JSON.parse(answersJson)
        } catch {
          setFormErr('answers_json geçerli bir JSON olmalı')
          setSaving(false)
          return
        }
      } else if (formMode === 'run') {
        answers = { playbookId: playbookId.trim(), topic: requestText.trim() }
      } else if (formMode === 'bundle') {
        if (bundleOptions.length === 0) {
          setFormErr('Bu domain pack için bundle bulunamadı. Önce bir bundle oluştur veya "run" mode kullan.')
          setSaving(false)
          return
        }
        if (!bundleOptions.some((b) => b.id === bundleId.trim())) {
          setFormErr(`Geçersiz bundleId. Geçerli seçenekler: ${bundleOptions.map((b) => b.id).join(', ')}`)
          setSaving(false)
          return
        }
        answers = { bundleId: bundleId.trim(), topic: requestText.trim() }
      }

      const requestForRow = requestText.trim()
        ? formMode === 'run'
          ? `run:${playbookId.trim() || '-'} • ${requestText.trim()}`
          : formMode === 'bundle'
            ? `bundle:${bundleId.trim() || '-'} • ${requestText.trim()}`
            : requestText.trim()
        : null

      const inserted = await supabase.from('run_requests').insert({
        owner_user_id: user.id,
        mode: formMode,
        domain_pack: domainPack.trim() || null,
        request_text: requestForRow,
        answers_json: answers,
        selected_agents: selectedAgents.length > 0 ? selectedAgents : null,
        model: modelText.trim() || null,
        web, contrarian, risk,
        allow_high_risk: allowHighRisk,
      })

      if (inserted.error) {
        setFormErr(inserted.error.message)
        setSaving(false)
        return
      }

      setFormOpen(false)
      setRequestText(''); setAnswersJson('{}'); setRisk('R1'); setAllowHighRisk(false); setSelectedAgents([])
      setSaving(false)
      load()
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : 'Job oluşturulamadı')
      setSaving(false)
    }
  }

  const columns: Column<JobRow>[] = [
    {
      key: 'status', header: 'Durum', width: '100px',
      render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
    },
    {
      key: 'mode', header: 'Mode', width: '80px',
      render: (r) => <span className="text-xs text-white/60">{r.mode}</span>,
    },
    {
      key: 'domain_pack', header: 'Domain', width: '120px',
      render: (r) => <span className="text-xs text-white/60">{r.domain_pack ?? '—'}</span>,
    },
    {
      key: 'request_text', header: 'Request',
      render: (r) => (
        <div>
          <Link to={`/app/jobs/${r.id}`} className="text-blue-300 hover:underline text-xs">
            {(r.request_text ?? '').slice(0, 60) || '(empty)'}
          </Link>
          {r.error_message && <div className="mt-0.5 text-xs text-red-300">{r.error_message.slice(0, 50)}</div>}
        </div>
      ),
    },
    {
      key: 'updated_at', header: 'Güncelleme', width: '140px',
      render: (r) => <span className="text-xs text-white/40">{new Date(r.updated_at).toLocaleString()}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Run Jobs"
        description="Tüm agent job'ları"
        actions={
          <Button size="sm" onClick={() => setFormOpen(!formOpen)}>
            <Plus size={13} className="mr-1" /> {formOpen ? 'Kapat' : 'Yeni Job'}
          </Button>
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Request veya domain ara…" className="w-64" />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'all' | JobStatus)}
            className={SELECT_CLS + ' w-40'}
          >
            <option value="all">Tüm durumlar</option>
            <option value="pending">pending</option>
            <option value="running">running</option>
            <option value="success">success</option>
            <option value="fail">fail</option>
            <option value="cancelled">cancelled</option>
          </select>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'all' | JobMode)}
            className={SELECT_CLS + ' w-40'}
          >
            <option value="all">Tüm mode'ler</option>
            <option value="ceo">ceo</option>
            <option value="ceo-iterate">ceo-iterate</option>
            <option value="run">run</option>
            <option value="bundle">bundle</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus('all'); setMode('all') }}>Temizle</Button>
        </div>
      </Card>

      {formOpen && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">Yeni Job</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-white/40">Mode</label>
              <select value={formMode} onChange={(e) => setFormMode(e.target.value as JobMode)} className={SELECT_CLS}>
                <option value="ceo">ceo</option>
                <option value="ceo-iterate">ceo-iterate</option>
                <option value="run">run</option>
                <option value="bundle">bundle</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/40">Domain Pack</label>
              <select value={domainPack} onChange={(e) => setDomainPack(e.target.value)} className={SELECT_CLS}>
                {domainPackOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-white/40">
                {formMode === 'run' || formMode === 'bundle' ? 'Topic' : 'Request'}
              </label>
              <textarea
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/60"
              />
            </div>

            {formMode === 'run' && (
              <div>
                <label className="mb-1 block text-xs text-white/40">playbookId</label>
                {playbookOptions.length > 0 ? (
                  <select value={playbookId} onChange={(e) => setPlaybookId(e.target.value)} className={SELECT_CLS}>
                    {playbookOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input value={playbookId} onChange={(e) => setPlaybookId(e.target.value)} placeholder="playbook id" />
                )}
              </div>
            )}

            {formMode === 'bundle' && (
              <div>
                <label className="mb-1 block text-xs text-white/40">bundleId</label>
                {bundleOptions.length > 0 ? (
                  <select value={bundleId} onChange={(e) => setBundleId(e.target.value)} className={SELECT_CLS}>
                    {bundleOptions.map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input value={bundleId} onChange={(e) => setBundleId(e.target.value)} placeholder="bundle id" />
                )}
              </div>
            )}

            {formMode === 'ceo-iterate' && (
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-white/40">answers_json</label>
                <textarea
                  value={answersJson}
                  onChange={(e) => setAnswersJson(e.target.value)}
                  className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 font-mono text-xs text-white outline-none focus:border-blue-500/60"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-white/40">Model</label>
              <Input value={modelText} onChange={(e) => setModelText(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/40">Risk</label>
              <select value={risk} onChange={(e) => setRisk(e.target.value as 'R0' | 'R1' | 'R2' | 'R3')} className={SELECT_CLS}>
                <option value="R0">R0</option>
                <option value="R1">R1</option>
                <option value="R2">R2</option>
                <option value="R3">R3</option>
              </select>
            </div>

            <div className="md:col-span-2 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="rounded" />
                web
              </label>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={contrarian} onChange={(e) => setContrarian(e.target.checked)} className="rounded" />
                contrarian
              </label>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={allowHighRisk} onChange={(e) => setAllowHighRisk(e.target.checked)} className="rounded" />
                allow_high_risk
              </label>
            </div>

            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/40">Ajanlar</div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    checked={selectedAgents.length === 0}
                    onChange={() => setSelectedAgents([])}
                    className="rounded"
                  />
                  all
                </label>
                <div className="h-4 w-px bg-white/10" />
                <div className="max-h-24 flex flex-wrap gap-x-4 gap-y-2 overflow-auto">
                  {availableAgents.map((a) => {
                    const checked = selectedAgents.includes(a.code)
                    return (
                      <label key={a.code} className="flex items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...selectedAgents, a.code]))
                              : selectedAgents.filter((c) => c !== a.code)
                            setSelectedAgents(next)
                          }}
                          className="rounded"
                        />
                        <span className="font-mono text-white/60">{a.code}</span>
                        <span className="text-white/40">{a.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="mt-1 text-xs text-white/40">Seçim yapmazsan tüm ajanlar çalışır.</div>
            </div>
          </div>

          {formErr && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formErr}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>İptal</Button>
            <Button
              size="sm"
              onClick={createJob}
              disabled={saving || !requestText.trim() || (formMode === 'run' && !playbookId.trim()) || (formMode === 'bundle' && !bundleId.trim())}
            >
              Oluştur
            </Button>
          </div>
        </Card>
      )}

      {err && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}

      <Card className="overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-white/60">
          {rows.length} job
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          empty={<EmptyState icon={<Zap size={24} />} title="Job bulunamadı" />}
        />
      </Card>
    </div>
  )
}
