import { sortTasksForDisplay } from './sortTasks'
import type { NmProdTask } from './types'

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

export interface MergedMoldGroup {
  measureKey: string
  dimensions: string
  displayTask: NmProdTask
  sources: NmProdTask[]
}

function buildMergedDisplayTask(measureKey: string, sources: NmProdTask[]): NmProdTask {
  const first = sources[0]
  let totalQty = 0
  let currentQty = 0
  for (const t of sources) {
    totalQty += t.total_qty
    currentQty += t.current_qty
  }
  return {
    ...first,
    id: `merged-mold:${measureKey}`,
    total_qty: totalQty,
    current_qty: currentQty,
    is_priority: sources.some((t) => t.is_priority),
    from_faltas: sources.some((t) => t.from_faltas),
    is_completed: sources.every((t) => t.is_completed || t.current_qty >= t.total_qty),
    notes: null,
  }
}

/** Une tareas de molde iguales (90×40, 82×32) para mostrar un solo renglón. */
export function mergeMoldTasksByMeasure(tasks: NmProdTask[]): MergedMoldGroup[] {
  const groups = new Map<string, NmProdTask[]>()

  for (const task of tasks) {
    const key = normalizeMeasureKey(task.dimensions)
    if (!key || !MOLD_MEASURE_KEYS.has(key)) continue
    const list = groups.get(key) ?? []
    list.push(task)
    groups.set(key, list)
  }

  const merged: MergedMoldGroup[] = []
  for (const [measureKey, rawSources] of groups) {
    const sources = sortTasksForDisplay(rawSources)
    merged.push({
      measureKey,
      dimensions: sources[0].dimensions,
      displayTask: buildMergedDisplayTask(measureKey, sources),
      sources,
    })
  }

  return merged.sort(
    (a, b) =>
      b.displayTask.total_qty * parseSurface(b.measureKey) -
      a.displayTask.total_qty * parseSurface(a.measureKey),
  )
}

function parseSurface(measureKey: string): number {
  const [w, h] = measureKey.split('x').map(Number)
  return w * h
}

/** Primera tarea del grupo con piezas pendientes (para +). */
export function firstPendingMoldSource(sources: NmProdTask[]): NmProdTask | undefined {
  return sources.find((t) => t.current_qty < t.total_qty && !t.is_completed)
}

/** Última tarea del grupo con cantidad cortada (para −). */
export function lastCutMoldSource(sources: NmProdTask[]): NmProdTask | undefined {
  for (let i = sources.length - 1; i >= 0; i--) {
    if (sources[i].current_qty > 0) return sources[i]
  }
  return undefined
}
