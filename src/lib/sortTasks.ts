import type { NmProdTask } from './types'
import { surfaceFromDimensions } from './surface'

/** Prioridad arriba; luego mayor superficie primero. */
export function sortTasksForDisplay(tasks: NmProdTask[]): NmProdTask[] {
  return [...tasks].sort((a, b) => {
    if (a.is_priority !== b.is_priority) return a.is_priority ? -1 : 1
    return surfaceFromDimensions(b.dimensions) - surfaceFromDimensions(a.dimensions)
  })
}
