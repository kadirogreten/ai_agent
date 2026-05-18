import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import type { HTMLAttributes } from 'react'

type Props = HTMLAttributes<HTMLDivElement> & { animate?: boolean }

export function Card({ className, animate = false, ...props }: Props) {
  if (animate) {
    return (
      <motion.div
        whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={cn('rounded-xl border border-white/10 bg-white/5', className)}
        {...(props as object)}
      />
    )
  }
  return <div className={cn('rounded-xl border border-white/10 bg-white/5', className)} {...props} />
}
