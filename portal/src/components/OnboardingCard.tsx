import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Play, ListChecks, X } from 'lucide-react'

const STORAGE_KEY = 'aa.onboarding.dismissed'

const steps = [
  {
    to: '/app/domain-packs',
    icon: <Package size={16} />,
    title: '1 · Domain paketi seç',
    desc: 'Hangi alanda çalışacağını belirle (market-intel, e-ticaret, hibe…).',
  },
  {
    to: '/app/run',
    icon: <Play size={16} />,
    title: '2 · Yeni iş başlat',
    desc: 'Bir playbook seç ya da CEO moduna hedefini yaz.',
  },
  {
    to: '/app/runs',
    icon: <ListChecks size={16} />,
    title: '3 · Sonucu gör',
    desc: 'Çalıştırmalar ve raporlar burada birikir.',
  },
]

export default function OnboardingCard() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  if (dismissed) return null

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* yoksay */
    }
    setDismissed(true)
  }

  return (
    <div className="relative rounded-xl border border-blue-500/20 bg-blue-500/[0.06] p-5">
      <button
        onClick={dismiss}
        aria-label="Rehberi kapat"
        className="absolute right-3 top-3 text-white/30 transition-colors hover:text-white/60"
      >
        <X size={16} />
      </button>
      <h2 className="text-sm font-semibold text-white">Buradan başla</h2>
      <p className="mt-0.5 text-xs text-white/45">Üç adımda ilk işini çalıştır.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="group rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-blue-400/40 hover:bg-white/[0.04]"
          >
            <div className="flex items-center gap-2 text-blue-300">
              {s.icon}
              <span className="text-xs font-medium text-white/80">{s.title}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
