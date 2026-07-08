type Props = {
  detail: Record<string, unknown> | null
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function isUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
}

/** Mevcut ApprovalQueuePage key-value bloğu — bilinmeyen slug'lar için regresyon yok. */
export function GenericKeyValueCard({ detail }: Props) {
  if (!detail || Object.keys(detail).length === 0) return null

  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 space-y-1">
      {Object.entries(detail).map(([k, v]) => {
        const strVal = fmtVal(v)
        return (
          <div key={k} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 w-24 font-mono text-white/30 truncate">{k}</span>
            {isUrl(v) ? (
              <a
                href={v}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline underline-offset-2 truncate max-w-xs hover:text-blue-300"
              >
                {strVal}
              </a>
            ) : (
              <span className="text-white/55 break-all">{strVal}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
