/** Permisos granulares del hub (RBAC). */
import { todayIsoLocal } from './date'
import type { HubUserRole } from './types'

export interface HubPermissions {
  uploadProductionList: boolean
  viewCutList: boolean
  editCutList: boolean
  deleteCutList: boolean
  viewHubTasks: boolean
  createHubTasks: boolean
  editHubTasks: boolean
  deleteHubTasks: boolean
  viewDispatchedOrders: boolean
  editDispatchedOrders: boolean
  viewLogisticaAndreani: boolean
  view3DCalculator: boolean
  viewImportadosCalculator: boolean
  viewImportadosSync: boolean
  viewImportadosOrders: boolean
  viewPersonalizadosPdfs: boolean
  viewDashboardSummary: boolean
}

/** Acceso completo para todos: ya no hay diferencias por usuario/rol. */
const FULL_ACCESS: HubPermissions = {
  uploadProductionList: true,
  viewCutList: true,
  editCutList: true,
  deleteCutList: true,
  viewHubTasks: true,
  createHubTasks: true,
  editHubTasks: true,
  deleteHubTasks: true,
  viewDispatchedOrders: true,
  editDispatchedOrders: true,
  viewLogisticaAndreani: true,
  view3DCalculator: true,
  viewImportadosCalculator: true,
  viewImportadosSync: true,
  viewImportadosOrders: true,
  viewPersonalizadosPdfs: true,
  viewDashboardSummary: true,
}

export const HUB_PERMISSIONS: Record<HubUserRole, HubPermissions> = {
  admin: FULL_ACCESS,
  lista_creator: FULL_ACCESS,
  taller_1: FULL_ACCESS,
  online_1: FULL_ACCESS,
  taller_2: FULL_ACCESS,
}

export const HUB_ROLE_LABEL: Record<HubUserRole, string> = {
  admin: 'Admin',
  lista_creator: 'Papel',
  taller_1: 'Taller',
  online_1: 'Clientes',
  taller_2: 'CORTE - BORDADO',
}

export function getHubPermissions(role: HubUserRole | null | undefined): HubPermissions | null {
  if (!role) return null
  return HUB_PERMISSIONS[role] ?? null
}

export type HubAppPath =
  | '/'
  | '/creador'
  | '/manejador'
  | '/tareas'
  | '/pedidos-despachados'
  | '/pedidos-despachados/cargar'
  | '/pedidos-despachados/analitica'
  | '/lista-corte/analitica'
  | '/logistica-andreani'
  | '/3d'
  | '/importados'
  | '/importados-sync'
  | '/importados-pedidos'
  | '/pdfs-impresion'
  | '/entrar'

export function canAccessHubPath(
  path: string,
  role: HubUserRole | null | undefined,
): boolean {
  const p = normalizeHubPath(path)
  const perms = getHubPermissions(role)
  if (!perms) return p === '/' || p === '/entrar'

  switch (p) {
    case '/':
      return true
    case '/entrar':
      return true
    case '/creador':
      return perms.uploadProductionList
    case '/manejador':
      return perms.viewCutList
    case '/tareas':
      return perms.viewHubTasks
    case '/pedidos-despachados':
      return perms.viewDispatchedOrders
    case '/pedidos-despachados/cargar':
      return perms.editDispatchedOrders
    case '/pedidos-despachados/analitica':
      return perms.viewDispatchedOrders
    case '/lista-corte/analitica':
      return perms.viewCutList
    case '/logistica-andreani':
      return perms.viewLogisticaAndreani
    case '/3d':
      return perms.view3DCalculator
    case '/importados':
      return perms.viewImportadosCalculator
    case '/importados-sync':
      return perms.viewImportadosSync
    case '/importados-pedidos':
      return perms.viewImportadosOrders
    case '/pdfs-impresion':
      return perms.viewPersonalizadosPdfs
    default:
      return false
  }
}

