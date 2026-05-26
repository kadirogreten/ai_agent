import { cn } from '@/lib/utils'

type Props = {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  className?: string
}

export function Toggle({ checked, onChange, label, description, disabled, className }: Props) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'opacity-40 pointer-events-none', className)}>
      <div
        role="checkbox"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-all duration-200',
          checked
            ? 'bg-blue-600 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
            : 'bg-white/10 border border-white/10',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full shadow-sm transition-all duration-200',
            checked
              ? 'left-[18px] bg-white'
              : 'left-0.5 bg-white/60',
          )}
        />
      </div>
      {(label || description) && (
        <div>
          {label && <div className="text-sm font-medium text-white/80">{label}</div>}
          {description && <div className="text-xs text-white/40">{description}</div>}
        </div>
      )}
    </label>
  )
}

type CheckboxProps = {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2', disabled && 'opacity-40 pointer-events-none', className)}>
      <div
        role="checkbox"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all duration-150',
          checked
            ? 'border-blue-500 bg-blue-600 shadow-[0_0_6px_rgba(59,130,246,0.3)]'
            : 'border-white/[0.15] bg-white/[0.04] hover:border-white/25',
        )}
      >
        {checked && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label && <span className="text-sm text-white/70">{label}</span>}
    </label>
  )
}
