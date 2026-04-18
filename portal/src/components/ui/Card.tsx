import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

type Props = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: Props) {
  return <div className={cn('rounded-xl border border-white/10 bg-white/5', className)} {...props} />
}

