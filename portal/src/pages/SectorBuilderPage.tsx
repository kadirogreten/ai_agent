import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import {
  listDomainPacks,
  triggerSectorDialog,
  getRunRequest,
  startSectorFactoryOperation,
  getOperation,
  cooldownRemainingSeconds,
  formatCooldown,
  type DomainPackRow,
} from '@/lib/domainPacks'
import { parseApiResponse } from '@/lib/parseApiResponse'
import {
  Sparkles, Globe, FileText, Loader2, CheckCircle, ChevronRight,
  MessageSquare, Factory, AlertCircle,
} from 'lucide-react'

const EXAMPLE_PROMPTS = [
  'Fintech — bireysel kredi skorlama ve risk değerlendirmesi',
  'Sağlık turizmi — yabancı hasta yönlendirme ve klinik eşleştirme',
  'Lojistik — son mil teslimat optimizasyonu ve müşteri bildirimi',
  'Hukuk — sözleşme inceleme ve uyumluluk denetimi',
  'İnsan kaynakları — CV tarama ve yetenek değerlendirme',
]

type Phase = 'prompt' | 'waiting' | 'review' | 'operation' | 'done'

type ReviewItem = {
  position: number
  question: string
  suggested_answer: string | null
  user_answer: string | null
  status: string
}

// Durum tarayıcıda değil, KULLANICIYA göre saklanır: aynı tarayıcıda farklı hesapla
// girince başka hesabın operasyonu görünmesin (RLS zaten veriyi korur, ama görüntü
// de doğru hesaba ait olmalı). Anahtar user id ile scope'lanır.
const STORAGE_PREFIX = 'sector-builder-state'
const storageKeyFor = (userId: string | null | undefined) =>
  userId ? `${STORAGE_PREFIX}:${userId}` : null

function loadPersistedState(userId: string | null | undefined): { jobId: string | null; operationId: string | null; phase: Phase } {
  const key = storageKeyFor(userId)
  if (!key) return { jobId: null, operationId: null, phase: 'prompt' }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { jobId: null, operationId: null, phase: 'prompt' }
    return JSON.parse(raw) as { jobId: string | null; operationId: string | null; phase: Phase }
  } catch {
    return { jobId: null, operationId: null, phase: 'prompt' }
  }
}

function persistState(userId: string | null | undefined, jobId: string | null, operationId: string | null, phase: Phase) {
  const key = storageKeyFor(userId)
  if (!key) return
  localStorage.setItem(key, JSON.stringify({ jobId, operationId, phase }))
}

