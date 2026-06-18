import { todayIsoLocal } from './date'
import type { HubUserRole } from './types'

/** Permisos granulares del hub (RBAC). */
export interface HubPermissions {
  uploadProductionList: boolean
  uploadMaterialImages: boolean
  viewCutList: boolean
  editCutList: boolean
  deleteCutList: boolean
  viewHubTasks: boolean
  createHubTasks: boolean
  editHubTasks: boolean
  deleteHubTasks: boolean
  viewPrintedFiles: boolean
  viewDispatchedOrders: boolean
  editDispatchedOrders: boolean
  viewLogisticaAndreani: boolean
  viewDashboardSummary: boolean
}

export const HUB_PERMISSIONS: Record<HubUserRole, HubPermissions> = {
  admin: {
    uploadProductionList: true,
    uploadMaterialImages: true,
    viewCutList: true,
    editCutList: true,
    deleteCutList: true,
    viewHubTasks: true,
    createHubTasks: true,
    editHubTasks: true,
    deleteHubTasks: true,
    viewPrintedFiles: true,
    viewDispatchedOrders: true,
    editDispatchedOrders: true,
    viewLogisticaAndreani: true,
    viewDashboardSummary: true,
  },
  lista_creator: {
    uploadProductionList: true,
    uploadMaterialImages: true,
    viewCutList: true,
    editCutList: false,
    deleteCutList: false,
    viewHubTasks: true,
    createHubTasks: true,
    editHubTasks: true,
    deleteHubTasks: false,
    viewPrintedFiles: false,
    viewDispatchedOrders: false,
    editDispatchedOrders: false,
    viewLogisticaAndreani: false,
    viewDashboardSummary: true,
  },
  taller_1: {
    uploadProductionList: false,
    uploadMaterialImages: false,
    viewCutList: false,
    editCutList: false,
    deleteCutList: false,
    viewHubTasks: true,
    createHubTasks: true,
    editHubTasks: true,
    deleteHubTasks: true,
    viewPrintedFiles: true,
    viewDispatchedOrders: true,
    editDispatchedOrders: false,
    viewLogisticaAndreani: false,
    viewDashboardSummary: true,
  },
  online_1: {
    uploadProductionList: false,
    uploadMaterialImages: false,
    viewCutList: false,
    editCutList: false,
    deleteCutList: false,
    viewHubTasks: true,
    createHubTasks: true,
    editHubTasks: true,
    deleteHubTasks: false,
    viewPrintedFiles: false,
    viewDispatchedOrders: false,
    editDispatchedOrders: false,
    viewLogisticaAndreani: false,
    viewDashboardSummary: true,
  },
  taller_2: {
    uploadProductionList: false,
    uploadMaterialImages: false,
    viewCutList: true,
    editCutList: true,
    deleteCutList: true,
    viewHubTasks: false,
    createHubTasks: false,
    editHubTasks: false,
    deleteHubTasks: false,
    viewPrintedFiles: false,
    viewDispatchedOrders: false,
    editDispatchedOrders: false,
    viewLogisticaAndreani: false,
    viewDashboardSummary: false,
  },
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
  | '/archivos-impresos'
  | '/pedidos-despachados'
  | '/pedidos-despachados/cargar'
  | '/pedidos-despachados/analitica'
  | '/lista-corte/analitica'
  | '/logistica-andreani'
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
    case '/archivos-impresos':
      return perms.viewPrintedFiles
    case '/pedidos-despachados':
      return perms.viewDispatchedOrders
    case '/pedidos-despachados/cargar':
      return perms.editDispatchedOrders
    case '/pedidos-despachados/analitica':
      return role === 'admin'
    case '/lista-corte/analitica':
      return role === 'admin'
    case '/logistica-andreani':
      return perms.viewLogisticaAndreani
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
  if (p === '/archivos-impresos') return '/archivos-impresos'
  if (p === '/pedidos-despachados/estadisticas') return '/pedidos-despachados'
  if (p === '/pedidos-despachados/cargar') return '/pedidos-despachados/cargar'
  if (p === '/pedidos-despachados/analitica') return '/pedidos-despachados/analitica'
  if (p === '/lista-corte/analitica') return '/lista-corte/analitica'
  if (p === '/pedidos-despachados') return '/pedidos-despachados'
  if (p === '/logistica-andreani') return '/logistica-andreani'
  if (p === '' || p === '/') return '/'
  return p
}

