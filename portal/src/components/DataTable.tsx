import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

export type Column<T> = {
  key: string
  header: string
  width?: string
  render: (row: T) => ReactNode
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  empty,
  onRowClick,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/[0.05]">
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-white/25"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                {columns.map((col, ci) => (
                  <td key={col.key} className="px-4 py-3">
                    <div
                      className="h-3.5 animate-pulse rounded-full"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        width: `${40 + (i * 13 + ci * 7) % 45}%`,
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-0">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025, duration: 0.18 }}
                onClick={() => onRowClick?.(row)}
                className={[
                  'group border-b border-white/[0.04] transition-all duration-100',
                  onRowClick
                    ? 'cursor-pointer hover:bg-white/[0.035] hover:border-white/[0.07]'
                    : '',
                ].join(' ')}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    {col.render(row)}
                  </td>
                ))}
              </motion.tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
