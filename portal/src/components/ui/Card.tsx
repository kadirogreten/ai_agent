import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import type { HTMLAttributes } from 'react'

type Props = HTMLAttributes<HTMLDivElement> & { animate?: boolean; glow?: boolean }

export function Card({ className, animate = false, glow = false, ...props }: Props) {
  const base = cn(
    'rounded-xl border bg-gradient-to-b from-[#0f1829] to-[#0a1020]',
    'border-white/[0.07]',
    glow && 'shadow-[0_0_0_1px_rgba(59,130,246,0.08)] hover:shadow-[0_0_24px_rgba(59,130,246,0.10)] transition-shadow duration-300',
    className,
  )
  if (animate) {
    return (
      <motion.div
        whileHover={{ y: -2, boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 40px rgba(59,130,246,0.06)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={base}
        {...(props as object)}
      />
    )
  }
  return <div className={base} {...props} />
}
