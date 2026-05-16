import type { ReactNode } from 'react'
import { APP_BRAND_TITLE } from '../lib/appBrand'
import { onHubLinkClick } from '../lib/hubNavigate'
import { HubAdminSignOutButton } from './HubAdminSignOutButton'

/** Casa clásica (trazo / pantallas no integradas). */
function HomeIconOutline() {
  return (
    <svg
      className="nm-hub-brand-bar__home-svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 10.5 12 4l8 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10v10h9V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 20v-4h3v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Casa sólida (navbar integrada dashboard / tareas — alto contraste en taller). */
function HomeIconSolid() {
  return (
    <svg
      className="nm-hub-brand-bar__home-svg nm-hub-brand-bar__home-svg--solid"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 3 2 12h3v9h7v-6h4v6h7v-9h3L12 3z" />
    </svg>
  )
}

/** Marca + inicio (/): misma barra en hub, login y lista de corte. */
export type HubBrandSubtitleTone = 'default' | 'accent' | 'pending' | 'completed' | 'muted'

export function HubBrandBar({
  context,
  integratedSubtitle,
  integratedSubtitleTone = 'default',
  asPageHeading = true,
  trailing,
  adminSignOut = false,
  integratedDashboard = false,
}: {
  context?: string
  /** Línea bajo NOT BRAIN (solo con integratedDashboard; reemplaza el bloque tipo “context” antiguo). */
  integratedSubtitle?: string
  /** Acentos del subtítulo: verde crear, azul pendientes, gris completadas, muted (p. ej. impresos). */
  integratedSubtitleTone?: HubBrandSubtitleTone
  /** Si es false, el bloque de marca no usa h1 (p. ej. cuando la pantalla ya tiene su propio h1). */
  asPageHeading?: boolean
  trailing?: ReactNode
  adminSignOut?: boolean
  integratedDashboard?: boolean
}) {
  const hasTrailing = Boolean(trailing) || adminSignOut
  const TitleTag: 'h1' | 'div' = asPageHeading ? 'h1' : 'div'
  const headingStacked = Boolean(integratedDashboard && integratedSubtitle)
  const subtitleClasses = [
    'navbar-screen-title',
    'navbar-brand-subtitle',
    integratedSubtitleTone === 'accent' ? 'navbar-screen-title--accent' : '',
    integratedSubtitleTone === 'pending' ? 'subtitle-pending' : '',
    integratedSubtitleTone === 'completed' ? 'subtitle-completed' : '',
    integratedSubtitleTone === 'muted' ? 'subtitle-muted' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={`nm-hub-brand-bar${hasTrailing ? ' nm-hub-brand-bar--with-trailing' : ''}${integratedDashboard ? ' nm-hub-brand-bar--integrated-dashboard' : ''}`}
    >
      <a
        href="/"
        className={`nm-hub-brand-bar__home${integratedDashboard ? ' navbar-home-btn' : ''}`}
        aria-label="Inicio"
        title="Inicio"
        onClick={(e) => onHubLinkClick(e, '/')}
      >
        {integratedDashboard ? <HomeIconSolid /> : <HomeIconOutline />}
      </a>
      <TitleTag
        className={`nm-hub-brand-bar__heading${headingStacked ? ' nm-hub-brand-bar__heading--stacked navbar-brand-group' : ''}`}
      >
        <a
          href="/"
          className={`nm-hub-brand-bar__brand${integratedDashboard ? ' navbar-brand' : ''}`}
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          {APP_BRAND_TITLE}
        </a>
        {headingStacked ? (
          <span className={subtitleClasses}>
            {integratedSubtitle}
          </span>
        ) : context ? (
          <span className="nm-hub-brand-bar__context">{context}</span>
        ) : null}
      </TitleTag>
      {hasTrailing ? (
        <div className="nm-hub-brand-bar__trailing">
          {trailing}
          {adminSignOut ? <HubAdminSignOutButton /> : null}
        </div>
      ) : null}
    </div>
  )
}
