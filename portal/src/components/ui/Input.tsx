import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: Props) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white',
        'placeholder:text-white/30 outline-none transition-colors',
        'focus:border-blue-500/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-blue-500/20',
        className,
      )}
      {...props}
    />
  )
}
