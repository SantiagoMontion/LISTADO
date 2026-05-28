import type { NewTaskRow } from './supabase'

/** Agrupa líneas repetidas del mismo pegado (material + medida + faltas). */
export function collapseImportTasks(tasks: NewTaskRow[]): NewTaskRow[] {
  const map = new Map<string, NewTaskRow>()
  for (const t of tasks) {
    const material = t.material_type.trim()
    const dimensions = t.dimensions.trim()
    const fromFaltas = t.from_faltas ?? false
    const key = `${material}\0${dimensions}\0${fromFaltas}`
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        material_type: material,
        dimensions,
        total_qty: Math.max(1, Number(t.total_qty) || 1),
        current_qty: t.current_qty ?? 0,
        is_priority: Boolean(t.is_priority),
        from_faltas: fromFaltas,
        notes: t.notes ?? null,
      })
    } else {
      cur.total_qty += Math.max(1, Number(t.total_qty) || 1)
      if (t.is_priority) cur.is_priority = true
    }
  }
  return [...map.values()]
}

/**
 * Al reimportar la lista del día, la cantidad importada reemplaza el total (no suma).
 * Se conserva el avance de corte hasta el nuevo tope.
 */
export function planImportUpsert(
  existing: { total_qty: number; current_qty: number } | null,
  importedTotal: number,
): { total_qty: number; current_qty: number } {
  const total = Math.max(1, importedTotal)
  if (!existing) {
    return { total_qty: total, current_qty: 0 }
  }
  const current = Math.min(Math.max(0, Number(existing.current_qty) || 0), total)
  return { total_qty: total, current_qty: current }
}
