import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Trash2, Plus, Bell } from 'lucide-react'

type Channel = {
  id: string
  type: 'slack_webhook' | 'email'
  target: string
  label: string | null
  enabled: boolean
  created_at: string
}

type NewChannel = {
  type: 'slack_webhook' | 'email'
  target: string
  label: string
}

const TYPE_LABELS: Record<string, string> = {
  slack_webhook: 'Slack Webhook',
  email: 'E-posta',
}

export default function NotificationChannelsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [channels,  setChannels]  = useState<Channel[]>([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState<string | null>(null)
  const [testing,   setTesting]   = useState<string | null>(null)
  const [testMsg,   setTestMsg]   = useState<Record<string, 'ok' | 'err'>>({})
  const [err,       setErr]       = useState<string | null>(null)

  const [form, setForm] = useState<NewChannel>({ type: 'slack_webhook', target: '', label: '' })

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)
    const { data, error } = await supabase
      .from('notification_channels')
      .select('id, type, target, label, enabled, created_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) { setErr(error.message); setLoading(false); return }
    setChannels((data ?? []) as Channel[])
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!user || !form.target.trim()) return
    setSaving(true); setErr(null)
    const { error } = await supabase.from('notification_channels').insert({
      owner_user_id: user.id,
      type:          form.type,
      target:        form.target.trim(),
      label:         form.label.trim() || null,
      enabled:       true,
    })
    if (error) { setErr(error.message) }
    else { setForm({ type: 'slack_webhook', target: '', label: '' }); await load() }
    setSaving(false)
  }

  async function toggle(id: string, enabled: boolean) {
    const { error } = await supabase
      .from('notification_channels')
      .update({ enabled: !enabled })
      .eq('id', id)
    if (error) setErr(error.message)
    else await load()
  }

  async function remove(id: string) {
    setDeleting(id); setErr(null)
    const { error } = await supabase
      .from('notification_channels')
      .delete()
      .eq('id', id)
    if (error) setErr(error.message)
    else await load()
    setDeleting(null)
  }

  async function testChannel(id: string) {
    setTesting(id); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setErr('Oturum bulunamadı'); setTesting(null); return }
      const resp = await fetch('/api/notifications/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ channel_id: id }),
      })
      const json = await resp.json() as { ok: boolean; error?: string }
      if (json.ok) {
        setTestMsg((prev) => ({ ...prev, [id]: 'ok' }))
        setTimeout(() => setTestMsg((prev) => { const n = { ...prev }; delete n[id]; return n }), 4000)
      } else {
        setErr(json.error ?? 'Test başarısız')
        setTestMsg((prev) => ({ ...prev, [id]: 'err' }))
        setTimeout(() => setTestMsg((prev) => { const n = { ...prev }; delete n[id]; return n }), 4000)
      }
    } catch (e) {
      setErr((e as Error).message)
    }
    setTesting(null)
  }

  if (!initialized) return null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Bell size={18} />}
        title="Bildirim Kanalları"
        description="Onay bekleyenler için Slack ve e-posta bildirimleri."
      />

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Yeni kanal formu */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Yeni Kanal Ekle</p>
        <div className="flex flex-wrap gap-3">
          <select
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as NewChannel['type'] }))}
          >
            <option value="slack_webhook">Slack Webhook</option>
            <option value="email">E-posta</option>
          </select>

          <input
            className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder-white/30"
            placeholder={form.type === 'slack_webhook' ? 'https://hooks.slack.com/...' : 'ornek@firma.com'}
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
            type={form.type === 'email' ? 'email' : 'url'}
          />

          <input
            className="w-40 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder-white/30"
            placeholder="Etiket (ör. #tedarik)"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />

          <Button
            size="sm"
            onClick={save}
            disabled={saving || !form.target.trim()}
            className="flex items-center gap-1"
          >
            <Plus size={14} />
            {saving ? 'Kaydediliyor…' : 'Ekle'}
          </Button>
        </div>
      </Card>

      {/* Kanal listesi */}
      {loading ? (
        <p className="text-sm text-white/40">Yükleniyor…</p>
      ) : channels.length === 0 ? (
        <Card className="p-6 text-center text-sm text-white/40">
          Henüz bildirim kanalı yok. Yukarıdan ekleyin.
        </Card>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <Card key={ch.id} className="p-3 flex items-center gap-3">
              <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-white/70">
                {TYPE_LABELS[ch.type] ?? ch.type}
              </span>

              <span className="flex-1 text-sm text-white/60 truncate">
                {ch.label ? (
                  <><span className="text-white/80 font-medium">{ch.label}</span> · </>
                ) : null}
                {/* target hassas — kısaltılmış göster */}
                {ch.target.length > 40 ? ch.target.slice(0, 40) + '…' : ch.target}
              </span>

              <button
                onClick={() => toggle(ch.id, ch.enabled)}
                className={`text-xs px-2 py-0.5 rounded border transition ${
                  ch.enabled
                    ? 'border-green-500/30 text-green-400 bg-green-500/10 hover:bg-green-500/20'
                    : 'border-white/10 text-white/30 hover:bg-white/5'
                }`}
              >
                {ch.enabled ? 'Aktif' : 'Pasif'}
              </button>

              <button
                onClick={() => testChannel(ch.id)}
                disabled={testing === ch.id}
                className={`text-xs px-2 py-0.5 rounded transition ${
                  testMsg[ch.id] === 'ok'  ? 'bg-emerald-500/20 text-emerald-300' :
                  testMsg[ch.id] === 'err' ? 'bg-red-500/20 text-red-300' :
                  'text-white/40 hover:text-white/70 border border-white/10'
                }`}
                title="Test mesajı gönder"
              >
                {testing === ch.id ? '…' : testMsg[ch.id] === 'ok' ? '✓ Gönderildi' : testMsg[ch.id] === 'err' ? '✗ Hata' : 'Test Gönder'}
              </button>

              <button
                onClick={() => remove(ch.id)}
                disabled={deleting === ch.id}
                className="text-red-400/60 hover:text-red-400 transition"
                title="Sil"
              >
                <Trash2 size={15} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
