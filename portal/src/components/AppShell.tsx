import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { Download, LogOut } from 'lucide-react'
import { useMemo, useState } from 'react'

type Tab = { to: string; label: string }

const tabs: Tab[] = [
  { to: '/app/dashboard', label: 'Dashboard' },
  { to: '/app/agents', label: 'Agents' },
  { to: '/app/runs', label: 'Runs' },
  { to: '/app/bundles', label: 'Bundles' },
  { to: '/app/facts', label: 'Knowledge Facts' },
  { to: '/app/jobs', label: 'Jobs' },
  { to: '/app/tools', label: 'Tools' },
  { to: '/app/cost-ledger', label: 'Cost Ledger' },
  { to: '/app/approval-queue', label: 'Approval Queue' },
  { to: '/app/audit-log', label: 'Audit Log' },
]

export default function AppShell() {
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const location = useLocation()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const active = useMemo(() => {
    const t = tabs.find((x) => location.pathname.startsWith(x.to))
    return t?.label ?? 'App'
  }, [location.pathname])

  async function runImport() {
    const session = useAuthStore.getState().session
    if (!session?.access_token) {
      setImportMsg('Oturum bulunamadı')
      return
    }

    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/import/local', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        setImportMsg(json?.error ?? 'Import hata')
        return
      }
      const r = json.result
      setImportMsg(`Import tamamlandı: runs=${r.runs}, bundles=${r.bundles}, facts=${r.facts}`)
      navigate('/app/runs')
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : 'Import hata')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1020] text-white">
      <div className="border-b border-white/10 bg-[#0B1020]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link to="/app" className="text-sm font-semibold tracking-wide text-white/90">
              Agent Portal
            </Link>
            <div className="text-xs text-white/50">{active}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={runImport} disabled={importing}>
              <Download className="mr-2 h-4 w-4" />
              Local Import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Çıkış
            </Button>
            <div className="hidden text-xs text-white/50 md:block">{user?.email}</div>
          </div>
        </div>
        {importMsg ? (
          <div className="mx-auto max-w-6xl px-6 pb-3 text-xs text-white/70">{importMsg}</div>
        ) : null}
        <div className="mx-auto max-w-6xl px-6 pb-3">
          <div className="flex gap-2">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </div>
    </div>
  )
}
