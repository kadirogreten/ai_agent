import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type Size = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ className, variant = 'primary', size = 'md', ...props }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-0 disabled:opacity-50 disabled:pointer-events-none'
  const variants: Record<Variant, string> = {
    primary: 'bg-blue-500 text-white hover:bg-blue-400',
    secondary: 'bg-white/10 text-white hover:bg-white/15 border border-white/10',
    danger: 'bg-red-500 text-white hover:bg-red-400',
    ghost: 'bg-transparent text-white hover:bg-white/10',
    outline: 'bg-transparent text-white border border-white/20 hover:bg-white/10',
  }
  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3',
    md: 'h-10 px-4',
  }
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
}