/** Ruta principal tras login (menos clics). */
export function defaultHubPathForRole(role: HubUserRole | null | undefined): string {
  switch (role) {
    case 'taller_2':
      return '/manejador'
    case 'lista_creator':
      return '/'
    case 'online_1':
      return '/tareas'
    default:
      return '/'
  }
}

export function hubPathBlockedMessage(path: string, role: HubUserRole | null | undefined): string {
  const p = normalizeHubPath(path)
  const label = role ? HUB_ROLE_LABEL[role] : 'tu perfil'
  if (p === '/creador') return `El perfil «${label}» no puede subir listas de producción.`
  if (p === '/manejador') return `El perfil «${label}» no accede a la lista de corte.`
  if (p === '/tareas') return `El perfil «${label}» no usa tareas del taller.`
  if (p === '/archivos-impresos') return `El perfil «${label}» no ve archivos impresos.`
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
  return 'No tenés permiso para esta pantalla.'
}

/** URLs del dashboard (día actual). */
export function hubDashboardLinks(day: string = todayIsoLocal()) {
  const d = encodeURIComponent(day)
  return {
    uploadList: '/creador',
    uploadImages: `/creador?subir=imagenes`,
    cutList: '/manejador',
    createTask: `/tareas?d=${d}&hub=crear#nm-hub-tareas-nueva`,
    pendingTasks: `/tareas?d=${d}#nm-hub-tareas-lista`,
    completedTasks: `/tareas?d=${d}&hub=completadas#nm-hub-tareas-lista`,
    printedFiles: `/archivos-impresos?d=${d}`,
    dispatchedOrders: `/pedidos-despachados?m=${d.slice(0, 7)}`,
    dispatchAnalytics: '/pedidos-despachados/analitica',
    cutAnalytics: '/lista-corte/analitica',
    logisticaAndreani: '/logistica-andreani',
  } as const
}

export interface HubDesktopNavItem {
  href: string
  label: string
}

/** Enlaces del menú horizontal (solo escritorio). */
export function hubDesktopNavLinks(
  role: HubUserRole | null | undefined,
): HubDesktopNavItem[] {
  const perms = getHubPermissions(role)
  if (!perms) return []

  const day = todayIsoLocal()
  const d = encodeURIComponent(day)
  const links = hubDashboardLinks(day)
  const items: HubDesktopNavItem[] = [{ href: '/', label: 'Inicio' }]

  if (perms.viewHubTasks) {
    items.push({ href: `/tareas?d=${d}`, label: 'Tareas' })
  }
  if (perms.viewCutList) {
    items.push({ href: links.cutList, label: 'Lista corte' })
  }
  if (perms.uploadProductionList) {
    items.push({ href: links.uploadList, label: 'Subir lista' })
  }
  if (perms.viewPrintedFiles) {
    items.push({ href: links.printedFiles, label: 'Impresos' })
  }
  if (perms.viewDispatchedOrders) {
    items.push({ href: links.dispatchedOrders, label: 'Despachos' })
  }
  if (perms.viewLogisticaAndreani) {
    items.push({ href: links.logisticaAndreani, label: 'Andreani' })
  }
  if (role === 'admin') {
    items.push({ href: links.dispatchAnalytics, label: 'Analítica desp.' })
    items.push({ href: links.cutAnalytics, label: 'Analítica corte' })
  }

  return items
}
