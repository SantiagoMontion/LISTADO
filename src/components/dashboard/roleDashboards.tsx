import type { HubDashboardStats } from '../../lib/hubDashboardStats'
import { hubDashboardLinks } from '../../lib/hubPermissions'
import type { HubPermissions } from '../../lib/hubPermissions'
import { formatDayMonthShort } from '../../lib/date'
import { DashboardCard } from './DashboardCard'
import { DashboardStatusSummary } from './DashboardStatusSummary'

interface RoleDashboardProps {
  stats: HubDashboardStats
  perms: HubPermissions
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
        <DashboardCard
          href={links.createTask}
          accent="create"
          icon="✎"
          stat={stats.pendingHubTasks}
          statLabel="pendientes"
          title="Crear tarea"
          description="Nueva tarea con detalle e imágenes"
        />
        <DashboardCard
          href={links.uploadList}
          accent="create"
          icon="↑"
          title="Subir lista"
          description="Cargar reporte de producción del día"
        />
        <DashboardCard
          href={links.cutList}
          accent="pending"
          icon="✂"
          stat={stats.pendingCutItems}
          statLabel="por cortar"
          title="Lista de corte"
          description={`${formatDayMonthShort(stats.day)} · estado del taller`}
        />
        <DashboardCard
          href={links.pendingTasks}
          accent="pending"
          icon="☰"
          stat={stats.unassignedHubTasks}
          statLabel="sin asignar"
          title="Tareas pendientes"
          description="Prioridad y seguimiento"
        />
        <DashboardCard
          href={links.printedFiles}
          accent="files"
          icon="▣"
          title="Archivos impresos"
          description="Imágenes por material y día"
        />
        <DashboardCard
          href={links.completedTasks}
          accent="completed"
          icon="✓"
          stat={stats.completedHubTasksToday}
          statLabel="hechas hoy"
          title="Tareas completadas"
          description="Historial del día"
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
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel creador de lista">
        <DashboardCard
          href={links.uploadList}
          accent="create"
          icon="↑"
          title="Subir lista"
          description={
            stats.hasListForDay
              ? `Lista del ${formatDayMonthShort(stats.day)} cargada · podés actualizar`
              : 'Pegar reporte y guardar en el día'
          }
        />
        <DashboardCard
          href={links.uploadImages}
          accent="files"
          icon="▣"
          title="Subir imágenes"
          description="Classic, PRO, Ultra, Alfombra y Faltas"
        />
        <DashboardCard
          href={links.cutList}
          accent="pending"
          icon="✂"
          stat={stats.pendingCutItems}
          statLabel="pendientes en corte"
          title="Ver lista de corte"
          description="Solo lectura del avance del taller"
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
          { count: stats.pendingHubTasks, label: 'en curso' },
          { count: stats.unassignedHubTasks, label: 'sin asignar' },
          { count: stats.completedHubTasksToday, label: 'completadas', completed: true },
        ]}
      />
      <nav className="cards-container-rebel" aria-label="Panel supervisor">
        <DashboardCard
          href={links.createTask}
          accent="create"
          icon="✎"
          title="Crear tarea"
          description="Alta rápida con detalle e imágenes"
        />
        <DashboardCard
          href={links.pendingTasks}
          accent="pending"
          icon="☰"
          stat={stats.pendingHubTasks}
          statLabel="pendientes"
          title="Ver tareas pendientes"
          description="Listado y prioridad del día"
        />
        <DashboardCard
          href={links.printedFiles}
          accent="files"
          icon="▣"
          title="Ver archivos impresos"
          description="Referencias Classic, PRO, Ultra, Alfombra, Faltas"
        />
        <DashboardCard
          href={links.completedTasks}
          accent="completed"
          icon="✓"
          stat={stats.completedHubTasksToday}
          statLabel="completadas"
          title="Tareas completadas"
          description="Quién cerró cada tarea"
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
        description={`Día ${formatDayMonthShort(stats.day)} · marcar cortes al avanzar`}
      />
    </nav>
  )
}
