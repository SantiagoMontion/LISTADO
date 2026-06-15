import { parseTaskMeasure } from './parseTaskMeasure'
import type { NmProdTask } from './types'

export function measureLabelFromDimensions(dimensions: string): string | null {
  const m = parseTaskMeasure(dimensions)
  if (!m) return null
  return `${m.ancho}×${m.alto}`
}

export function tasksMatchingLabel(tasks: NmProdTask[], label: string): NmProdTask[] {
  return tasks.filter((t) => measureLabelFromDimensions(t.dimensions) === label)
}

export function remainingQtyForLabel(tasks: NmProdTask[], label: string): number {
  return tasksMatchingLabel(tasks, label).reduce(
    (sum, t) => sum + Math.max(t.total_qty - t.current_qty, 0),
    0,
  )
}

export function firstPendingTaskForLabel(
  tasks: NmProdTask[],
  label: string,
): NmProdTask | undefined {
  return tasksMatchingLabel(tasks, label).find(
    (t) => !t.is_completed && t.current_qty < t.total_qty,
  )
}

export function lastCutTaskForLabel(tasks: NmProdTask[], label: string): NmProdTask | undefined {
  const matches = tasksMatchingLabel(tasks, label)
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].current_qty > 0) return matches[i]
  }
  return undefined
}
