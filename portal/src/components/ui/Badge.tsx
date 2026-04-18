import { cn } from '@/lib/utils'

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'yellow' | 'gray'; children: string }) {
  const map: Record<string, string> = {
    green: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/20',
    red: 'bg-red-500/15 text-red-200 border-red-500/20',
    yellow: 'bg-yellow-500/15 text-yellow-100 border-yellow-500/20',
    gray: 'bg-white/10 text-white/80 border-white/10',
  }
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', map[tone])}>{children}</span>
}

