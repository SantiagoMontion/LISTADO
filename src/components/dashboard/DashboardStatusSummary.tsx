export interface SummaryPill {
  count: string | number
  label: string
  /** Métrica de completadas: número con acento violeta. */
  completed?: boolean
}

export function DashboardStatusSummary({
  items,
  'aria-label': ariaLabel = 'Resumen del día',
}: {
  items: SummaryPill[]
  'aria-label'?: string
}) {
  if (items.length === 0) return null
  return (
    <div className="status-bar-rebel" role="status" aria-label={ariaLabel}>
      {items.map((it) => (
        <div
          key={it.label}
          className={`status-metric${it.completed ? ' completed-rebel' : ''}`}
        >
          <strong>{it.count}</strong>{' '}
          {it.label}
        </div>
      ))}
    </div>
  )
}
