/** Roles a los que se puede asignar una tarea (no incluye admin ni taller_2). */
export const HUB_TASK_ASSIGNEE_ROLES = ['online_1', 'taller_1', 'lista_creator'] as const
export type HubTaskAssignableRole = (typeof HUB_TASK_ASSIGNEE_ROLES)[number]

export const HUB_TASK_ASSIGNEE_LABEL: Record<HubTaskAssignableRole, string> = {
  online_1: 'Dani',
  taller_1: 'Juancruz',
  lista_creator: 'Tomas',
}
