/** Roles a los que se puede asignar una tarea (usuarios que crean tareas). */
export const HUB_TASK_ASSIGNEE_ROLES = ['online_1', 'taller_1', 'lista_creator'] as const
export type HubTaskAssignableRole =
  | (typeof HUB_TASK_ASSIGNEE_ROLES)[number]
  | 'admin'

export const HUB_TASK_ASSIGNEE_LABEL: Record<HubTaskAssignableRole, string> = {
  online_1: 'Dani - Clientes',
  taller_1: 'JuanC - Taller',
  lista_creator: 'Spesia - Papel',
  admin: 'Admin - Admin',
}

/** Nombre corto del destinatario (ej. «Spesia» sin «- Papel»). */
export function hubTaskAssigneeShortName(role: HubTaskAssignableRole): string {
  const label = HUB_TASK_ASSIGNEE_LABEL[role]
  const dash = label.indexOf(' - ')
  if (dash > 0) return label.slice(0, dash)
  return label
}

/** Opciones del dropdown según quién crea la tarea (solo admin puede asignarse a sí). */
export function getTaskAssigneeRolesForCreator(creatorIsAdmin: boolean): HubTaskAssignableRole[] {
  if (creatorIsAdmin) return [...HUB_TASK_ASSIGNEE_ROLES, 'admin']
  return [...HUB_TASK_ASSIGNEE_ROLES]
}
