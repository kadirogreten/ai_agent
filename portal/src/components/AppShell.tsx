import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AnomalyBanner from '@/components/AnomalyBanner'
import { useAuthStore } from '@/stores/authStore'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/PageTransition'
import { useState } from 'react'
import {
  LayoutDashboard, Play, Clock, List, Briefcase, CheckSquare,
  Bot, UserCircle, BookOpen, Wrench,
  Package, Layers, Database, Brain,
  DollarSign, ScrollText,
  Compass, FileStack, Boxes,
  Download, LogOut, ChevronDown,
} from 'lucide-react'

type NavItem = { to: string; label: string; icon: React.ReactNode; primary?: boolean }
type NavGroup = { title: string; items: NavItem[]; defaultOpen?: boolean }

const navGroups: NavGroup[] = [
  {
    title: '',
    items: [
      { to: '/app/dashboard', label: 'Panel', icon: <LayoutDashboard size={15} /> },
      { to: '/app/run', label: 'Yeni iş başlat', icon: <Play size={15} />, primary: true },
    ],
  },
  {
    title: 'Çalışmalarım',
    items: [
      { to: '/app/jobs', label: 'İşler (kuyruk)', icon: <Briefcase size={15} /> },
      { to: '/app/runs', label: 'Çalıştırmalar', icon: <List size={15} /> },
      { to: '/app/schedules', label: 'Zamanlananlar', icon: <Clock size={15} /> },
      { to: '/app/approval-queue', label: 'Onay bekleyenler', icon: <CheckSquare size={15} /> },
    ],
  },
  {
    title: 'Tasarım',
    items: [
      { to: '/app/agents', label: 'Ajanlar', icon: <Bot size={15} /> },
      { to: '/app/personas', label: 'Personalar', icon: <UserCircle size={15} /> },
      { to: '/app/playbooks', label: "Playbook'lar", icon: <BookOpen size={15} /> },
      { to: '/app/tools', label: 'Araçlar', icon: <Wrench size={15} /> },
    ],
  },
  {
    title: 'Bilgi & paketler',
    items: [
      { to: '/app/domain-packs', label: 'Domain paketleri', icon: <Package size={15} /> },
      { to: '/app/playbook-bundles', label: 'Playbook setleri', icon: <Layers size={15} /> },
      { to: '/app/bundles', label: 'Çalıştırma setleri', icon: <Database size={15} /> },
      { to: '/app/facts', label: 'Bilgi tabanı', icon: <Brain size={15} /> },
    ],
  },
  {
    title: 'Denetim',
    items: [
      { to: '/app/audit-log', label: 'Audit log', icon: <ScrollText size={15} /> },
      { to: '/app/cost-ledger', label: 'Maliyet', icon: <DollarSign size={15} /> },
    ],
  },
  {
    title: 'Gelişmiş',
    defaultOpen: false,
    items: [
      { to: '/app/sector-builder', label: 'Sektör keşif', icon: <Compass size={15} /> },
      { to: '/app/pack-drafts', label: 'Taslaklar', icon: <FileStack size={15} /> },
      { to: '/app/self-reflection', label: 'Öz-değerlendirme', icon: <Brain size={15} /> },
      { to: '/app/empirical-check', label: 'Ampirik kontrol', icon: <CheckSquare size={15} /> },
      { to: '/app/office', label: '3D office', icon: <Boxes size={15} /> },
    ],
  },
]

function NavGroup({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(group.defaultOpen ?? true)

  return (
    <div className="mb-1">
      {group.title && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 pb-1 pt-3"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
            {group.title}
          </span>
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: 0.2 }}
            className="text-white/20"
          >
            <ChevronDown size={12} />
          </motion.span>
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/app/run'}>
                {({ isActive }) => (
                  <motion.div
                    className={`relative mx-2 mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-sm ${
                      item.primary
                        ? 'bg-blue-500/10 text-blue-200 hover:bg-blue-500/15'
                        : isActive ? 'text-white' : 'text-white/45 hover:text-white/75'
                    }`}
                    whileHover={{ x: isActive ? 0 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg"
                        style={{
                          background: 'linear-gradient(135deg, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.06) 100%)',
                          boxShadow: 'inset 0 0 0 1px rgba(59,130,246,0.18)',
                        }}
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    {/* Left accent bar for active item */}
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-accent"
                        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-blue-400"
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <span className={`relative z-10 transition-colors ${isActive ? 'text-blue-400' : ''}`}>
                      {item.icon}
                    </span>
                    <span className="relative z-10 font-medium">{item.label}</span>
                  </motion.div>
                )}
              </NavLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function AppShell() {
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
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
      setImportMsg(`runs=${r.runs}, bundles=${r.bundles}, facts=${r.facts}`)
      navigate('/app/runs')
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : 'Import hata')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#0B1020] text-white">
      {/* Sidebar */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-white/[0.06]"
        style={{ background: 'linear-gradient(180deg, #0a1020 0%, #070d19 100%)' }}
      >
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-white/[0.06] px-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.25) 0%, rgba(37,99,235,0.15) 100%)',
                boxShadow: '0 0 0 1px rgba(59,130,246,0.25), 0 4px 12px rgba(59,130,246,0.15)',
              }}
            >
              <Bot size={15} className="text-blue-300" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white/90">Agent Portal</div>
              <div className="text-[10px] text-white/30 leading-none mt-0.5">AI Management</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-none">
          {navGroups.map((group, i) => (
            <NavGroup key={i} group={group} />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.06] p-3 space-y-1">
          {importMsg && (
            <p className="px-2 pb-1 text-[11px] text-white/35">{importMsg}</p>
          )}
          <button
            onClick={runImport}
            disabled={importing}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/35 transition-all hover:bg-white/[0.05] hover:text-white/60 disabled:opacity-40"
          >
            <Download size={13} />
            <span>{importing ? 'İçe aktarılıyor…' : 'Local Import'}</span>
          </button>
          {/* User row */}
          <button
            onClick={async () => { await signOut(); navigate('/login') }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-all hover:bg-white/[0.05] group"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/60 group-hover:text-white/80">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="truncate text-xs text-white/40 group-hover:text-white/60">
              {user?.email ?? 'Çıkış'}
            </span>
            <LogOut size={12} className="ml-auto shrink-0 text-white/20 group-hover:text-white/40" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AnomalyBanner />
        <main className="flex-1 overflow-auto p-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
