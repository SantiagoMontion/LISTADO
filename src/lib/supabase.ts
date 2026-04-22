import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeCalendarDate } from './date'
import type { NmProdReport, NmProdTask } from './types'

function normalizeEnv(v: string | undefined): string | undefined {
  if (!v) return undefined
  const trimmed = v.trim()
  if (!trimmed) return undefined
  // En algunos paneles se pegan valores con comillas.
  return trimmed.replace(/^['"]|['"]$/g, '')
}

const url = normalizeEnv(import.meta.env.VITE_SUPABASE_URL)
const anon = normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!url || !anon) {
  console.warn(
    '[NotMid] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY (revisar Vercel env + redeploy).',
  )
}

export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon) : null

function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}

export type NewTaskRow = {
  material_type: string
  dimensions: string
  total_qty: number
  current_qty?: number
  is_priority?: boolean
  from_faltas?: boolean
  notes?: string | null
}

export function taskProgressRowDone(row: {
  is_completed: unknown
  current_qty: unknown
  total_qty: unknown
}): boolean {
  if (row.is_completed === true || row.is_completed === 't' || row.is_completed === 1) return true
  const cq = Number(row.current_qty)
  const tq = Number(row.total_qty)
  return Number.isFinite(cq) && Number.isFinite(tq) && cq >= tq
}

/**
 * Reportes + pendientes por fecha y por reporte.
 * Tareas en query aparte (sin embed) para no truncar filas y alinear con lo que ves en pantalla.
 */
export async function fetchReportsWithTasksProgress(): Promise<{
  reports: NmProdReport[]
  pendingFechas: string[]
  reportHasPendingById: Record<string, boolean>
}> {
  const sb = requireSupabase()
  const { data: repData, error: e1 } = await sb
    .from('nm_prod_reports')
    .select('id, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })

  if (e1) throw e1

  const { data: taskData, error: e2 } = await sb
    .from('nm_prod_tasks')
    .select('report_id, current_qty, total_qty, is_completed')

  if (e2) throw e2

  const reports: NmProdReport[] = (repData ?? []).map((row) => ({
    id: row.id as string,
    fecha: normalizeCalendarDate(row.fecha as string),
    created_at: row.created_at as string,
  }))

  const reportDateById = new Map(reports.map((r) => [r.id, r.fecha]))
  const reportHasPendingById: Record<string, boolean> = {}
  for (const r of reports) reportHasPendingById[r.id] = false

  const pendingSet = new Set<string>()
  for (const t of taskData ?? []) {
    const rid = t.report_id as string
    if (!reportDateById.has(rid)) continue
    if (taskProgressRowDone(t)) continue
    reportHasPendingById[rid] = true
    const fecha = reportDateById.get(rid)
    if (fecha) pendingSet.add(fecha)
  }

  return { reports, pendingFechas: [...pendingSet], reportHasPendingById }
}

export async function fetchReports(): Promise<NmProdReport[]> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('nm_prod_reports')
    .select('id, fecha, created_at')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as NmProdReport[]
}

export async function fetchTasks(reportId: string): Promise<NmProdTask[]> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('nm_prod_tasks')
    .select(
      'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, from_faltas, notes, is_completed, created_at',
    )
    .eq('report_id', reportId)

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...(row as NmProdTask),
    from_faltas: Boolean((row as { from_faltas?: boolean }).from_faltas),
  }))
}

export async function createReportWithTasks(input: {
  fecha: string
  tasks: NewTaskRow[]
}): Promise<{ reportId: string }> {
  const sb = requireSupabase()
  const { data: rep, error: e1 } = await sb
    .from('nm_prod_reports')
    .insert({ fecha: input.fecha })
    .select('id')
    .single()

  if (e1) throw e1
  const reportId = rep.id as string

  const rows = input.tasks.map((t) => ({
    report_id: reportId,
    material_type: t.material_type,
    dimensions: t.dimensions,
    total_qty: t.total_qty,
    current_qty: t.current_qty ?? 0,
    is_priority: t.is_priority ?? false,
    from_faltas: t.from_faltas ?? false,
    notes: t.notes ?? null,
  }))

  const { error: e2 } = await sb.from('nm_prod_tasks').insert(rows)
  if (e2) throw e2

  return { reportId }
}

/**
 * Suma cantidad a una medida ya existente (mismo reporte + material + dimensiones);
 * si no existe, inserta. Evita el error UNIQUE del esquema al repetir medida.
 */
export async function mergeTaskIntoReport(reportId: string, task: NewTaskRow): Promise<void> {
  const sb = requireSupabase()
  const materialType = task.material_type.trim()
  const dimensions = task.dimensions.trim()
  const delta = Math.max(1, Number(task.total_qty) || 1)

  const fromFaltas = task.from_faltas ?? false
  const { data: existing, error: selErr } = await sb
    .from('nm_prod_tasks')
    .select('id, total_qty')
    .eq('report_id', reportId)
    .eq('material_type', materialType)
    .eq('dimensions', dimensions)
    .eq('from_faltas', fromFaltas)
    .maybeSingle()

  if (selErr) throw selErr

  if (existing) {
    const ex = existing as { id: string; total_qty: number }
    const nextTotal = ex.total_qty + delta
    const { error: upErr } = await sb
      .from('nm_prod_tasks')
      .update({ total_qty: nextTotal })
      .eq('id', ex.id)
    if (upErr) throw upErr
    return
  }

  const row = {
    report_id: reportId,
    material_type: materialType,
    dimensions,
    total_qty: delta,
    current_qty: task.current_qty ?? 0,
    is_priority: task.is_priority ?? false,
    from_faltas: fromFaltas,
    notes: task.notes ?? null,
  }
  const { error } = await sb.from('nm_prod_tasks').insert(row)
  if (error) throw error
}

export async function incrementTaskQty(task: NmProdTask): Promise<void> {
  if (task.current_qty >= task.total_qty) return
  const sb = requireSupabase()
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({ current_qty: task.current_qty + 1 })
    .eq('id', task.id)
  if (error) throw error
}

export async function decrementTaskQty(task: NmProdTask): Promise<void> {
  if (task.current_qty <= 0) return
  const nextQty = task.current_qty - 1
  const sb = requireSupabase()
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({
      current_qty: nextQty,
      // Si baja cantidad, quitamos "cortada" para mantener consistencia.
      is_completed: false,
    })
    .eq('id', task.id)
  if (error) throw error
}

export async function restoreTaskQty(task: NmProdTask): Promise<void> {
  const sb = requireSupabase()
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({
      current_qty: 0,
      is_completed: false,
    })
    .eq('id', task.id)
  if (error) throw error
}

export async function toggleTaskPriority(task: NmProdTask): Promise<void> {
  const sb = requireSupabase()
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({ is_priority: !task.is_priority })
    .eq('id', task.id)
  if (error) throw error
}

export async function toggleTaskCompleted(task: NmProdTask): Promise<void> {
  const nextCompleted = !task.is_completed
  const sb = requireSupabase()
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({
      is_completed: nextCompleted,
      current_qty: nextCompleted ? task.total_qty : task.current_qty,
    })
    .eq('id', task.id)
  if (error) throw error
}

export async function deleteReportCompletely(reportId: string): Promise<void> {
  const sb = requireSupabase()
  const { error: taskError } = await sb
    .from('nm_prod_tasks')
    .delete()
    .eq('report_id', reportId)
  if (taskError) throw taskError

  const { error: reportError } = await sb
    .from('nm_prod_reports')
    .delete()
    .eq('id', reportId)
  if (reportError) throw reportError
}
