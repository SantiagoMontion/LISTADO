import type { HubDashboardStats } from '../../lib/hubDashboardStats'
import { hubDashboardLinks } from '../../lib/hubPermissions'
import type { HubPermissions } from '../../lib/hubPermissions'
import { DashboardCard } from './DashboardCard'

interface RoleDashboardProps {
  stats: HubDashboardStats
  perms: HubPermissions
}

/** Home único: cards de producto (sin duplicar acciones del nav). */
export function AdminDashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <nav className="cards-container-rebel" aria-label="Accesos principales">
      <DashboardCard
        href={links.cutList}
        accent="pending"
        icon="✂"
        stat={stats.pendingCutItems}
        statLabel="por cortar"
        title="Lista de corte"
      />
      <DashboardCard
        href={links.pendingTasks}
        accent="pending"
        icon="☰"
        stat={stats.pendingHubTasks}
        statLabel="pendientes"
        title="Tareas"
      />
      <DashboardCard
        href={links.dispatchedOrders}
        accent="files"
        icon="▦"
        stat={stats.dispatchedOrdersMonthTotal}
        statLabel="salidas del mes"
        title="Registro de salidas"
      />
      <DashboardCard
        href={links.logisticaAndreani}
        accent="files"
        icon="⧉"
        title="Andreani"
      />
      <DashboardCard href={links.uploadList} accent="create" icon="↑" title="Subir lista" />
      <DashboardCard href={links.printing3d} accent="create" icon="◈" title="Calculadora 3D" />
      <DashboardCard href={links.importados} accent="create" icon="◎" title="Importados" />
    </nav>
  )
}

/** Compat: todos los paneles de rol apuntan al mismo home. */
export function OnlineOperatorDashboard(props: RoleDashboardProps) {
  return <AdminDashboard {...props} />
}

export function ListaCreatorDashboard(props: RoleDashboardProps) {
  return <AdminDashboard {...props} />
}

export function Taller1Dashboard(props: RoleDashboardProps) {
  return <AdminDashboard {...props} />
}

export function Taller2Dashboard(props: RoleDashboardProps) {
  return <AdminDashboard {...props} />
}