export default function SectorBuilderPage() {
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const navigate = useNavigate()

  const persisted = loadPersistedState(user?.id)
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<Phase>(persisted.phase)
  const [jobId, setJobId] = useState<string | null>(persisted.jobId)
  const [operationId, setOperationId] = useState<string | null>(persisted.operationId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingPacks, setExistingPacks] = useState<DomainPackRow[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [operationStatus, setOperationStatus] = useState<string | null>(null)
  const [stepCount, setStepCount] = useState<number | null>(null)
  const [maxSteps, setMaxSteps] = useState<number | null>(null)
  const [cooldownSec, setCooldownSec] = useState(0)
  const [lastTickAt, setLastTickAt] = useState<string | null>(null)
  const [cooldownMinutes, setCooldownMinutes] = useState<number | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const authHeaders = useMemo(() => {
    if (!session?.access_token) return null
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    }
  }, [session?.access_token])

  useEffect(() => {
    listDomainPacks().then(setExistingPacks).catch(console.error)
  }, [])

  // user async yüklendiyse ve bu oturumda henüz bir şey başlatılmadıysa,
  // KULLANICININ KENDİ kayıtlı durumunu geri yükle (sayfa yenileme desteği).
  useEffect(() => {
    if (!user?.id) return
    if (jobId || phase !== 'prompt') return
    const restored = loadPersistedState(user.id)
    if (restored.jobId || restored.operationId) {
      setJobId(restored.jobId)
      setOperationId(restored.operationId)
      setPhase(restored.phase)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    persistState(user?.id, jobId, operationId, phase)
  }, [user?.id, jobId, operationId, phase])

  const loadReview = useCallback(async () => {
    if (!jobId || !authHeaders) return
    const res = await fetch(`/api/ceo/jobs/${jobId}/review`, { headers: authHeaders })
    const text = await res.text()
    const parsed = parseApiResponse<{
      success: boolean
      reviews: ReviewItem[]
      job: { status: string; request_text: string | null }
    }>(text, res, 'Review yüklenemedi')
    if (parsed.ok === false) {
      setError(parsed.error)
      return
    }
    setReviewItems(parsed.data.reviews.map((r) => ({
      ...r,
      user_answer: r.user_answer ?? r.suggested_answer ?? '',
    })))
    if (parsed.data.job.status === 'success' && parsed.data.reviews.length > 0) {
      setPhase('review')
    }
  }, [authHeaders, jobId])

  const pollJob = useCallback(async () => {
    if (!jobId) return
    const job = await getRunRequest(jobId)
    if (job.status === 'success') {
      await loadReview()
    } else if (job.status === 'waiting_approval') {
      setError('CEO soru üretimi onay bekliyor. Onay Kuyruğu sayfasından onaylayın veya sayfayı sıfırlayıp tekrar başlatın.')
    } else if (job.status === 'fail') {
      setError(job.error_message ?? 'CEO planlama başarısız')
      setPhase('prompt')
    }
  }, [jobId, loadReview])

  useEffect(() => {
    if (phase !== 'waiting' || !jobId) return
    const t = setInterval(() => { pollJob().catch(console.error) }, 3000)
    pollJob().catch(console.error)
    return () => clearInterval(t)
  }, [phase, jobId, pollJob])

  useEffect(() => {
    if (phase === 'review' && jobId) loadReview().catch(console.error)
  }, [phase, jobId, loadReview])

  useEffect(() => {
    if (phase !== 'operation' || !operationId) return
    const poll = async () => {
      const op = await getOperation(operationId)
      setOperationStatus(op.status)
      setStepCount(op.step_count)
      setMaxSteps(op.max_steps)
      setLastTickAt(op.last_tick_at)
      setCooldownMinutes(op.cooldown_minutes)
      setCooldownSec(cooldownRemainingSeconds(op.last_tick_at, op.cooldown_minutes))
      const ctx = op.context_json as Record<string, unknown> | null
      if (typeof ctx?.draft_id === 'string') setDraftId(ctx.draft_id)
      if (op.status === 'done' || op.status === 'failed' || op.status === 'completed' || op.status === 'escalated') {
        setPhase('done')
      }
    }
    const t = setInterval(() => { poll().catch(console.error) }, 5000)
    poll().catch(console.error)
    return () => clearInterval(t)
  }, [phase, operationId])

  // Cooldown geri sayımı (1 sn) — poll aralığından bağımsız
  useEffect(() => {
    if (phase !== 'operation' || !lastTickAt) return
    const tick = () => setCooldownSec(cooldownRemainingSeconds(lastTickAt, cooldownMinutes))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [phase, lastTickAt, cooldownMinutes])

  async function handleStartDialog(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim() || !user?.id) return
    setSubmitting(true)
    setError(null)
    try {
      const id = await triggerSectorDialog(prompt.trim(), user.id)
      setJobId(id)
      setPhase('waiting')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata')
    } finally {
      setSubmitting(false)
    }
  }

  async function persistReview(showSuccess: boolean) {
    if (!jobId || !authHeaders) {
      throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.')
    }
    const res = await fetch(`/api/ceo/jobs/${jobId}/review`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        items: reviewItems.map((item) => ({
          position: item.position,
          user_answer: item.user_answer ?? '',
          status: item.user_answer?.trim() ? 'edited' : 'suggested',
        })),
      }),
    })
    const text = await res.text()
    const parsed = parseApiResponse<{ success: boolean }>(text, res, 'Kayıt başarısız')
    if (parsed.ok === false) throw new Error(parsed.error)
    if (showSuccess) setSaveMessage('Cevaplar kaydedildi.')
  }

  async function saveReview() {
    setSubmitting(true)
    setError(null)
    setSaveMessage(null)
    try {
      await persistReview(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kayıt hatası')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStartFactory() {
    if (!jobId || !session?.access_token) {
      setError('Oturum bulunamadı. Lütfen tekrar giriş yapın.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSaveMessage(null)
    try {
      await persistReview(false)
      const opId = await startSectorFactoryOperation(jobId, session.access_token)
      setOperationId(opId)
      setPhase('operation')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Operasyon başlatılamadı')
    } finally {
      setSubmitting(false)
    }
  }

  function resetFlow() {
    setJobId(null)
    setOperationId(null)
    setPhase('prompt')
    setPrompt('')
    setReviewItems([])
    setDraftId(null)
    setStepCount(null)
    setMaxSteps(null)
    setCooldownSec(0)
    setLastTickAt(null)
    setCooldownMinutes(null)
    setOperationStatus(null)
    const key = storageKeyFor(user?.id)
    if (key) localStorage.removeItem(key)
    // Eski global anahtar kalıntısını da temizle (geçiş)
    localStorage.removeItem(STORAGE_PREFIX)
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Sparkles className="h-5 w-5 text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Sektör Fabrikası</h1>
        </div>
        <p className="text-white/60 text-sm max-w-2xl">
          Sektörünüzü açıklayın → CEO ajanı netleştirici sorular sorar → cevaplarınızla
          otomatik araştırma, taslak üretimi ve eval kapısından geçen domain pack oluşturulur.
        </p>
      </div>

      {/* Faz göstergesi */}
      <div className="flex gap-2 text-xs">
        {(['prompt', 'review', 'operation', 'done'] as const).map((p, i) => (
          <span
            key={p}
            className={`rounded-full px-3 py-1 border ${
              phase === p || (phase === 'waiting' && p === 'prompt')
                ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                : 'border-white/10 text-white/40'
            }`}
          >
            {i + 1}. {p === 'prompt' ? 'Prompt' : p === 'review' ? 'Sorular' : p === 'operation' ? 'Fabrika' : 'Tamam'}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {saveMessage && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 flex gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {saveMessage}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {(phase === 'prompt' || phase === 'waiting') && (
            <form onSubmit={handleStartDialog} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Sektör Açıklaması</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  disabled={phase === 'waiting'}
                  placeholder="Örnek: Veteriner klinikleri — randevu, aşı takibi, acil müdahale"
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-500/50 focus:outline-none resize-none disabled:opacity-60"
                />
              </div>
              {phase === 'waiting' ? (
                <div className="flex items-center gap-2 text-violet-300 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  CEO ajanı soruları hazırlıyor… (Job: {jobId?.slice(0, 8)})
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim() || submitting}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  Soruları Başlat
                </button>
              )}
            </form>
          )}

          {phase === 'review' && (
            <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-violet-400" />
                Netleştirici Sorular
              </h2>
              {reviewItems.map((item) => (
                <div key={item.position} className="space-y-1">
                  <label className="text-sm text-white/70">{item.question}</label>
                  <textarea
                    value={item.user_answer ?? ''}
                    onChange={(e) => setReviewItems((items) =>
                      items.map((r) => r.position === item.position
                        ? { ...r, user_answer: e.target.value }
                        : r),
                    )}
                    rows={2}
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => saveReview()}
                  disabled={submitting}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
                >
                  {submitting ? 'Kaydediliyor…' : 'Cevapları Kaydet'}
                </button>
                <button
                  onClick={() => handleStartFactory()}
                  disabled={submitting || reviewItems.some((r) => !r.user_answer?.trim())}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  <Factory className="h-4 w-4" />
                  Fabrikayı Başlat
                </button>
              </div>
            </div>
          )}

          {phase === 'operation' && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-6 space-y-3">
              <div className="flex items-center gap-2 text-blue-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-medium">
                  {cooldownSec > 0
                    ? 'Sonraki adım için bekleniyor…'
                    : 'Sektör fabrikası çalışıyor…'}
                </span>
              </div>
              <p className="text-sm text-white/60">Operasyon: <code className="font-mono">{operationId}</code></p>
              <p className="text-sm text-white/60">Durum: {operationStatus ?? 'yükleniyor'}</p>
              {stepCount != null && maxSteps != null && (
                <p className="text-sm text-white/60">Adım: {stepCount} / {maxSteps}</p>
              )}
              {cooldownSec > 0 ? (
                <p className="text-sm text-amber-200/90">
                  Cooldown: sonraki tick’e <span className="font-mono font-medium">{formatCooldown(cooldownSec)}</span>
                </p>
              ) : (
                <p className="text-sm text-white/50">Cooldown bitti — bir sonraki tick adımı tetikleyebilir.</p>
              )}
              {draftId && (
                <button
                  onClick={() => navigate(`/app/pack-drafts`)}
                  className="text-sm text-violet-300 hover:underline"
                >
                  Taslak hazır — Taslak İnceleme sayfasına git →
                </button>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-400" />
                <h2 className="text-lg font-semibold text-green-300">Fabrika tamamlandı</h2>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate('/app/pack-drafts')}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white"
                >
                  Taslakları Görüntüle <ChevronRight className="h-4 w-4" />
                </button>
                <button onClick={resetFlow} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70">
                  Yeni Sektör
                </button>
              </div>
            </div>
          )}

          {phase === 'prompt' && (
            <div>
              <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Örnek Sektörler</p>
              <div className="grid grid-cols-1 gap-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="text-left rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/60 hover:border-white/20 hover:text-white/80"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
              Mevcut Domain Packler ({existingPacks.length})
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {existingPacks.filter((p) => !p.meta?.isSystemPack).map((pack) => (
                <div key={pack.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start gap-2">
                    <Globe className="h-4 w-4 text-white/40 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-white/80">{pack.name}</p>
                      <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{pack.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => navigate('/app/pack-drafts')}
            className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60 hover:border-white/20"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Taslak İncelemeleri
            </div>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
