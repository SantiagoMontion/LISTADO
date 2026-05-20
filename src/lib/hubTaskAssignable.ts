/** Roles a los que se puede asignar una tarea (usuarios que crean tareas). */
export const HUB_TASK_ASSIGNEE_ROLES = ['online_1', 'taller_1', 'lista_creator'] as const
export type HubTaskAssignableRole =
  | (typeof HUB_TASK_ASSIGNEE_ROLES)[number]
  | 'admin'

export const HUB_TASK_ASSIGNEE_LABEL: Record<HubTaskAssignableRole, string> = {
  online_1: 'Clientes',
  taller_1: 'Taller',
  lista_creator: 'Papel',
  admin: 'Admin',
}

/** Etiqueta del destinatario en chips de asignación. */
export function hubTaskAssigneeShortName(role: HubTaskAssignableRole): string {
  return HUB_TASK_ASSIGNEE_LABEL[role]
}

/** Opciones del dropdown según quién crea la tarea (solo admin puede asignarse a sí). */
export function getTaskAssigneeRolesForCreator(creatorIsAdmin: boolean): HubTaskAssignableRole[] {
  if (creatorIsAdmin) return [...HUB_TASK_ASSIGNEE_ROLES, 'admin']
  return [...HUB_TASK_ASSIGNEE_ROLES]
}
