import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

type Props = SelectHTMLAttributes<HTMLSelectElement> & { label?: string }

export function Select({ label, className, children, ...props }: Props) {
  return (
    <div className="relative">
      {label && <div className="mb-1.5 text-xs font-medium text-white/50">{label}</div>}
      <div className="relative">
        <select
          className={cn(
            'h-9 w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.03]',
            'pl-3 pr-8 text-sm text-white outline-none transition-all duration-150',
            'focus:border-blue-500/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-blue-500/15',
            'hover:border-white/[0.12] hover:bg-white/[0.05]',
            'disabled:opacity-40 disabled:pointer-events-none',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30"
        />
      </div>
    </div>
  )
}
