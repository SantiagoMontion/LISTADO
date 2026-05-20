import type { HubDashboardStats } from '../../lib/hubDashboardStats'
import { hubDashboardLinks } from '../../lib/hubPermissions'
import type { HubPermissions } from '../../lib/hubPermissions'
import { DashboardCard } from './DashboardCard'
import { DashboardStatusSummary } from './DashboardStatusSummary'
interface RoleDashboardProps {
  stats: HubDashboardStats
  perms: HubPermissions
}

export function OnlineOperatorDashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <>
      <DashboardStatusSummary
        items={[
          { count: stats.pendingHubTasks, label: 'En curso' },
          { count: stats.urgentHubTasks, label: 'Urgentes' },
          { count: stats.completedHubTasksToday, label: 'Completadas', completed: true },
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel clientes operator">
        <DashboardCard href={links.createTask} accent="create" icon="✎" title="Crear tarea" />
        <DashboardCard
          href={links.pendingTasks}
          accent="pending"
          icon="☰"
          stat={stats.pendingHubTasks}
          statLabel="pendientes"
          title="Ver tareas pendientes"
        />
      </nav>
    </>
  )
}

export function AdminDashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <>
      <DashboardStatusSummary
        items={[
          { count: stats.pendingHubTasks, label: 'tareas abiertas' },
          { count: stats.pendingCutItems, label: 'por cortar' },
          { count: stats.completedHubTasksToday, label: 'hechas hoy', completed: true },
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel administración">
        <DashboardCard href={links.createTask} accent="create" icon="✎" title="Crear tarea" />
        <DashboardCard href={links.uploadList} accent="create" icon="↑" title="Subir lista" />
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
          stat={stats.urgentHubTasks}
          statLabel="urgentes"
          title="Tareas pendientes"
        />
        <DashboardCard href={links.printedFiles} accent="files" icon="▣" title="Archivos impresos" />
        <DashboardCard
          href={links.dispatchedOrders}
          accent="files"
          icon="▦"
          stat={stats.dispatchedOrdersMonthTotal}
          statLabel="en el mes"
          title="Pedidos despachados"
        />
      </nav>
    </>
  )
}

export function ListaCreatorDashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <>
      <DashboardStatusSummary
        items={[
          { count: stats.hasListForDay ? 'Sí' : 'No', label: 'lista hoy' },
          { count: stats.pendingCutItems, label: 'pend. corte' },
          { count: stats.pendingHubTasks, label: 'En curso' },
          { count: stats.completedHubTasksToday, label: 'Completadas', completed: true },
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel PDF creator">
        <DashboardCard href={links.uploadList} accent="create" icon="↑" title="Subir lista" />
        <DashboardCard href={links.uploadImages} accent="files" icon="▣" title="Subir imágenes" />
        <DashboardCard
          href={links.cutList}
          accent="pending"
          icon="✂"
          stat={stats.pendingCutItems}
          statLabel="pendientes en corte"
          title="Ver lista de corte"
        />
        <DashboardCard href={links.createTask} accent="create" icon="✎" title="Crear tarea" />
        <DashboardCard
          href={links.pendingTasks}
          accent="pending"
          icon="☰"
          stat={stats.pendingHubTasks}
          statLabel="pendientes hub"
          title="Tareas del taller"
        />
      </nav>
    </>
  )
}

export function Taller1Dashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <>
      <DashboardStatusSummary
        items={[
          { count: stats.pendingHubTasks, label: 'En curso' },
          { count: stats.urgentHubTasks, label: 'Urgentes' },
          { count: stats.completedHubTasksToday, label: 'Completadas', completed: true },
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel supervisor">
        <DashboardCard href={links.createTask} accent="create" icon="✎" title="Crear tarea" />
        <DashboardCard
          href={links.pendingTasks}
          accent="pending"
          icon="☰"
          stat={stats.pendingHubTasks}
          statLabel="pendientes"
          title="Ver tareas pendientes"
        />
        <DashboardCard href={links.printedFiles} accent="files" icon="▣" title="Ver archivos impresos" />
        <DashboardCard
          href={links.dispatchedOrders}
          accent="files"
          icon="▦"
          stat={stats.dispatchedOrdersMonthTotal}
          statLabel="en el mes"
          title="Pedidos despachados"
        />
      </nav>
    </>
  )
}

export function Taller2Dashboard({ stats }: RoleDashboardProps) {
  const links = hubDashboardLinks(stats.day)
  return (
    <nav
      className="cards-container-rebel cards-container-rebel--focus"
      aria-label="Panel operario de corte"
    >
      <DashboardCard
        href={links.cutList}
        accent="pending"
        icon="✂"
        stat={stats.pendingCutItems}
        statLabel="ítems por cortar"
        title="Lista de corte"
      />
    </nav>
  )
}
