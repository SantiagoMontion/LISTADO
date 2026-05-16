import type { ReactNode } from 'react'
import { onHubLinkClick } from '../../lib/hubNavigate'

export type DashboardCardAccent = 'create' | 'pending' | 'files' | 'completed' | 'muted'

const ACCENT_CLASS: Record<DashboardCardAccent, string> = {
  create: 'card-create-rebel',
  pending: 'card-pending-rebel',
  files: 'card-files-rebel',
  completed: 'card-completed-rebel',
  muted: 'card-muted-rebel',
}

interface DashboardCardProps {
  href: string
  title: string
  icon: ReactNode
  stat?: string | number | null
  statLabel?: string
  accent?: DashboardCardAccent
}

export function DashboardCard({
  href,
  title,
  icon,
  stat,
  statLabel,
  accent = 'muted',
}: DashboardCardProps) {
  const showStat = stat !== undefined && stat !== null && stat !== ''
  const accentClass = ACCENT_CLASS[accent]

  return (
    <a
      href={href}
      className={`action-card-rebel ${accentClass}`}
      onClick={(e) => onHubLinkClick(e, href)}
    >
      <div className="card-left-block-rebel">
        <span className="card-icon-wrapper-rebel" aria-hidden="true">
          {icon}
        </span>
        <div className="card-info-rebel">
          <span className="card-title-rebel">{title}</span>
        </div>
      </div>
      {showStat ? (
        <div className="card-counter-block-rebel">
          <span className="card-counter-rebel">{stat}</span>
          {statLabel ? <span className="card-counter-label-rebel">{statLabel}</span> : null}
        </div>
      ) : null}
    </a>
  )
}
