import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuthStore } from '@/stores/authStore'

type ReviewItem = {
  position: number
  question: string
  suggested_answer: string | null
  user_answer: string | null
  status: 'suggested' | 'edited' | 'approved'
  confidence: number | null
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

function buildStatus(answer: string, suggested: string | null): ReviewItem['status'] {
  const trimmed = answer.trim()
  if (!trimmed) return 'suggested'
  if (suggested && trimmed === suggested.trim()) return 'approved'
  return 'edited'
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
    const res = await fetch(`/api/ceo/jobs/${jobId}/review`, {
      headers: authHeaders,
    })
    const json = (await res.json()) as ReviewResponse
    if (!res.ok || !json.success) {
      setErr(json.error ?? 'Review yüklenemedi')
      setLoading(false)
      return
    }
    setJob(json.job)
    setItems(json.reviews)
    setLoading(false)
  }, [authHeaders, jobId])

  useEffect(() => {
    load()
  }, [load])

  function updateItem(position: number, updater: (item: ReviewItem) => ReviewItem) {
    setItems((current) => current.map((item) => (item.position === position ? updater(item) : item)))
  }

  async function generateSuggestions() {
    if (!jobId || !authHeaders) return
    setGenerating(true)
    setErr(null)
    setNotice(null)
    const res = await fetch(`/api/ceo/jobs/${jobId}/review/generate`, {
      method: 'POST',
      headers: authHeaders,
    })
    const json = (await res.json()) as { success: boolean; reviews?: ReviewItem[]; error?: string }
    if (!res.ok || !json.success) {
      setErr(json.error ?? 'Ajan önerileri üretilemedi')
      setGenerating(false)
      return
    }
    setItems((json.reviews ?? []).map((item) => ({
      ...item,
      user_answer: item.user_answer ?? item.suggested_answer ?? '',
      status: item.user_answer ? buildStatus(item.user_answer, item.suggested_answer) : 'approved',
    })))
    setNotice('Ajan önerileri oluşturuldu. İstersen düzenleyip kaydedebilirsin.')
    setGenerating(false)
  }

  async function saveAnswers() {
    if (!jobId || !authHeaders) return
    setSaving(true)
    setErr(null)
    setNotice(null)
    const payload = items.map((item) => ({
      position: item.position,
      user_answer: item.user_answer ?? '',
      status: buildStatus(item.user_answer ?? '', item.suggested_answer),
    }))
    const res = await fetch(`/api/ceo/jobs/${jobId}/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ items: payload }),
    })
    const json = (await res.json()) as { success: boolean; reviews?: ReviewItem[]; error?: string }
    if (!res.ok || !json.success) {
      setErr(json.error ?? 'Cevaplar kaydedilemedi')
      setSaving(false)
      return
    }
    setItems((json.reviews ?? []).map((item) => ({
      ...item,
      user_answer: item.user_answer ?? '',
    })))
    setNotice('Cevaplar kaydedildi.')
    setSaving(false)
  }

  async function runIterate() {
    if (!jobId || !authHeaders) return
    setIterating(true)
    setErr(null)
    setNotice(null)

    const savePayload = items.map((item) => ({
      position: item.position,
      user_answer: item.user_answer ?? '',
      status: buildStatus(item.user_answer ?? '', item.suggested_answer),
    }))

    const saveRes = await fetch(`/api/ceo/jobs/${jobId}/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ items: savePayload }),
    })
    const saveJson = (await saveRes.json()) as { success: boolean; error?: string }
    if (!saveRes.ok || !saveJson.success) {
      setErr(saveJson.error ?? 'Iterate öncesi kayıt başarısız')
      setIterating(false)
      return
    }

    const iterateRes = await fetch(`/api/ceo/jobs/${jobId}/review/iterate`, {
      method: 'POST',
      headers: authHeaders,
    })
    const iterateJson = (await iterateRes.json()) as { success: boolean; jobId?: string; error?: string }
    if (!iterateRes.ok || !iterateJson.success || !iterateJson.jobId) {
      setErr(iterateJson.error ?? 'CEO iterate job oluşturulamadı')
      setIterating(false)
      return
    }

    navigate(`/app/jobs/${iterateJson.jobId}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold">CEO Review</div>
          <div className="text-sm text-white/60">
            Ajan önerisini gör, cevabı düzenle ve onaylanan cevaplarla CEO iterate başlat.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>Geri</Button>
          <Button variant="outline" onClick={() => load()} disabled={loading}>Yenile</Button>
          <Button variant="secondary" onClick={() => generateSuggestions()} disabled={generating || !jobId}>
            {generating ? 'Üretiliyor...' : 'Ajan Önerilerini Oluştur'}
          </Button>
          <Button variant="outline" onClick={() => saveAnswers()} disabled={saving || items.length === 0}>
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
          <Button onClick={() => runIterate()} disabled={iterating || items.length === 0}>
            {iterating ? 'Hazırlanıyor...' : 'CEO Iterate Başlat'}
          </Button>
        </div>
      </div>

      {job ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Job Özeti</div>
          <div className="mt-2 grid gap-2 text-xs text-white/60 md:grid-cols-4">
            <div>Mode: {job.mode}</div>
            <div>Status: {job.status}</div>
            <div>Domain: {job.domain_pack ?? '-'}</div>
            <div>Job ID: {job.id}</div>
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/80">
            {job.request_text ?? '(empty)'}
          </pre>
        </Card>
      ) : null}

      {err ? <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div> : null}

      {loading ? (
        <Card className="p-4 text-sm text-white/70">Yükleniyor...</Card>
      ) : items.length === 0 ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Henüz soru yok</div>
          <div className="mt-2 text-sm text-white/60">
            CEO job tamamlandıktan sonra sorular burada görünür. Ardından ajan önerilerini üretebilirsin.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.position} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/50">Soru {item.position}</div>
                  <div className="mt-1 text-sm font-medium text-white">{item.question}</div>
                </div>
                <div className="text-xs text-white/50">
                  {item.confidence != null ? `Güven: %${Math.round(item.confidence * 100)}` : item.status}
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs text-white/60">Ajan önerisi</div>
                  <div className="min-h-[140px] whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/80">
                    {item.suggested_answer || 'Henüz ajan önerisi üretilmedi.'}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateItem(item.position, (current) => ({
                        ...current,
                        user_answer: current.suggested_answer ?? '',
                        status: 'approved',
                      }))}
                    >
                      Ajan cevabını kullan
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs text-white/60">Senin cevabın</div>
                  <textarea
                    value={item.user_answer ?? ''}
                    onChange={(e) =>
                      updateItem(item.position, (current) => ({
                        ...current,
                        user_answer: e.target.value,
                        status: buildStatus(e.target.value, current.suggested_answer),
                      }))
                    }
                    rows={8}
                    className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-blue-400"
                    placeholder="İstersen ajanın cevabını düzenle veya sıfırdan yaz."
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

