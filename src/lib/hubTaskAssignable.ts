/** Roles a los que se puede asignar una tarea (usuarios que crean tareas). */
export const HUB_TASK_ASSIGNEE_ROLES = ['online_1', 'taller_1', 'lista_creator'] as const
export type HubTaskAssignableRole =
  | (typeof HUB_TASK_ASSIGNEE_ROLES)[number]
  | 'admin'

export const HUB_TASK_ASSIGNEE_LABEL: Record<HubTaskAssignableRole, string> = {
  online_1: 'Dani (Clientes)',
  taller_1: 'Juancruz (Taller)',
  lista_creator: 'Spesia (Papel)',
  admin: 'Admin',
}

/** Opciones del dropdown según quién crea la tarea (solo admin puede asignarse a sí). */
export function getTaskAssigneeRolesForCreator(creatorIsAdmin: boolean): HubTaskAssignableRole[] {
  if (creatorIsAdmin) return [...HUB_TASK_ASSIGNEE_ROLES, 'admin']
  return [...HUB_TASK_ASSIGNEE_ROLES]
}
