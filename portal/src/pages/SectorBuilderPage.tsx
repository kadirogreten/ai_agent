import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { listDomainPacks, triggerSectorDiscovery, type DomainPackRow } from '@/lib/domainPacks'
import { Sparkles, Globe, FileText, Loader2, CheckCircle, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'

const EXAMPLE_PROMPTS = [
  'Fintech — bireysel kredi skorlama ve risk değerlendirmesi',
  'Sağlık turizmi — yabancı hasta yönlendirme ve klinik eşleştirme',
  'Lojistik — son mil teslimat optimizasyonu ve müşteri bildirimi',
  'Hukuk — sözleşme inceleme ve uyumluluk denetimi',
  'İnsan kaynakları — CV tarama ve yetenek değerlendirme',
]

export default function SectorBuilderPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runRequestId, setRunRequestId] = useState<string | null>(null)
  const [existingPacks, setExistingPacks] = useState<DomainPackRow[]>([])

  useEffect(() => {
    listDomainPacks().then(setExistingPacks).catch(console.error)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim() || !user?.id) return

    setSubmitting(true)
    setError(null)
    try {
      const id = await triggerSectorDiscovery(prompt.trim(), user.id)
      setRunRequestId(id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Başlık */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Sparkles className="h-5 w-5 text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Sektör Keşif Ajanı</h1>
        </div>
        <p className="text-white/60 text-sm max-w-2xl">
          Sektörünüzü kısa bir cümleyle açıklayın. AgentArmy araştırma yaparak size özel bir domain pack
          (playbook'lar, persona'lar, glossary ve regülasyon notları) taslağı oluşturur.
          Taslağı inceleyip onayladıktan sonra hemen kullanmaya başlayabilirsiniz.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sol: Form */}
        <div className="lg:col-span-2 space-y-6">
          {runRequestId ? (
            // Başarı durumu
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-400" />
                <h2 className="text-lg font-semibold text-green-300">Keşif görevi başlatıldı!</h2>
              </div>
              <p className="text-white/60 text-sm">
                Run ID: <code className="font-mono text-white/80">{runRequestId}</code>
              </p>
              <p className="text-white/60 text-sm">
                Ajan araştırmasını tamamladıktan sonra taslak{' '}
                <strong className="text-white">Taslak İnceleme</strong> sayfasında görünecek.
                Birkaç dakika sonra kontrol edin.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate('/app/pack-drafts')}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
                >
                  Taslakları Görüntüle
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { setRunRequestId(null); setPrompt('') }}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 hover:border-white/40 hover:text-white transition-colors"
                >
                  Yeni Sektör
                </button>
              </div>
            </div>
          ) : (
            // Form
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Sektör Açıklaması
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="Örnek: Fintech — bireysel kredi skorlama, risk değerlendirmesi ve kullanıcı bildirimi akışları"
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none"
                />
                <p className="mt-1 text-xs text-white/40">
                  Ne kadar detaylı açıklarsanız, taslak o kadar isabetli olur.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!prompt.trim() || submitting}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Görev Başlatılıyor…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Keşif Başlat
                  </>
                )}
              </button>
            </form>
          )}

          {/* Örnek promptlar */}
          {!runRequestId && (
            <div>
              <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
                Örnek Sektörler
              </p>
              <div className="grid grid-cols-1 gap-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrompt(p)}
                    className="text-left rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/60 hover:border-white/20 hover:text-white/80 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sağ: Mevcut Packler */}
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
              Mevcut Domain Packler ({existingPacks.length})
            </p>
            <div className="space-y-2">
              {existingPacks.filter(p => !p.meta?.isSystemPack).map((pack) => (
                <div
                  key={pack.id}
                  className="rounded-lg border border-white/10 bg-white/5 p-3"
                >
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

          {/* Taslaklar linki */}
          <button
            onClick={() => navigate('/app/pack-drafts')}
            className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60 hover:border-white/20 hover:text-white/80 transition-colors"
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
