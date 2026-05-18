import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      {icon && <div className="text-white/20">{icon}</div>}
      <div className="text-sm font-medium text-white/40">{title}</div>
      {description && <div className="text-xs text-white/25">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
