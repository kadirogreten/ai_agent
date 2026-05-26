import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.04] text-white/25">
          {icon}
        </div>
      )}
      <div>
        <div className="text-sm font-semibold text-white/50">{title}</div>
        {description && <div className="mt-1 text-xs text-white/25">{description}</div>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
