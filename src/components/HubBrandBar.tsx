import type { ReactNode } from 'react'
import { onHubLinkClick } from '../lib/hubNavigate'
import notmidLogo from '../notmidnewlogo.svg'

function NotBrainLogoMark() {
  return (
    <img
      className="nm-hub-brand-logo"
      src={notmidLogo}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
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
  adminSignOut: _adminSignOut = false,
  integratedDashboard = false,
}: {
  context?: string
  /** Línea bajo el logo (solo con integratedDashboard). */
  integratedSubtitle?: string
  /** Acentos del subtítulo: verde crear, azul pendientes, gris completadas, muted. */
  integratedSubtitleTone?: HubBrandSubtitleTone
  /** Si es false, el bloque de marca no usa h1 (p. ej. cuando la pantalla ya tiene su propio h1). */
  asPageHeading?: boolean
  trailing?: ReactNode
  /** @deprecated Ya no se muestra Salir en la navbar. */
  adminSignOut?: boolean
  integratedDashboard?: boolean
}) {
  const hasTrailing = Boolean(trailing)
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
      <TitleTag
        className={`nm-hub-brand-bar__heading${headingStacked ? ' nm-hub-brand-bar__heading--stacked navbar-brand-group' : ''}`}
      >
        <a
          href="/"
          className={`nm-hub-brand-bar__brand${integratedDashboard ? ' navbar-brand' : ''}`}
          aria-label="NOT-APP — Inicio"
          title="Inicio"
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          <NotBrainLogoMark />
        </a>
        {headingStacked ? <span className={subtitleClasses}>{integratedSubtitle}</span> : null}
        {!headingStacked && context ? <span className="nm-hub-brand-bar__context">{context}</span> : null}
      </TitleTag>
      {hasTrailing ? <div className="nm-hub-brand-bar__trailing">{trailing}</div> : null}
    </div>
  )
}
