import type { MaterialTab } from '../lib/types'

const LABELS: Record<MaterialTab, string> = {
  classic: 'Classic',
  pro: 'Pro',
  alfombras: 'Alfombras',
  bordes_rectos: 'Rectos',
  otros: 'Otros',
}

interface MaterialTabsProps {
  available: MaterialTab[]
  active: MaterialTab
  counts: Record<MaterialTab, number>
  onChange: (tab: MaterialTab) => void
}

export function MaterialTabs({
  available,
  active,
  counts,
  onChange,
}: MaterialTabsProps) {
  if (available.length === 0) return null

  return (
    <div className="nm-prod-tabs" role="tablist" aria-label="Materiales">
      {available.map((key) => {
        const n = counts[key] ?? 0
        const isActive = key === active
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`nm-prod-tab${isActive ? ' nm-prod-tab--active' : ''}`}
            onClick={() => onChange(key)}
          >
            {LABELS[key]}
            {n > 0 ? ` (${n})` : ''}
          </button>
        )
      })}
    </div>
  )
}
