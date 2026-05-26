import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string }

export function Input({ className, label, ...props }: Props) {
  const input = (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white',
        'placeholder:text-white/25 outline-none transition-all duration-150',
        'focus:border-blue-500/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-blue-500/15 focus:shadow-[0_0_12px_rgba(59,130,246,0.08)]',
        'hover:border-white/[0.12] hover:bg-white/[0.05]',
        className,
      )}
      {...props}
    />
  )
  if (!label) return input
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-white/50">{label}</div>
      {input}
    </div>
  )
}
