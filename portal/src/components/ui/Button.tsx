import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type Size    = 'sm' | 'md' | 'lg'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ className, variant = 'primary', size = 'md', ...props }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-150 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:ring-offset-0 ' +
    'disabled:opacity-40 disabled:pointer-events-none'

  const variants: Record<Variant, string> = {
    primary:   'bg-gradient-to-b from-blue-500 to-blue-700 text-white hover:from-blue-400 hover:to-blue-600 shadow-lg shadow-blue-900/40 active:scale-[0.98]',
    secondary: 'bg-white/[0.07] text-white hover:bg-white/[0.12] border border-white/[0.08] active:scale-[0.98]',
    danger:    'bg-gradient-to-b from-red-500 to-red-700 text-white hover:from-red-400 hover:to-red-600 shadow-lg shadow-red-900/30 active:scale-[0.98]',
    ghost:     'text-white/60 hover:text-white hover:bg-white/[0.06] active:bg-white/[0.10]',
    outline:   'text-white/70 border border-white/[0.10] hover:bg-white/[0.06] hover:border-white/20 active:scale-[0.98]',
  }
  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-9 px-4 gap-2',
    lg: 'h-11 px-6 text-base gap-2',
  }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props} />
  )
}
