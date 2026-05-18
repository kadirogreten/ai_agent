import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

const tones = {
  green:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  red:    'bg-red-500/10    text-red-300    border-red-500/20',
  yellow: 'bg-amber-500/10  text-amber-300  border-amber-500/20',
  gray:   'bg-white/[0.06]  text-white/60   border-white/10',
  blue:   'bg-blue-500/10   text-blue-300   border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
}

type Tone = keyof typeof tones

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
      tones[tone],
      className,
    )}>
      {children}
    </span>
  )
}
