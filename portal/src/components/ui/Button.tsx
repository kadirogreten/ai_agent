import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type Size    = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ className, variant = 'primary', size = 'md', ...props }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:ring-offset-0 ' +
    'disabled:opacity-40 disabled:pointer-events-none'

  const variants: Record<Variant, string> = {
    primary:   'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/30',
    secondary: 'bg-white/[0.07] text-white hover:bg-white/[0.12] border border-white/[0.08]',
    danger:    'bg-red-600 text-white hover:bg-red-500',
    ghost:     'text-white/60 hover:text-white hover:bg-white/[0.06]',
    outline:   'text-white/70 border border-white/[0.10] hover:bg-white/[0.06] hover:border-white/20',
  }
  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4',
  }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props} />
  )
}
