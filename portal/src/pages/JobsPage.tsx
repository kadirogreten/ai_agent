import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

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

export default function JobsPage() {
  const init = useAuthStore((s) => s.init)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [rows, setRows] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | JobStatus>('all')
  const [mode, setMode] = useState<'all' | JobMode>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<JobMode>('ceo')
  const [domainPack, setDomainPack] = useState('market-intel')
  const [requestText, setRequestText] = useState('')
  const [answersJson, setAnswersJson] = useState('{}')
  const [playbookId, setPlaybookId] = useState('brand-site')
  const [bundleId, setBundleId] = useState('weekly')
  const [availableAgents, setAvailableAgents] = useState<AgentRow[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [modelText, setModelText] = useState('gpt-4.1')
  const [web, setWeb] = useState(true)
  const [contrarian, setContrarian] = useState(false)
  const [risk, setRisk] = useState<'R0' | 'R1' | 'R2' | 'R3'>('R1')
  const [allowHighRisk, setAllowHighRisk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

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

  useEffect(() => {
    init()
  }, [init])

  const filters = useMemo(() => ({ q, status, mode }), [q, status, mode])

  const load = useCallback(async () => {
    if (!canQuery) return
    setLoading(true)
    setErr(null)
    let query = supabase
      .from('run_requests')
      .select(
        'id,status,mode,domain_pack,request_text,model,web,contrarian,risk,allow_high_risk,started_at,finished_at,error_message,created_at,updated_at',
      )
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
      setErr(res.error.message)
      setRows([])
    } else {
      setRows((res.data ?? []) as unknown as JobRow[])
    }
    setLoading(false)
  }, [canQuery, filters.mode, filters.q, filters.status])

  useEffect(() => {
    load()
  }, [load])

  const hasActive = useMemo(() => rows.some((r) => r.status === 'pending' || r.status === 'running'), [rows])

  useEffect(() => {
    if (!canQuery || !hasActive) return
    const id = window.setInterval(() => {
      load()
    }, 5000)
    return () => window.clearInterval(id)
  }, [canQuery, hasActive, load])

  async function createJob() {
    if (!user) return
    setSaving(true)
    setFormErr(null)
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
        answers = {
          playbookId: playbookId.trim(),
          topic: requestText.trim(),
        }
      } else if (formMode === 'bundle') {
        answers = {
          bundleId: bundleId.trim(),
          topic: requestText.trim(),
        }
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
        web,
        contrarian,
        risk,
        allow_high_risk: allowHighRisk,
      })

      if (inserted.error) {
        setFormErr(inserted.error.message)
        setSaving(false)
        return
      }

      setFormOpen(false)
      setRequestText('')
      setAnswersJson('{}')
      setRisk('R1')
      setAllowHighRisk(false)
      setSelectedAgents([])
      setSaving(false)
      load()
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : 'Job oluşturulamadı')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-white/60">Arama</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="request/domain..." />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Status</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'all' | JobStatus)}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="all">all</option>
                <option value="pending">pending</option>
                <option value="running">running</option>
                <option value="success">success</option>
                <option value="fail">fail</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Mode</div>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'all' | JobMode)}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="all">all</option>
                <option value="ceo">ceo</option>
                <option value="ceo-iterate">ceo-iterate</option>
                <option value="run">run</option>
                <option value="bundle">bundle</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => load()} disabled={loading}>
              Yenile
            </Button>
            <Button variant="secondary" onClick={() => { setQ(''); setStatus('all'); setMode('all') }}>
              Temizle
            </Button>
            <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? 'Kapat' : 'Yeni Job'}</Button>
          </div>
        </div>
        <div className="mt-3 text-xs text-white/60">
          Worker işleri periyodik olarak alır; pending/running durumları otomatik yenilenir.
        </div>
      </Card>

      {formOpen ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Yeni Job</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-white/60">Mode</div>
              <select
                value={formMode}
                onChange={(e) => setFormMode(e.target.value as JobMode)}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="ceo">ceo</option>
                <option value="ceo-iterate">ceo-iterate</option>
                <option value="run">run</option>
                <option value="bundle">bundle</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Domain Pack</div>
              <Input value={domainPack} onChange={(e) => setDomainPack(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">
                {formMode === 'run' || formMode === 'bundle' ? 'Topic' : 'Request'}
              </div>
              <textarea
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                className="min-h-24 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
              />
            </div>

            {formMode === 'run' ? (
              <div>
                <div className="mb-1 text-xs text-white/60">playbookId</div>
                <Input value={playbookId} onChange={(e) => setPlaybookId(e.target.value)} placeholder="brand-site" />
              </div>
            ) : null}

            {formMode === 'bundle' ? (
              <div>
                <div className="mb-1 text-xs text-white/60">bundleId</div>
                <Input value={bundleId} onChange={(e) => setBundleId(e.target.value)} placeholder="weekly" />
              </div>
            ) : null}

            {formMode === 'ceo-iterate' ? (
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-white/60">answers_json</div>
                <textarea
                  value={answersJson}
                  onChange={(e) => setAnswersJson(e.target.value)}
                  className="min-h-24 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
                />
              </div>
            ) : null}
            <div>
              <div className="mb-1 text-xs text-white/60">Model</div>
              <Input value={modelText} onChange={(e) => setModelText(e.target.value)} />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Risk</div>
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as 'R0' | 'R1' | 'R2' | 'R3')}
                className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                <option value="R0">R0</option>
                <option value="R1">R1</option>
                <option value="R2">R2</option>
                <option value="R3">R3</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
                web
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={contrarian} onChange={(e) => setContrarian(e.target.checked)} />
                contrarian
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={allowHighRisk} onChange={(e) => setAllowHighRisk(e.target.checked)} />
                allow_high_risk
              </label>
            </div>

            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-white/60">Ajanlar (seçmezsen tümü çalışır)</div>
              {availableAgents.length === 0 ? (
                <div className="text-xs text-white/60">Ajan bulunamadı</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {availableAgents.map((a) => {
                    const checked = selectedAgents.includes(a.code)
                    return (
                      <label key={a.code} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked
                            setSelectedAgents((prev) => {
                              if (on) return Array.from(new Set(prev.concat([a.code])))
                              return prev.filter((x) => x !== a.code)
                            })
                          }}
                        />
                        <span className="truncate">{a.name} <span className="text-xs text-white/50">({a.code})</span></span>
                      </label>
                    )
                  })}
                </div>
              )}
              {availableAgents.length > 0 ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setSelectedAgents(availableAgents.map((a) => a.code))}
                    disabled={saving}
                  >
                    Tümünü seç
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setSelectedAgents([])}
                    disabled={saving}
                  >
                    Temizle
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          {formErr ? <div className="mt-3 text-sm text-red-200">{formErr}</div> : null}
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>İptal</Button>
            <Button onClick={createJob} disabled={saving || !requestText.trim() || (formMode === 'run' && !playbookId.trim()) || (formMode === 'bundle' && !bundleId.trim())}>
              Oluştur
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Jobs</div>
        {err ? <div className="px-4 py-3 text-sm text-red-200">{err}</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[#0B1020]">
              <tr className="border-b border-white/10 text-xs text-white/60">
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Mode</th>
                <th className="px-4 py-2">Domain</th>
                <th className="px-4 py-2">Request</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={5}>Yükleniyor...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-white/60" colSpan={5}>Kayıt yok</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.mode}</td>
                    <td className="px-4 py-2 text-xs text-white/70">{r.domain_pack ?? '-'}</td>
                    <td className="px-4 py-2">
                      <Link to={`/app/jobs/${r.id}`} className="text-blue-200 hover:underline">
                        {(r.request_text ?? '').slice(0, 80) || '(empty)'}
                      </Link>
                      {r.error_message ? <div className="mt-1 text-xs text-red-200">{r.error_message}</div> : null}
                    </td>
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
