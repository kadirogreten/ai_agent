import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: Props) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30',
        className,
      )}
      {...props}
    />
  )
}

