import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/PageHeader'
import { Trash2, Plus, Wallet } from 'lucide-react'

type Budget = {
  id: string
  scope: string
  period: 'daily' | 'weekly' | 'monthly'
  max_amount: number
  max_tool_calls: number
  spent_amount: number
  used_calls: number
  period_start: string
}

type Tool = { slug: string; name: string }

const PERIOD_LABELS: Record<string, string> = {
  daily:   'Günlük',
  weekly:  'Haftalık',
  monthly: 'Aylık',
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  if (max <= 0) return <span className="text-xs text-white/30">Limit yok</span>
  const pct = Math.min(value / max, 1)
  const pctDisplay = Math.round(pct * 100)
  const color =
    pct >= 1   ? 'bg-red-500'    :
    pct >= 0.8 ? 'bg-yellow-500' :
                 'bg-emerald-500'
  return (
    <div className="space-y-0.5">
      <div className="h-1.5 w-32 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pctDisplay}%` }} />
      </div>
      <span className={`text-xs ${pct >= 1 ? 'text-red-400' : pct >= 0.8 ? 'text-yellow-400' : 'text-white/50'}`}>
        {label} {pctDisplay}%
      </span>
    </div>
  )
}

export default function BudgetsPage() {
  const init        = useAuthStore((s) => s.init)
  const user        = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  const [budgets,  setBudgets]  = useState<Budget[]>([])
  const [tools,    setTools]    = useState<Tool[]>([])
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [err,      setErr]      = useState<string | null>(null)

  const [form, setForm] = useState({
    scope:         'global',
    period:        'monthly' as 'daily' | 'weekly' | 'monthly',
    max_amount:    '0',
    max_tool_calls: '0',
  })

  useEffect(() => { init() }, [init])

  const load = useCallback(async () => {
    if (!initialized || !user) return
    setLoading(true); setErr(null)

    const [bRes, tRes] = await Promise.all([
      supabase
        .from('operation_budgets')
        .select('id, scope, period, max_amount, max_tool_calls, spent_amount, used_calls, period_start')
        .eq('owner_user_id', user.id)
        .order('scope')
        .order('period'),
      supabase
        .from('tools')
        .select('slug, name')
        .order('name'),
    ])

    if (bRes.error) { setErr(bRes.error.message); setLoading(false); return }
    setBudgets((bRes.data ?? []) as Budget[])
    setTools((tRes.data ?? []) as Tool[])
    setLoading(false)
  }, [initialized, user])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!user) return
    setSaving(true); setErr(null)

    const maxAmount    = parseFloat(form.max_amount) || 0
    const maxToolCalls = parseInt(form.max_tool_calls, 10) || 0

    const { error } = await supabase.from('operation_budgets').insert({
      owner_user_id:  user.id,
      scope:          form.scope,
      period:         form.period,
      max_amount:     maxAmount,
      max_tool_calls: maxToolCalls,
      spent_amount:   0,
      used_calls:     0,
      period_start:   new Date().toISOString().slice(0, 10),
    })

    if (error) setErr(error.message)
    else { setForm({ scope: 'global', period: 'monthly', max_amount: '0', max_tool_calls: '0' }); await load() }
    setSaving(false)
  }

  async function remove(id: string) {
    setDeleting(id); setErr(null)
    const { error } = await supabase.from('operation_budgets').delete().eq('id', id)
    if (error) setErr(error.message)
    else await load()
    setDeleting(null)
  }

  if (!initialized) return null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Wallet size={18} />}
        title="Bütçeler"
        description="Araç başına harcama ve çağrı limitleri. Dönem sonunda otomatik sıfırlanır."
      />

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Mevcut bütçeler */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Bütçelerim</p>
        {loading ? (
          <p className="text-sm text-white/40">Yükleniyor…</p>
        ) : budgets.length === 0 ? (
          <p className="text-sm text-white/40">Bütçe tanımlanmamış.</p>
        ) : (
          <div className="space-y-2">
            {budgets.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-4 border border-white/10 rounded p-3 bg-white/5 hover:bg-white/8 flex-wrap"
              >
                <div className="flex-1 min-w-32">
                  <span className="font-mono text-sm text-blue-300">{b.scope}</span>
                  <span className="ml-2 text-xs text-white/40">{PERIOD_LABELS[b.period] ?? b.period}</span>
                </div>

                <div className="space-y-1">
                  <ProgressBar
                    value={Number(b.spent_amount)}
                    max={Number(b.max_amount)}
                    label={`${Number(b.spent_amount).toFixed(2)} / ${Number(b.max_amount).toFixed(2)} TL`}
                  />
                  <ProgressBar
                    value={b.used_calls}
                    max={b.max_tool_calls}
                    label={`${b.used_calls} / ${b.max_tool_calls} çağrı`}
                  />
                </div>

                <div className="text-xs text-white/30">
                  Dönem: {b.period_start}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting === b.id}
                  onClick={() => remove(b.id)}
                  title="Bütçeyi sil"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Yeni bütçe formu */}
      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium text-white/80">Yeni Bütçe Ekle</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/40">Kapsam (araç veya global)</label>
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white min-w-40"
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
            >
              <option value="global">global</option>
              {tools.map((t) => (
                <option key={t.slug} value={t.slug}>{t.slug} — {t.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/40">Dönem</label>
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
              value={form.period}
              onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as typeof form.period }))}
            >
              <option value="daily">Günlük</option>
              <option value="weekly">Haftalık</option>
              <option value="monthly">Aylık</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/40">Max Tutar (TL, 0=sınırsız)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white w-32"
              value={form.max_amount}
              onChange={(e) => setForm((f) => ({ ...f, max_amount: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/40">Max Çağrı (0=sınırsız)</label>
            <input
              type="number"
              min="0"
              step="1"
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white w-28"
              value={form.max_tool_calls}
              onChange={(e) => setForm((f) => ({ ...f, max_tool_calls: e.target.value }))}
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={save}
          >
            <Plus size={14} /> Ekle
          </Button>
        </div>
        <p className="text-xs text-white/30">
          0 değeri ilgili sınırı devre dışı bırakır. Bütçe mevcut dönem için açılır; sonraki dönem otomatik sıfırlanır.
        </p>
      </Card>
    </div>
  )
}
