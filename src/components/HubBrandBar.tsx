import type { ReactNode } from 'react'
import { APP_BRAND_TITLE } from '../lib/appBrand'
import { onHubLinkClick } from '../lib/hubNavigate'

function HomeIcon() {
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

/** Marca + inicio (/): misma barra en hub, login y lista de corte. */
export function HubBrandBar({
  context,
  asPageHeading = true,
  trailing,
  integratedDashboard = false,
}: {
  context?: string
  /** Si es false, el bloque de marca no usa h1 (p. ej. cuando la pantalla ya tiene su propio h1). */
  asPageHeading?: boolean
  /** Acciones a la derecha (ej. + en corte). */
  trailing?: ReactNode
  /** Dashboard home: barra integrada tema REBEL (home-btn-rebel + navbar-brand). */
  integratedDashboard?: boolean
}) {
  const TitleTag: 'h1' | 'div' = asPageHeading ? 'h1' : 'div'
  return (
    <div
      className={`nm-hub-brand-bar${trailing ? ' nm-hub-brand-bar--with-trailing' : ''}${integratedDashboard ? ' nm-hub-brand-bar--integrated-dashboard' : ''}`}
    >
      <a
        href="/"
        className={`nm-hub-brand-bar__home${integratedDashboard ? ' home-btn-rebel' : ''}`}
        aria-label="Inicio"
        title="Inicio"
        onClick={(e) => onHubLinkClick(e, '/')}
      >
        <HomeIcon />
      </a>
      <TitleTag className="nm-hub-brand-bar__heading">
        <a
          href="/"
          className={`nm-hub-brand-bar__brand${integratedDashboard ? ' navbar-brand' : ''}`}
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          {APP_BRAND_TITLE}
        </a>
        {context ? <span className="nm-hub-brand-bar__context">{context}</span> : null}
      </TitleTag>
      {trailing ? <div className="nm-hub-brand-bar__trailing">{trailing}</div> : null}
    </div>
  )
}
