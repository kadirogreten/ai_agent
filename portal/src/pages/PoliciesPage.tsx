import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Trash2, Plus, Settings } from 'lucide-react'

type PolicyRow = {
  id: string
  owner_user_id: string | null
  key: string
  value: unknown
  description: string | null
  updated_at: string
}

// Bilinen key'ler ve açıklamaları
const KNOWN_KEYS = [
  { key: 'riskgate.max_wait_hours',            label: 'RiskGate — Maksimum Bekleme (saat)',     type: 'number', placeholder: '4' },
  { key: 'riskgate.poll_seconds',              label: 'RiskGate — Yoklama Aralığı (saniye)',    type: 'number', placeholder: '15' },
  { key: 'oploop.wait_approval_timeout_hours', label: 'OperationLoop — Onay Zaman Aşımı (saat)', type: 'number', placeholder: '24' },
  { key: 'selfreflect.fail_rate',              label: 'SelfReflection — Başarısızlık Oranı',   type: 'number', placeholder: '0.4' },
  { key: 'selfreflect.min_runs',               label: 'SelfReflection — Min. Run Sayısı',      type: 'number', placeholder: '5' },
  { key: 'selfreflect.cooldown_hours',         label: 'SelfReflection — Bekleme (saat)',       type: 'number', placeholder: '24' },
  { key: 'memory.max_entries',                 label: 'Operasyon Belleği — Max Giriş',         type: 'number', placeholder: '30' },
  { key: 'cargo.stage_minutes',               label: 'Kargo Aşamaları (JSON dizi)',            type: 'json',   placeholder: '[10,25,45,70,100]' },
]

export default function PoliciesPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [globals,   setGlobals]   = useState<PolicyRow[]>([])
  const [overrides, setOverrides] = useState<PolicyRow[]>([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState<string | null>(null)
  const [err,       setErr]       = useState<string | null>(null)

  const [selKey,  setSelKey]  = useState(KNOWN_KEYS[0].key)
  const [rawVal,  setRawVal]  = useState('')

  useEffect(() => { init() }, [init])

  const selectedKeyDef = KNOWN_KEYS.find((k) => k.key === selKey) ?? KNOWN_KEYS[0]

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)

    const [gRes, oRes] = await Promise.all([
      supabase
        .from('policy_settings')
        .select('id, owner_user_id, key, value, description, updated_at')
        .is('owner_user_id', null)
        .order('key'),
      supabase
        .from('policy_settings')
        .select('id, owner_user_id, key, value, description, updated_at')
        .eq('owner_user_id', user.id)
        .order('key'),
    ])

    if (gRes.error) { setErr(gRes.error.message); setLoading(false); return }
    if (oRes.error) { setErr(oRes.error.message); setLoading(false); return }
    setGlobals((gRes.data ?? []) as PolicyRow[])
    setOverrides((oRes.data ?? []) as PolicyRow[])
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  // rawVal'ı kullanıcı bir key seçince güncelle
  useEffect(() => {
    const def = KNOWN_KEYS.find((k) => k.key === selKey)
    if (def) setRawVal(def.placeholder)
  }, [selKey])

  async function save() {
    if (!user) return
    setErr(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(rawVal.trim())
    } catch {
      setErr('Değer geçerli JSON olmalı. Sayı için: 4 | Metin için: "abc" | Dizi için: [1,2,3]')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('policy_settings').upsert(
      {
        owner_user_id: user.id,
        key:           selKey,
        value:         parsed,
      },
      { onConflict: 'owner_user_id,key' }
    )
    if (error) setErr(error.message)
    else { setRawVal(selectedKeyDef.placeholder); await load() }
    setSaving(false)
  }

  async function remove(id: string) {
    setDeleting(id); setErr(null)
    const { error } = await supabase.from('policy_settings').delete().eq('id', id)
    if (error) setErr(error.message)
    else await load()
    setDeleting(null)
  }

  if (!initialized) return null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Settings size={18} />}
        title="Politikalar"
        description="Sistem yapılandırması: global varsayılanlar (salt okunur) ve kişisel override'lar."
      />

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Global varsayılanlar — salt okunur */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Global Varsayılanlar <span className="text-white/40 font-normal">(salt okunur)</span></p>
        {loading ? (
          <p className="text-sm text-white/40">Yükleniyor…</p>
        ) : globals.length === 0 ? (
          <p className="text-sm text-white/40">Kayıt yok.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs border-b border-white/10">
                <th className="pb-1 pr-4">Anahtar</th>
                <th className="pb-1 pr-4">Değer</th>
                <th className="pb-1">Açıklama</th>
              </tr>
            </thead>
            <tbody>
              {globals.map((g) => (
                <tr key={g.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-1.5 pr-4 font-mono text-blue-300">{g.key}</td>
                  <td className="py-1.5 pr-4 font-mono text-white/90">{JSON.stringify(g.value)}</td>
                  <td className="py-1.5 text-white/50 text-xs">{g.description ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Kişisel override'lar */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Kişisel Override'larım</p>
        {overrides.length === 0 ? (
          <p className="text-sm text-white/40">Override yok — global varsayılanlar kullanılıyor.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs border-b border-white/10">
                <th className="pb-1 pr-4">Anahtar</th>
                <th className="pb-1 pr-4">Değer</th>
                <th className="pb-1 pr-4">Güncellenme</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-1.5 pr-4 font-mono text-emerald-300">{o.key}</td>
                  <td className="py-1.5 pr-4 font-mono text-white/90">{JSON.stringify(o.value)}</td>
                  <td className="py-1.5 pr-4 text-white/40 text-xs">{new Date(o.updated_at).toLocaleDateString('tr-TR')}</td>
                  <td className="py-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleting === o.id}
                      onClick={() => remove(o.id)}
                      title="Override'ı sil (global varsayılana dön)"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Yeni override formu */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Override Ekle / Güncelle</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/40">Anahtar</label>
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white min-w-64"
              value={selKey}
              onChange={(e) => setSelKey(e.target.value)}
            >
              {KNOWN_KEYS.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-32">
            <label className="text-xs text-white/40">
              Değer (JSON) — örnek: <code className="text-white/60">{selectedKeyDef.placeholder}</code>
            </label>
            <input
              type={selectedKeyDef.type === 'number' ? 'number' : 'text'}
              step={selectedKeyDef.type === 'number' ? 'any' : undefined}
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono"
              placeholder={selectedKeyDef.placeholder}
              value={rawVal}
              onChange={(e) => setRawVal(e.target.value)}
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            disabled={saving || !rawVal.trim()}
            onClick={save}
          >
            <Plus size={14} /> Kaydet
          </Button>
        </div>
        <p className="text-xs text-white/30">
          Sayısal değerleri doğrudan yazın (4, 0.4 vb.). JSON dizi için köşeli parantez kullanın ([10,25,45,70,100]).
        </p>
      </Card>
    </div>
  )
}
