import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/PageHeader'
import { useAuthStore } from '@/stores/authStore'
import { parseApiResponse } from '@/lib/parseApiResponse'
import { ClipboardList } from 'lucide-react'

type ReviewItem = {
  position: number
  question: string
  suggested_answer: string | null
  user_answer: string | null
  status: 'suggested' | 'edited' | 'approved'
  confidence: number | null
  source: 'ceo' | 'user'
}

type ReviewResponse = {
  success: boolean
  job: {
    id: string
    mode: string
    status: string
    request_text: string | null
    domain_pack: string | null
  }
  runDir: string | null
  reviews: ReviewItem[]
  error?: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function buildStatus(answer: string, suggested: string | null): ReviewItem['status'] {
  const trimmed = answer.trim()
  if (!trimmed) return 'suggested'
  if (suggested && trimmed === suggested.trim()) return 'approved'
  return 'edited'
}

function statusTone(s: ReviewItem['status']): 'green' | 'yellow' | 'gray' {
  if (s === 'approved') return 'green'
  if (s === 'edited') return 'yellow'
  return 'gray'
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white/40">{pct}%</span>
    </div>
  )
}

export default function CeoReviewPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)

  const [job, setJob] = useState<ReviewResponse['job'] | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [iterating, setIterating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const authHeaders = useMemo(() => {
    if (!session?.access_token) return null
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    }
  }, [session?.access_token])

  const load = useCallback(async () => {
    if (!jobId || !authHeaders) return
    setLoading(true)
    setErr(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/review`, {
        headers: authHeaders,
      })
      const text = await res.text()
      const parsed = parseApiResponse<ReviewResponse>(text, res, 'Review yüklenemedi')
      if (parsed.ok === false) {
        setErr(parsed.error)
        return
      }
      setJob(parsed.data.job)
      setItems(parsed.data.reviews)
    } catch (e) {
      setErr(getErrorMessage(e, 'Review yüklenemedi'))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, jobId])

  useEffect(() => {
    load()
  }, [load])

  function updateItem(position: number, updater: (item: ReviewItem) => ReviewItem) {
    setItems((current) => current.map((item) => (item.position === position ? updater(item) : item)))
  }

  function addUserQuestion() {
    setItems((current) => {
      const nextPos = current.reduce((m, it) => Math.max(m, it.position), 0) + 1
      return [
        ...current,
        {
          position: nextPos,
          question: '',
          suggested_answer: null,
          user_answer: '',
          status: 'edited',
          confidence: null,
          source: 'user',
        },
      ]
    })
  }

  async function generateSuggestions() {
    if (!jobId || !authHeaders) return
    setGenerating(true)
    setErr(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/review/generate`, {
        method: 'POST',
        headers: authHeaders,
      })
      const text = await res.text()
      const parsed = parseApiResponse<{ success: boolean; reviews?: ReviewItem[] }>(text, res, 'Ajan önerileri üretilemedi')
      if (parsed.ok === false) {
        setErr(parsed.error)
        return
      }
      setItems((parsed.data.reviews ?? []).map((item) => ({
        ...item,
        user_answer: item.user_answer ?? item.suggested_answer ?? '',
        status: item.user_answer ? buildStatus(item.user_answer, item.suggested_answer) : 'approved',
      })))
      setNotice('Ajan önerileri oluşturuldu. İstersen düzenleyip kaydedebilirsin.')
    } catch (e) {
      setErr(getErrorMessage(e, 'Ajan önerileri üretilemedi'))
    } finally {
      setGenerating(false)
    }
  }

  async function saveAnswers() {
    if (!jobId || !authHeaders) return
    setSaving(true)
    setErr(null)
    setNotice(null)
    try {
      const payload = items.map((item) => ({
        position: item.position,
        user_answer: item.user_answer ?? '',
        status: buildStatus(item.user_answer ?? '', item.suggested_answer),
        ...(item.source === 'user' ? { source: 'user' as const, question: item.question } : {}),
      }))
      const res = await fetch(`/api/ceo/jobs/${jobId}/review`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ items: payload }),
      })
      const text = await res.text()
      const parsed = parseApiResponse<{ success: boolean; reviews?: ReviewItem[] }>(text, res, 'Cevaplar kaydedilemedi')
      if (parsed.ok === false) {
        setErr(parsed.error)
        return
      }
      setItems((parsed.data.reviews ?? []).map((item) => ({
        ...item,
        user_answer: item.user_answer ?? '',
      })))
      setNotice('Cevaplar kaydedildi.')
    } catch (e) {
      setErr(getErrorMessage(e, 'Cevaplar kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  async function runIterate() {
    if (!jobId || !authHeaders) return
    setIterating(true)
    setErr(null)
    setNotice(null)

    try {
      const savePayload = items.map((item) => ({
        position: item.position,
        user_answer: item.user_answer ?? '',
        status: buildStatus(item.user_answer ?? '', item.suggested_answer),
        ...(item.source === 'user' ? { source: 'user' as const, question: item.question } : {}),
      }))

      const saveRes = await fetch(`/api/ceo/jobs/${jobId}/review`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ items: savePayload }),
      })
      const saveText = await saveRes.text()
      const saveParsed = parseApiResponse<{ success: boolean }>(saveText, saveRes, 'Iterate öncesi kayıt başarısız')
      if (saveParsed.ok === false) {
        setErr(saveParsed.error)
        return
      }

      const iterateRes = await fetch(`/api/ceo/jobs/${jobId}/review/iterate`, {
        method: 'POST',
        headers: authHeaders,
      })
      const iterateText = await iterateRes.text()
      const iterateParsed = parseApiResponse<{ success: boolean; jobId?: string }>(
        iterateText,
        iterateRes,
        'CEO iterate job oluşturulamadı',
      )
      if (iterateParsed.ok === false) {
        setErr(iterateParsed.error)
        return
      }
      if (!iterateParsed.data.jobId) {
        setErr('CEO iterate job oluşturulamadı (jobId eksik)')
        return
      }

      navigate(`/app/jobs/${iterateParsed.data.jobId}`)
    } catch (e) {
      setErr(getErrorMessage(e, 'CEO iterate job oluşturulamadı'))
    } finally {
      setIterating(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="CEO Review"
        description="Ajan önerisini gör, cevabı düzenle ve onaylanan cevaplarla CEO iterate başlat."
        icon={<ClipboardList size={16} />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Geri</Button>
            <Button variant="secondary" size="sm" onClick={() => load()} disabled={loading}>
              {loading ? 'Yükleniyor…' : 'Yenile'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => generateSuggestions()} disabled={generating || !jobId}>
              {generating ? 'Üretiliyor…' : 'Ajan Önerilerini Oluştur'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => saveAnswers()} disabled={saving || items.length === 0}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
            <Button size="sm" onClick={() => runIterate()} disabled={iterating || items.length === 0}>
              {iterating ? 'Hazırlanıyor…' : 'CEO Iterate Başlat'}
            </Button>
          </div>
        }
      />

      {/* Job summary card */}
      {job ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-sm font-semibold text-white">Job Özeti</div>
          </div>
          <div className="grid gap-3 text-xs md:grid-cols-4">
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <div className="text-white/40 mb-0.5">Mode</div>
              <div className="font-medium text-white/80">{job.mode}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <div className="text-white/40 mb-0.5">Status</div>
              <div className="font-medium text-white/80">{job.status}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <div className="text-white/40 mb-0.5">Domain</div>
              <div className="font-medium text-white/80">{job.domain_pack ?? '-'}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <div className="text-white/40 mb-0.5">Job ID</div>
              <div className="font-mono font-medium text-white/60 truncate">{job.id}</div>
            </div>
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs text-white/70 max-h-32 overflow-auto">
            {job.request_text ?? '(empty)'}
          </pre>
        </Card>
      ) : null}

      {/* Alerts */}
      {err ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}

      {/* Question list */}
      {loading ? (
        <Card className="p-6 text-center text-sm text-white/50">Yükleniyor…</Card>
      ) : items.length === 0 ? (
        <Card className="p-6">
          <div className="text-sm font-medium text-white">Henüz soru yok</div>
          <div className="mt-1.5 text-sm text-white/50">
            CEO job tamamlandıktan sonra sorular burada görünür. Ardından ajan önerilerini üretebilirsin.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={`${item.source}-${item.position}`} className="overflow-hidden">
              {/* Question header */}
              <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 border border-blue-500/20 text-xs font-bold text-blue-300">
                    {item.position}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wider text-white/35">
                      {item.source === 'user' ? 'Senin sorun / notun' : 'Soru'}
                    </div>
                    {item.source === 'user' ? (
                      <textarea
                        value={item.question}
                        onChange={(e) =>
                          updateItem(item.position, (cur) => ({ ...cur, question: e.target.value }))
                        }
                        rows={2}
                        placeholder="Sorunu ya da bağlam notunu yaz…"
                        className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                      />
                    ) : (
                      <div className="text-sm font-medium leading-snug text-white">{item.question}</div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {item.source === 'user' && <Badge tone="blue">Senin</Badge>}
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  {item.confidence != null && <ConfidenceBar value={item.confidence} />}
                </div>
              </div>

              {/* Answer columns */}
              <div className="grid gap-0 md:grid-cols-2">
                {/* Suggested answer */}
                <div className="border-b border-white/[0.06] p-4 md:border-b-0 md:border-r">
                  <div className="mb-2 text-xs font-medium text-white/50">Ajan önerisi</div>
                  {item.suggested_answer ? (
                    <div className="rounded-lg border border-blue-500/15 bg-blue-500/[0.06] p-3 text-xs text-blue-200/80 whitespace-pre-wrap min-h-[120px]">
                      {item.suggested_answer}
                    </div>
                  ) : (
                    <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-white/30">
                      Henüz ajan önerisi üretilmedi.
                    </div>
                  )}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!item.suggested_answer || !item.suggested_answer.trim()}
                      onClick={() => updateItem(item.position, (current) => {
                        const suggested = current.suggested_answer ?? ''
                        if (!suggested.trim()) return current
                        return {
                          ...current,
                          user_answer: suggested,
                          status: 'approved',
                        }
                      })}
                    >
                      Ajan cevabını kullan
                    </Button>
                  </div>
                </div>

                {/* User answer */}
                <div className="p-4">
                  <div className="mb-2 text-xs font-medium text-white/50">Senin cevabın</div>
                  <textarea
                    value={item.user_answer ?? ''}
                    onChange={(e) =>
                      updateItem(item.position, (current) => ({
                        ...current,
                        user_answer: e.target.value,
                        status: buildStatus(e.target.value, current.suggested_answer),
                      }))
                    }
                    rows={7}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition-all duration-150 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/15 placeholder:text-white/20 resize-none"
                    placeholder="İstersen ajanın cevabını düzenle veya sıfırdan yaz."
                  />
                </div>
              </div>
            </Card>
          ))}
          <button
            type="button"
            onClick={addUserQuestion}
            className="w-full rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-white/50 transition-all hover:border-blue-400/40 hover:bg-white/[0.03] hover:text-white/70"
          >
            + Kendi sorunu/notunu ekle
          </button>
        </div>
      )}
    </div>
  )
}
