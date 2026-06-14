/** Medidas con molde fijo en taller: no entran al plan de planchas. */
export const MOLD_MEASURE_KEYS = new Set(['90x40', '82x32'])

export function normalizeMeasureKey(dimensions: string): string | null {
  const m = dimensions.trim().match(/^(\d+)\s*[xX×]\s*(\d+)/)
  if (!m) return null
  return `${Number(m[1])}x${Number(m[2])}`
}

export function isMoldMeasure(dimensions: string): boolean {
  const key = normalizeMeasureKey(dimensions)
  return key !== null && MOLD_MEASURE_KEYS.has(key)
}

/** Separa tareas con molde vs medidas personalizadas para el plan de corte. */
export function splitMoldAndPlanTasks<T extends { dimensions: string }>(
  tasks: T[],
): { moldTasks: T[]; planTasks: T[] } {
  const moldTasks: T[] = []
  const planTasks: T[] = []
  for (const task of tasks) {
    if (isMoldMeasure(task.dimensions)) moldTasks.push(task)
    else planTasks.push(task)
  }
  return { moldTasks, planTasks }
}
