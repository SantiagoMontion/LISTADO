import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { HubBrandBar } from '../HubBrandBar'
import { fetchHubDashboardStats, type HubDashboardStats } from '../../lib/hubDashboardStats'
import {
  getHubPermissions,
  HUB_ROLE_LABEL,
  type HubPermissions,
} from '../../lib/hubPermissions'
import { displayNameFromAuthUser } from '../../lib/userDisplayName'
import type { HubUserRole, NmHubProfile } from '../../lib/types'
import {
  AdminDashboard,
} from './roleDashboards'
import { HubDesktopNav } from '../HubDesktopNav'
import { HubPushNotificationSetup } from '../HubPushNotificationSetup'

interface DashboardContainerProps {
  user?: User | null
  profile?: NmHubProfile | null
  profileError?: string | null
  guestMode?: boolean
}

const EMPTY_STATS: HubDashboardStats = {
  day: '',
  pendingCutItems: 0,
  pendingHubTasks: 0,
  urgentHubTasks: 0,
  completedHubTasksToday: 0,
  hasListForDay: false,
  dispatchedOrdersToday: 0,
  dispatchedOrdersMonthTotal: 0,
}

function RoleDashboardView({
  role: _role,
  stats,
  perms,
}: {
  role: HubUserRole
  stats: HubDashboardStats
  perms: HubPermissions
}) {
  // Todos ven el mismo panel (acceso unificado).
  return <AdminDashboard stats={stats} perms={perms} />
}

export function DashboardContainer({
  user,
  profile,
  profileError = null,
  guestMode = false,
}: DashboardContainerProps) {
  const [stats, setStats] = useState<HubDashboardStats>(EMPTY_STATS)
  const [statsLoading, setStatsLoading] = useState(!guestMode)

  const displayName = !guestMode
    ? profile
      ? profile.display_name.trim()
      : (displayNameFromAuthUser(user ?? null) || '').trim()
    : ''

  const role: HubUserRole | undefined = guestMode ? undefined : profile?.role
  const perms = guestMode ? null : getHubPermissions(role)
  const noProfileRow = !guestMode && profile === null && !profileError

  useEffect(() => {
    if (guestMode || noProfileRow) {
      setStatsLoading(false)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    fetchHubDashboardStats(undefined, role)
      .then((s) => {
        if (!cancelled) setStats(s)
      })
      .catch(() => {
        if (!cancelled) setStats(EMPTY_STATS)
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [guestMode, noProfileRow, profile?.id, role])

  const roleLabel = role ? HUB_ROLE_LABEL[role] : 'Invitado'

  return (
    <div className="nm-hub-app nm-hub-app--dashboard">
      <header className="dashboard-navbar">
        <HubBrandBar integratedDashboard adminSignOut={role === 'admin'} />
      </header>

      {!guestMode ? <HubDesktopNav role={role} /> : null}

      {!guestMode ? (
        <div className="header-section">
          <p className="welcome-text-rebel">{displayName ? `Hola, ${displayName}` : 'Hola'}</p>
          <span className="role-badge-sticker" title="Perfil">
            {roleLabel}
          </span>
        </div>
      ) : null}

      {guestMode ? (
        <p className="nm-hub-footnote dashboard-footnote">
          Modo local: agregá variables de Supabase en <code>.env</code> para activar login y sincronización segura.
        </p>
      ) : null}

      {profileError ? (
        <p className="nm-hub-error dashboard-alert" role="alert">
          No se pudo cargar el perfil: {profileError}
        </p>
      ) : null}

      {noProfileRow ? (
        <div className="nm-hub-footnote dashboard-footnote">
          <p style={{ margin: '0 0 0.5rem' }}>
            Falta tu fila en <code>nm_hub_profiles</code> con el mismo <code>id</code> que la sesión.
          </p>
          {user?.id ? (
            <p style={{ margin: 0, wordBreak: 'break-all' }}>
              Tu id: <code>{user.id}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {guestMode ? (
        <nav className="cards-container-rebel" aria-label="Modo invitado">
          <p className="welcome-text-rebel">Acceso de desarrollo</p>
        </nav>
      ) : role && perms ? (
        <>
          {statsLoading ? (
            <p className="nm-hub-dash-loading" role="status">
              Actualizando resumen…
            </p>
          ) : null}
          <RoleDashboardView role={role} stats={stats} perms={perms} />
        </>
      ) : null}

      {!guestMode && profile ? (
        <HubPushNotificationSetup userId={profile.id} variant="footer" />
      ) : null}
    </div>
  )
}
