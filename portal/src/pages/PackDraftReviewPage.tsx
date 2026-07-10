import { useState, useEffect, useCallback } from 'react'
import {
  listDrafts, mergeDraft, rejectDraft,
  type PackDraftRow, type DraftStatus,
} from '@/lib/domainPacks'
import { useAuthStore } from '@/stores/authStore'
import {
  CheckCircle, XCircle, Clock, Merge, FileText,
  ChevronDown, ChevronUp, RefreshCw, AlertCircle, Download, Upload,
} from 'lucide-react'

// ── Badge'ler ─────────────────────────────────────────────────

const STATUS_CONFIG: Record<DraftStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending:  { label: 'Bekliyor',   className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30', icon: <Clock className="h-3 w-3" /> },
  approved: { label: 'Onaylandı', className: 'bg-green-500/20 text-green-300 border-green-500/30',  icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: 'Reddedildi', className: 'bg-red-500/20 text-red-300 border-red-500/30',      icon: <XCircle className="h-3 w-3" /> },
  merged:   { label: 'Birleştirildi', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: <Merge className="h-3 w-3" /> },
}

function StatusBadge({ status }: { status: DraftStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ── JSON Görüntüleyici ────────────────────────────────────────

function DraftJsonViewer({ draft }: { draft: PackDraftRow }) {
  const [expanded, setExpanded] = useState(false)

  const json = draft.draft_json
  const playbooks = Array.isArray(json?.playbooks) ? json.playbooks as { slug?: string; name?: string; default_risk?: string }[] : []
  const personas  = Array.isArray(json?.personas)  ? json.personas  as { slug?: string; name?: string }[] : []
  const bundles   = Array.isArray(json?.bundles)   ? json.bundles   as { slug?: string; name?: string }[] : []

  return (
    <div className="space-y-4">
      {/* Özet kartlar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-2xl font-bold text-violet-400">{playbooks.length}</p>
          <p className="text-xs text-white/50 mt-1">Playbook</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-2xl font-bold text-blue-400">{personas.length}</p>
          <p className="text-xs text-white/50 mt-1">Persona</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{bundles.length}</p>
          <p className="text-xs text-white/50 mt-1">Bundle</p>
        </div>
      </div>

      {/* Playbook listesi */}
      {playbooks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Playbook'lar</p>
          <div className="space-y-1">
            {playbooks.map((pb, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-white/5 px-3 py-1.5 text-sm">
                <span className="text-white/80">{pb.name ?? pb.slug}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  pb.default_risk === 'R3' ? 'bg-red-500/20 text-red-300' :
                  pb.default_risk === 'R2' ? 'bg-orange-500/20 text-orange-300' :
                  pb.default_risk === 'R1' ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-green-500/20 text-green-300'
                }`}>
                  {pb.default_risk ?? 'R1'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ham JSON aç/kapa */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-white/40 hover:text-white/60 transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Ham JSON {expanded ? 'Gizle' : 'Göster'}
      </button>

      {expanded && (
        <pre className="rounded-lg border border-white/10 bg-black/40 p-4 text-xs text-green-300 overflow-auto max-h-96 font-mono">
          {JSON.stringify(json, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── Taslak Kart ───────────────────────────────────────────────

function DraftCard({
  draft,
  onRefresh,
}: {
  draft: PackDraftRow
  onRefresh: () => void
}) {
  const session = useAuthStore((s) => s.session)
  const [expanded, setExpanded] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isPending = draft.status === 'pending'

  async function handleExport() {
    if (!session?.access_token) return
    const res = await fetch(`/api/packs/drafts/${draft.id}/export`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) throw new Error('Export başarısız')
    const json = await res.json()
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pack-manifest-${draft.proposed_pack_id ?? draft.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const evalBlocked = isPending && draft.eval_status && draft.eval_status !== 'passed' && draft.eval_status !== 'skipped'

  async function handleMerge() {
    if (evalBlocked) {
      setError('Eval geçmeden merge yapılamaz (eval_status=' + draft.eval_status + ')')
      return
    }
    if (!confirm(`"${draft.proposed_name ?? draft.proposed_pack_id}" pack'ini aktif hale getirmek istiyor musunuz?`)) return
    setLoading(true)
    setError(null)
    try {
      const packId = await mergeDraft(draft.id)
      setSuccess(`Pack "${packId}" başarıyla oluşturuldu!`)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Birleştirme hatası')
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    setError(null)
    try {
      await rejectDraft(draft.id, rejectNotes || undefined)
      setShowRejectForm(false)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reddetme hatası')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${
      isPending ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-white/10 bg-white/5'
    }`}>
      {/* Başlık satırı */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white truncate">
              {draft.proposed_name ?? draft.proposed_pack_id ?? 'İsimsiz Taslak'}
            </h3>
            <StatusBadge status={draft.status} />
          </div>
          {draft.proposed_pack_id && (
            <p className="text-xs text-white/40 font-mono mt-0.5">
              id: {draft.proposed_pack_id}
            </p>
          )}
          <p className="text-sm text-white/60 mt-1 line-clamp-2">
            "{draft.sector_prompt}"
          </p>
          <p className="text-xs text-white/30 mt-1">
            {new Date(draft.created_at).toLocaleString('tr-TR')}
          </p>
          {draft.eval_status && (
            <p className={`text-xs mt-1 font-medium ${
              draft.eval_status === 'passed' ? 'text-green-400' :
              draft.eval_status === 'failed' ? 'text-red-400' :
              'text-amber-400'
            }`}>
              Eval: {draft.eval_status}
              {draft.eval_json && typeof draft.eval_json === 'object' && 'source_mix' in (draft.eval_json as object) && (
                <span className="text-white/40 font-normal ml-2">
                  (rubric={(draft.eval_json as { source_mix?: { pack_rubric?: number; d0_security?: number } }).source_mix?.pack_rubric ?? 0}
                  {' '}/ D0={(draft.eval_json as { source_mix?: { d0_security?: number } }).source_mix?.d0_security ?? 0})
                </span>
              )}
            </p>
          )}
          {Array.isArray((draft.draft_json as { suggested_mcp?: unknown })?.suggested_mcp) &&
            ((draft.draft_json as { suggested_mcp: unknown[] }).suggested_mcp.length > 0) && (
            <p className="text-xs text-violet-300/90 mt-1">
              MCP önerisi: {(draft.draft_json as { suggested_mcp: Array<{ name?: string; slug?: string }> }).suggested_mcp
                .slice(0, 3)
                .map((s) => s.name ?? s.slug)
                .join(', ')}
              {' '}— Araçlar → MCP keşfet
            </p>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 p-1.5 rounded-lg border border-white/10 hover:border-white/20 text-white/50 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Detaylar */}
      {expanded && (
        <div className="border-t border-white/10 pt-4">
          <DraftJsonViewer draft={draft} />
        </div>
      )}

      {/* Hata / başarı mesajları */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* İnceleme notları (merge/reject sonrası) */}
      {draft.review_notes && (
        <p className="text-xs text-white/40 italic">
          Not: {draft.review_notes}
        </p>
      )}

      {/* Aksiyon butonları (sadece pending) */}
      {isPending && !success && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {evalBlocked && (
            <div className="w-full text-xs text-amber-300 mb-1">
              Eval başarısız veya bekliyor — merge kapalı (pass³ gerekli)
            </div>
          )}
          <button
            onClick={() => handleExport().catch((e) => setError(e.message))}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            <Download className="h-4 w-4" />
            Manifest İndir
          </button>
          <button
            onClick={handleMerge}
            disabled={loading || evalBlocked}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
          >
            <Merge className="h-4 w-4" />
            Onayla & Aktifleştir
          </button>

          {!showRejectForm && (
            <button
              onClick={() => setShowRejectForm(true)}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            >
              <XCircle className="h-4 w-4" />
              Reddet
            </button>
          )}

          {showRejectForm && (
            <div className="w-full space-y-2">
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={2}
                placeholder="Reddetme notu (opsiyonel)"
                className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-red-500/50 focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                >
                  {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                  Reddet
                </button>
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                >
                  İptal
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Ana Sayfa ─────────────────────────────────────────────────

export default function PackDraftReviewPage() {
  const session = useAuthStore((s) => s.session)
  const [drafts, setDrafts] = useState<PackDraftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<DraftStatus | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listDrafts(filter === 'all' ? undefined : filter)
      setDrafts(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Yükleme hatası')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const pendingCount = drafts.filter(d => d.status === 'pending').length

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-yellow-500/20 border border-yellow-500/30">
              <FileText className="h-5 w-5 text-yellow-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Taslak İnceleme</h1>
            {pendingCount > 0 && (
              <span className="rounded-full bg-yellow-500/20 border border-yellow-500/30 px-2 py-0.5 text-xs font-medium text-yellow-300">
                {pendingCount} bekliyor
              </span>
            )}
          </div>
          <p className="text-white/50 text-sm">
            Sector Discovery Ajanı'nın oluşturduğu domain pack taslakları.
          </p>
        </div>

        <div className="flex items-center gap-2">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:border-white/40 hover:text-white transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
        <label className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/60 hover:border-white/40 cursor-pointer">
          <Upload className="h-4 w-4" />
          İçe Aktar
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file || !session?.access_token) return
              try {
                const text = await file.text()
                const body = JSON.parse(text)
                const res = await fetch('/api/packs/import', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(body),
                })
                const json = await res.json() as { error?: string }
                if (!res.ok) throw new Error(json.error ?? 'Import başarısız')
                load()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Import hatası')
              }
            }}
          />
        </label>
        </div>
      </div>

      {/* Filtre */}
      <div className="flex gap-2">
        {(['all', 'pending', 'merged', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === f
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {f === 'all' ? 'Tümü' :
             f === 'pending' ? 'Bekliyor' :
             f === 'merged' ? 'Birleştirildi' : 'Reddedildi'}
          </button>
        ))}
      </div>

      {/* İçerik */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-8 py-16 text-center">
          <FileText className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/50 text-sm">
            {filter === 'pending' ? 'Bekleyen taslak yok.' : 'Henüz taslak oluşturulmamış.'}
          </p>
          <p className="text-white/30 text-xs mt-1">
            Yeni taslak için{' '}
            <a href="/app/sector-builder" className="text-violet-400 hover:underline">
              Sektör Keşif Ajanı
            </a>
            'nı kullanın.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  )
}
