import type { HubUserRole } from './types'

/** Solo este rol sube listas de producción (/creador). */
export function canUseCreadorList(role: HubUserRole | null | undefined): boolean {
  return role === 'creador_lista'
}

/** Crear / editar / borrar tareas del hub (formulario + acciones en lista). */
export function canWriteHubTasks(role: HubUserRole | null | undefined): boolean {
  return role === 'taller_1'
}

/** Pantalla /tareas en solo lectura (sin formulario ni acciones de mutación). */
export function hubTasksReadOnly(role: HubUserRole | null | undefined): boolean {
  if (role == null) return true
  return role === 'creador_lista' || role === 'taller_2'
}

/** Ver lista de corte por día (/manejador). */
export function canUseManejador(role: HubUserRole | null | undefined): boolean {
  return role === 'taller_1' || role === 'taller_2'
}

/** Ver pantalla de tareas del hub (lista; escritura según canWriteHubTasks). */
export function canOpenHubTasks(role: HubUserRole | null | undefined): boolean {
  return role === 'creador_lista' || role === 'taller_1' || role === 'taller_2'
}

/** Mostrar botón “Crear” en el home (al menos una acción de creación). */
export function canShowHomeCrearMenu(role: HubUserRole | null | undefined): boolean {
  return canUseCreadorList(role) || canWriteHubTasks(role)
}

/** Etiqueta legible del rol (UI). */
export const HUB_ROLE_LABEL: Record<HubUserRole, string> = {
  creador_lista: 'Creador de lista',
  taller_1: 'Taller 1',
  taller_2: 'Taller 2',
}
