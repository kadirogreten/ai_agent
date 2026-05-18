import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import type { HTMLAttributes } from 'react'

type Props = HTMLAttributes<HTMLDivElement> & { animate?: boolean }

export function Card({ className, animate = false, ...props }: Props) {
  const base = cn(
    'rounded-xl border bg-gradient-to-b from-[#0f1829] to-[#0a1020]',
    'border-white/[0.07]',
    className,
  )
  if (animate) {
    return (
      <motion.div
        whileHover={{ y: -2, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={base}
        {...(props as object)}
      />
    )
  }
  return <div className={base} {...props} />
}
