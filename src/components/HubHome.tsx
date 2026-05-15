import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  canOpenHubTasks,
  canShowHomeCrearMenu,
  canUseCreadorList,
  canUseManejador,
  canViewPrintedMaterialFiles,
  canWriteHubTasks,
} from '../lib/hubRoles'
import { onHubLinkClick } from '../lib/hubNavigate'
import { HubBrandBar } from './HubBrandBar'
import { todayIsoLocal } from '../lib/date'
import { displayNameFromAuthUser } from '../lib/userDisplayName'
import type { HubUserRole, NmHubProfile } from '../lib/types'

interface HubHomeProps {
  user?: User | null
  profile?: NmHubProfile | null
  /** Error al leer nm_hub_profiles (p. ej. RLS); vacío si no hubo error */
  profileError?: string | null
  /** Sin Supabase / sin auth: solo desarrollo local */
  guestMode?: boolean
}

type HubHomeStep = 'menu' | 'crear' | 'ver'

export function HubHome({ user, profile, profileError = null, guestMode = false }: HubHomeProps) {
  const [step, setStep] = useState<HubHomeStep>('menu')
  const displayName = !guestMode
    ? profile
      ? profile.display_name.trim()
      : (displayNameFromAuthUser(user ?? null) || '').trim()
    : ''

  const r: HubUserRole | undefined = guestMode ? undefined : profile?.role
  const noProfileRow = !guestMode && profile === null && !profileError
  const showCrear = guestMode || noProfileRow || canShowHomeCrearMenu(r)
  const showVer = guestMode || noProfileRow || canOpenHubTasks(r) || canUseManejador(r)

  const crearDesc = (() => {
    if (guestMode || noProfileRow) return 'Subir lista o nuevas tareas'
    if (canUseCreadorList(r) && canWriteHubTasks(r)) return 'Subir lista de producción o nuevas tareas'
    if (canUseCreadorList(r)) return 'Subir lista de producción para corte'
    if (canWriteHubTasks(r)) return 'Nuevas tareas del taller'
    return ''
  })()

  const verDesc = (() => {
    if (guestMode || noProfileRow || canUseManejador(r)) {
      if (canViewPrintedMaterialFiles(r)) return 'Lista de corte, archivos impresos y tareas'
      return 'Lista de corte y tareas'
    }
    if (canOpenHubTasks(r)) return 'Ver tareas del equipo'
    return ''
  })()

  const crearTareasHref = `/tareas?d=${encodeURIComponent(todayIsoLocal())}&hub=crear#nm-hub-tareas-nueva`
  const subirImagenesCreadorHref = `/creador?subir=imagenes`
  const verTareasHref = `/tareas?d=${encodeURIComponent(todayIsoLocal())}#nm-hub-tareas-lista`
  const verCompletadasHref = `/tareas?d=${encodeURIComponent(todayIsoLocal())}&hub=completadas#nm-hub-tareas-lista`
  const verArchivosImpresosHref = `/archivos-impresos?d=${encodeURIComponent(todayIsoLocal())}`

  return (
    <div className="nm-hub-app">
      <header className="nm-hub-header">
        <HubBrandBar />
        {!guestMode ? <p className="nm-hub-greeting">{displayName ? `Hola ${displayName}` : 'Hola'}</p> : null}
      </header>

      {guestMode ? (
        <p className="nm-hub-footnote" style={{ marginBottom: '0.75rem' }}>
          Modo local: agregá variables de Supabase en <code>.env</code> para activar login y sincronización segura.
        </p>
      ) : null}

      {profileError ? (
        <p className="nm-hub-error" role="alert" style={{ marginBottom: '0.75rem' }}>
          No se pudo cargar el perfil: {profileError}
        </p>
      ) : null}

      {noProfileRow ? (
        <div className="nm-hub-footnote" style={{ marginBottom: '0.75rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>
            La app busca en <code>nm_hub_profiles</code> una fila cuyo <code>id</code> sea <strong>exactamente</strong> el
            de tu sesión. Si en Table Editor el <code>id</code> de &quot;Julian&quot; es otro UUID, esta cuenta no es
            esa fila (u otra app apunta a otro proyecto Supabase en <code>.env</code>).
          </p>
          {user?.id ? (
            <p style={{ margin: '0 0 0.5rem', wordBreak: 'break-all' }}>
              Tu id de sesión: <code>{user.id}</code>
            </p>
          ) : null}
          <p style={{ margin: 0 }}>
            SQL Editor: <code>sql/nm_hub_profiles_masivo.sql</code> · si sigue igual{' '}
            <code>sql/nm_hub_profiles_diagnostico.sql</code>.
          </p>
        </div>
      ) : null}

      {step === 'menu' ? (
        <>
          <p className="nm-hub-intro">¿Cuál sale hoy?</p>
          <nav className="nm-hub-grid nm-hub-root-nav" aria-label="Menú principal">
            {showCrear ? (
              <button type="button" className="nm-hub-tile" onClick={() => setStep('crear')}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ✎
                </span>
                <span className="nm-hub-tile-title">Crear</span>
                <span className="nm-hub-tile-desc">{crearDesc}</span>
              </button>
            ) : null}
            {showVer ? (
              <button type="button" className="nm-hub-tile nm-hub-tile--accent" onClick={() => setStep('ver')}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ☰
                </span>
                <span className="nm-hub-tile-title">Ver</span>
                <span className="nm-hub-tile-desc">{verDesc}</span>
              </button>
            ) : null}
          </nav>
        </>
      ) : null}

      {step === 'crear' ? (
        <section className="nm-hub-nav-panel" aria-labelledby="nm-hub-sec-crear">
          <button type="button" className="nm-hub-back-btn" onClick={() => setStep('menu')}>
            ← Menú
          </button>
          <h2 id="nm-hub-sec-crear" className="nm-hub-nav-heading">
            Crear
          </h2>
          <nav className="nm-hub-grid" aria-label="Crear">
            {guestMode || canUseCreadorList(r) ? (
              <a href="/creador" className="nm-hub-tile" onClick={(e) => onHubLinkClick(e, '/creador')}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ↑
                </span>
                <span className="nm-hub-tile-title">Subir lista</span>
                <span className="nm-hub-tile-desc">Pegar reporte y guardar en el día</span>
              </a>
            ) : null}
            {guestMode || canUseCreadorList(r) ? (
              <a
                href={subirImagenesCreadorHref}
                className="nm-hub-tile"
                onClick={(e) => onHubLinkClick(e, subirImagenesCreadorHref)}
              >
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ▣
                </span>
                <span className="nm-hub-tile-title">Subir imágenes</span>
                <span className="nm-hub-tile-desc">Imágenes por día (Classic, PRO, Ultra, Alfombra)</span>
              </a>
            ) : null}
            {guestMode || canWriteHubTasks(r) ? (
              <a href={crearTareasHref} className="nm-hub-tile" onClick={(e) => onHubLinkClick(e, crearTareasHref)}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ✎
                </span>
                <span className="nm-hub-tile-title">Crear tareas</span>
                <span className="nm-hub-tile-desc">Nueva tarea con detalle, fecha e imágenes</span>
              </a>
            ) : null}
          </nav>
        </section>
      ) : null}

      {step === 'ver' ? (
        <section className="nm-hub-nav-panel" aria-labelledby="nm-hub-sec-ver">
          <button type="button" className="nm-hub-back-btn" onClick={() => setStep('menu')}>
            ← Menú
          </button>
          <h2 id="nm-hub-sec-ver" className="nm-hub-nav-heading">
            Ver
          </h2>
          <nav className="nm-hub-grid" aria-label="Ver">
            {guestMode || canUseManejador(r) ? (
              <a
                href="/manejador"
                className="nm-hub-tile nm-hub-tile--accent"
                onClick={(e) => onHubLinkClick(e, '/manejador')}
              >
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ✂
                </span>
                <span className="nm-hub-tile-title">Lista de corte</span>
                <span className="nm-hub-tile-desc">Ver y marcar cortes del día</span>
              </a>
            ) : null}
            {!guestMode && canViewPrintedMaterialFiles(r) ? (
              <a
                href={verArchivosImpresosHref}
                className="nm-hub-tile"
                onClick={(e) => onHubLinkClick(e, verArchivosImpresosHref)}
              >
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ▣
                </span>
                <span className="nm-hub-tile-title">Archivos impresos</span>
                <span className="nm-hub-tile-desc">Imágenes Classic, PRO, Ultra y Alfombra por día</span>
              </a>
            ) : null}
            {guestMode || canOpenHubTasks(r) ? (
              <a href={verTareasHref} className="nm-hub-tile" onClick={(e) => onHubLinkClick(e, verTareasHref)}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ☰
                </span>
                <span className="nm-hub-tile-title">Tareas Pendientes</span>
                <span className="nm-hub-tile-desc">Listado y prioridad</span>
              </a>
            ) : null}
            {guestMode || canOpenHubTasks(r) ? (
              <a href={verCompletadasHref} className="nm-hub-tile" onClick={(e) => onHubLinkClick(e, verCompletadasHref)}>
                <span className="nm-hub-tile-icon" aria-hidden="true">
                  ✓
                </span>
                <span className="nm-hub-tile-title">Tareas completadas</span>
                <span className="nm-hub-tile-desc">Quién las cerró y cuándo</span>
              </a>
            ) : null}
          </nav>
        </section>
      ) : null}
    </div>
  )
}
