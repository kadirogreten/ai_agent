import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { listAnomalousSchedules } from '@/lib/schedules'

/**
 * Kapı 3 — Anomaly banner. Üst layout'a (AppShell) yerleştirilir; ardışık başarısızlık
 * yaşayan schedule varsa kırmızı uyarı bandı gösterir. Tıklandığında SchedulesPage'e
 * yönlendirir.
 *
 * Sadece authenticated görünüm üzerinde çalışır; query hata verirse sessizce çıkar.
 */
export default function AnomalyBanner() {
  const [count,   setCount]   = useState(0)
  const [stopped, setStopped] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const res = await listAnomalousSchedules()
        if (cancelled || res.error) return
        const rows = res.data
        setCount(rows.length)
        setStopped(rows.filter((r) => r.consecutive_failures >= r.anomaly_threshold).length)
      } catch { /* sessizce yut */ }
    }
    tick()
    const id = setInterval(tick, 60_000)  // dakikada bir
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (count === 0) return null

  return (
    <Link
      to="/app/schedules"
      className="flex items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-200 hover:bg-red-500/15"
    >
      <AlertTriangle size={16} className="text-red-300" />
      <span>
        <strong>{count}</strong> zamanlanmış görev arka arkaya başarısız oldu.
        {stopped > 0 ? <> <strong className="text-red-300">{stopped}</strong> tanesi anomali eşiğini aştı ve otomatik durduruldu.</> : null}
      </span>
      <span className="ml-auto text-xs text-red-300/70">Schedule listesini gör →</span>
    </Link>
  )
}