export function normalizeHubPath(path: string): HubAppPath | string {
  let p = (path || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  if (p === '/entrar') return '/entrar'
  if (p === '/creador') return '/creador'
  if (p === '/manejador') return '/manejador'
  if (p === '/tareas') return '/tareas'
  if (p === '/pedidos-despachados/estadisticas') return '/pedidos-despachados'
  if (p === '/pedidos-despachados/cargar') return '/pedidos-despachados/cargar'
  if (p === '/pedidos-despachados/analitica') return '/pedidos-despachados/analitica'
  if (p === '/lista-corte/analitica') return '/lista-corte/analitica'
  if (p === '/pedidos-despachados') return '/pedidos-despachados'
  if (p === '/logistica-andreani') return '/logistica-andreani'
  if (p === '/3d') return '/3d'
  if (p === '/importados') return '/importados'
  if (p === '/importados-sync') return '/importados-sync'
  if (p === '/importados-pedidos') return '/importados-pedidos'
  if (p === '/pdfs-impresion') return '/pdfs-impresion'
  if (p === '' || p === '/') return '/'
  return p
}

/** Ruta principal tras login (menos clics). */
export function defaultHubPathForRole(_role: HubUserRole | null | undefined): string {
  return '/'
}

export function hubPathBlockedMessage(path: string, role: HubUserRole | null | undefined): string {
  const p = normalizeHubPath(path)
  const label = role ? HUB_ROLE_LABEL[role] : 'tu perfil'
  if (p === '/creador') return `El perfil «${label}» no puede subir listas de producción.`
  if (p === '/manejador') return `El perfil «${label}» no accede a la lista de corte.`
  if (p === '/tareas') return `El perfil «${label}» no usa tareas del taller.`
  if (p === '/pedidos-despachados') {
    return `El perfil «${label}» no ve pedidos despachados.`
  }
  if (p === '/pedidos-despachados/cargar') {
    return `El perfil «${label}» no puede cargar pedidos despachados.`
  }
  if (p === '/pedidos-despachados/analitica') {
    return `El perfil «${label}» no accede a la analítica avanzada de despachos.`
  }
  if (p === '/lista-corte/analitica') {
    return `El perfil «${label}» no accede a la analítica de corte.`
  }
  if (p === '/logistica-andreani') {
    return `El perfil «${label}» no accede a logística Andreani.`
  }
  if (p === '/3d') {
    return `El perfil «${label}» no accede a la calculadora 3D.`
  }
  if (p === '/importados') {
    return `El perfil «${label}» no accede a la calculadora de importados.`
  }
  if (p === '/importados-sync') {
    return `El perfil «${label}» no accede al sync de importados.`
  }
  if (p === '/importados-pedidos') {
    return `El perfil «${label}» no accede a los pedidos de importados.`
  }
  if (p === '/pdfs-impresion') {
    return `El perfil «${label}» no accede a PDFs de impresión.`
  }
  return 'No tenés permiso para esta pantalla.'
}

/** URLs del dashboard (día actual). */
export function hubDashboardLinks(day: string = todayIsoLocal()) {
  const d = encodeURIComponent(day)
  return {
    uploadList: '/creador',
    cutList: '/manejador',
    createTask: `/tareas?d=${d}&hub=crear#nm-hub-tareas-nueva`,
    pendingTasks: `/tareas?m=${d.slice(0, 7)}#nm-hub-tareas-lista`,
    completedTasks: `/tareas?m=${d.slice(0, 7)}&hub=completadas#nm-hub-tareas-lista`,
    dispatchedOrders: `/pedidos-despachados?m=${d.slice(0, 7)}`,
    dispatchAnalytics: '/pedidos-despachados/analitica',
    cutAnalytics: '/lista-corte/analitica',
    logisticaAndreani: '/logistica-andreani',
    printing3d: '/3d',
    importados: '/importados',
    importadosSync: '/importados-sync',
    importadosPedidos: '/importados-pedidos',
    personalizadosPdfs: '/pdfs-impresion',
  } as const
}

export interface HubDesktopNavItem {
  href: string
  label: string
}

export interface HubDesktopNavGroup {
  id: string
  label: string
  /** Link directo si el grupo no tiene hijos */
  href?: string
  items?: HubDesktopNavItem[]
}

/** Menú agrupado (estilo Meta/Google Admin). */
export function hubDesktopNavGroups(
  role: HubUserRole | null | undefined,
): HubDesktopNavGroup[] {
  const perms = getHubPermissions(role)
  if (!perms) return []

  const day = todayIsoLocal()
  const d = encodeURIComponent(day)
  const links = hubDashboardLinks(day)
  const groups: HubDesktopNavGroup[] = [{ id: 'inicio', label: 'Inicio', href: '/' }]

  if (perms.viewHubTasks) {
    groups.push({
      id: 'tareas',
      label: 'Tareas',
      href: `/tareas?m=${d.slice(0, 7)}`,
    })
  }

  if (perms.viewCutList || perms.uploadProductionList) {
    const corteItems: HubDesktopNavItem[] = []
    if (perms.viewCutList) corteItems.push({ href: links.cutList, label: 'Lista de corte' })
    if (perms.uploadProductionList) corteItems.push({ href: links.uploadList, label: 'Subir lista' })
    if (perms.viewCutList) corteItems.push({ href: links.cutAnalytics, label: 'Analítica' })
    groups.push({ id: 'corte', label: 'Corte', items: corteItems })
  }

  if (
    perms.viewDispatchedOrders ||
    perms.viewLogisticaAndreani ||
    perms.viewPersonalizadosPdfs
  ) {
    const enviosItems: HubDesktopNavItem[] = []
    if (perms.viewLogisticaAndreani) {
      enviosItems.push({ href: links.logisticaAndreani, label: 'Andreani' })
    }
    if (perms.viewPersonalizadosPdfs) {
      enviosItems.push({ href: links.personalizadosPdfs, label: 'PDFs impresión' })
    }
    if (perms.viewDispatchedOrders) {
      enviosItems.push({ href: links.dispatchedOrders, label: 'Registro de salidas' })
      enviosItems.push({ href: links.dispatchAnalytics, label: 'Analítica de salidas' })
    }
    groups.push({ id: 'envios', label: 'Envíos', items: enviosItems })
  }

  if (perms.view3DCalculator) {
    groups.push({ id: 'calculadoras', label: '3D', items: [
      { href: links.printing3d, label: 'Calculadoras' },
    ] })
  }

  if (
    perms.viewImportadosCalculator ||
    perms.viewImportadosSync ||
    perms.viewImportadosOrders
  ) {
    const importadosItems: HubDesktopNavItem[] = []
    if (perms.viewImportadosOrders) {
      importadosItems.push({ href: links.importadosPedidos, label: 'Pedidos' })
    }
    if (perms.viewImportadosCalculator) {
      importadosItems.push({ href: links.importados, label: 'Calculadora' })
    }
    if (perms.viewImportadosSync) {
      importadosItems.push({ href: links.importadosSync, label: 'Sync' })
    }
    groups.push({ id: 'importados', label: 'Importados', items: importadosItems })
  }

  return groups
}

/** @deprecated Prefer hubDesktopNavGroups — flat list for compatibility. */
export function hubDesktopNavLinks(
  role: HubUserRole | null | undefined,
): HubDesktopNavItem[] {
  return hubDesktopNavGroups(role).flatMap((g) => {
    if (g.items?.length) return g.items
    if (g.href) return [{ href: g.href, label: g.label }]
    return []
  })
}
