import type { MaterialTab } from '../lib/types'

const LABELS: Record<MaterialTab, string> = {
  classic: 'Classic',
  pro: 'Pro',
  alfombras: 'Alfombras',
  bordes_rectos: 'Rectos',
  mayorista: 'Mayorista',
  otros: 'Otros',
}

interface MaterialTabsProps {
  available: MaterialTab[]
  active: MaterialTab
  counts: Record<MaterialTab, number>
  onChange: (tab: MaterialTab) => void
  variant?: 'legacy' | 'rebel'
}

export function MaterialTabs({
  available,
  active,
  counts,
  onChange,
  variant = 'legacy',
}: MaterialTabsProps) {
  if (available.length === 0) return null

  if (variant === 'rebel') {
    return (
      <div className="filter-carousel-clip">
        <div className="filter-carousel-container" role="tablist" aria-label="Materiales">
          {available.map((key) => {
            const n = counts[key] ?? 0
            const isActive = key === active
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`filter-pill${isActive ? ' active' : ''}`}
                onClick={() => onChange(key)}
              >
                {LABELS[key]}
                {n > 0 ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

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

