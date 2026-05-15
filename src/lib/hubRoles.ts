import type { HubUserRole } from './types'
import {
  getHubPermissions,
  HUB_PERMISSIONS,
  HUB_ROLE_LABEL,
  type HubPermissions,
} from './hubPermissions'

export type { HubPermissions }
export { HUB_PERMISSIONS, HUB_ROLE_LABEL, getHubPermissions }

export function canUseCreadorList(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.uploadProductionList ?? false
}

export function canWriteHubTasks(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.createHubTasks ?? false
}

export function hubTasksReadOnly(role: HubUserRole | null | undefined): boolean {
  const p = getHubPermissions(role)
  if (!p?.viewHubTasks) return true
  return !p.editHubTasks
}

export function canUseManejador(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.viewCutList ?? false
}

export function canViewPrintedMaterialFiles(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.viewPrintedFiles ?? false
}

export function canEditManejadorList(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.editCutList ?? false
}

export function canDeleteManejadorReport(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.deleteCutList ?? false
}

export function canOpenHubTasks(role: HubUserRole | null | undefined): boolean {
  return getHubPermissions(role)?.viewHubTasks ?? false
}

export function canShowHomeCrearMenu(role: HubUserRole | null | undefined): boolean {
  const p = getHubPermissions(role)
  if (!p) return false
  return p.uploadProductionList || p.createHubTasks
}
