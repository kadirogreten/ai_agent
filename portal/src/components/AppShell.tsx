import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
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
  Download, LogOut, ChevronDown, ChevronRight,
} from 'lucide-react'

type NavItem = { to: string; label: string; icon: React.ReactNode }
type NavGroup = { title: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    title: '',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
      { to: '/app/office', label: '3D Office', icon: <Boxes size={15} /> },
      { to: '/app/run', label: 'Yeni Çalıştırma', icon: <Play size={15} /> },
    ],
  },
  {
    title: 'Operasyon',
    items: [
      { to: '/app/runs', label: 'Runs', icon: <List size={15} /> },
      { to: '/app/jobs', label: 'Jobs', icon: <Briefcase size={15} /> },
      { to: '/app/schedules', label: 'Schedules', icon: <Clock size={15} /> },
      { to: '/app/approval-queue', label: 'Approval Queue', icon: <CheckSquare size={15} /> },
    ],
  },
  {
    title: 'Yapılandırma',
    items: [
      { to: '/app/agents', label: 'Agents', icon: <Bot size={15} /> },
      { to: '/app/personas', label: 'Personas', icon: <UserCircle size={15} /> },
      { to: '/app/playbooks', label: 'Playbooks', icon: <BookOpen size={15} /> },
      { to: '/app/tools', label: 'Tools', icon: <Wrench size={15} /> },
    ],
  },
  {
    title: 'Bilgi Tabanı',
    items: [
      { to: '/app/domain-packs', label: 'Domain Packs', icon: <Package size={15} /> },
      { to: '/app/playbook-bundles', label: 'Playbook Bundles', icon: <Layers size={15} /> },
      { to: '/app/bundles', label: 'Run Bundles', icon: <Database size={15} /> },
      { to: '/app/facts', label: 'Knowledge Facts', icon: <Brain size={15} /> },
    ],
  },
  {
    title: 'Finans & Denetim',
    items: [
      { to: '/app/cost-ledger', label: 'Cost Ledger', icon: <DollarSign size={15} /> },
      { to: '/app/audit-log', label: 'Audit Log', icon: <ScrollText size={15} /> },
    ],
  },
  {
    title: 'Builder',
    items: [
      { to: '/app/sector-builder', label: 'Sektör Keşif', icon: <Compass size={15} /> },
      { to: '/app/pack-drafts', label: 'Taslaklar', icon: <FileStack size={15} /> },
    ],
  },
]

function NavGroup({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-1">
      {group.title && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 pb-1 pt-3"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
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
                    className={`relative mx-2 mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                      isActive ? 'text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                    whileHover={{ x: 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg ring-1 ring-white/10"
                        style={{ background: 'rgba(255,255,255,0.07)' }}
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <span className={`relative z-10 ${isActive ? 'text-blue-400' : ''}`}>
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
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-white/[0.06] bg-[#080e1c]">
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-white/[0.06] px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20 ring-1 ring-blue-500/30">
              <Bot size={14} className="text-blue-400" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white/90">Agent Portal</span>
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
            <p className="px-2 pb-1 text-[11px] text-white/40">{importMsg}</p>
          )}
          <button
            onClick={runImport}
            disabled={importing}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/40 transition-colors hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
          >
            <Download size={14} />
            <span>{importing ? 'İçe aktarılıyor…' : 'Local Import'}</span>
          </button>
          <button
            onClick={async () => { await signOut(); navigate('/login') }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <LogOut size={14} />
            <span className="truncate">{user?.email ?? 'Çıkış'}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-auto p-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
