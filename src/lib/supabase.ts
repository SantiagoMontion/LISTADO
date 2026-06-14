import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeCalendarDate } from './date'
import { collapseImportTasks, planImportUpsert } from './prodTaskImport'
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

export const supabase: SupabaseClient | null = url && anon
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

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

function isMissingFromFaltasColumn(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? '').toLowerCase()
  const details = String((e as { details?: string })?.details ?? '').toLowerCase()
  const code = String((e as { code?: string })?.code ?? '')
  return (
    msg.includes('from_faltas') ||
    details.includes('from_faltas') ||
    code === '42703'
  )
}

function isMissingRpc(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? '').toLowerCase()
  const code = String((e as { code?: string })?.code ?? '')
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    msg.includes('could not find the function') ||
    msg.includes('nm_prod_increment_task_qty')
  )
}

/** UPDATE con bloqueo optimista si aún no está la RPC en Supabase. */
async function updateTaskQtyWithLock(
  task: NmProdTask,
  buildPatch: (expectedQty: number) => { current_qty: number; is_completed?: boolean } | null,
): Promise<void> {
  const sb = requireSupabase()
  let expected = task.current_qty
  for (let attempt = 0; attempt < 4; attempt++) {
    const patch = buildPatch(expected)
    if (!patch) return
    const { data, error } = await sb
      .from('nm_prod_tasks')
      .update(patch)
      .eq('id', task.id)
      .eq('current_qty', expected)
      .select('id')
    if (error) throw error
    if (data && data.length > 0) return
    const { data: fresh, error: fetchErr } = await sb
      .from('nm_prod_tasks')
      .select('current_qty, total_qty')
      .eq('id', task.id)
      .single()
    if (fetchErr) throw fetchErr
    expected = Number(fresh.current_qty)
    if (!Number.isFinite(expected)) return
  }
  throw new Error('No se pudo guardar: otro usuario modificó esta línea. La lista se actualizará sola.')
}

/** Sin columna `from_faltas`: una sola fila por material+medida (suma cantidades, prioridad si alguna era faltas). */
export function collapseTasksForLegacySchema(tasks: NewTaskRow[]): NewTaskRow[] {
  const map = new Map<string, NewTaskRow>()
  for (const t of tasks) {
    const key = `${t.material_type.trim()}\0${t.dimensions.trim()}`
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        material_type: t.material_type.trim(),
        dimensions: t.dimensions.trim(),
        total_qty: t.total_qty,
        current_qty: t.current_qty ?? 0,
        is_priority: Boolean(t.is_priority),
        notes: t.notes ?? null,
      })
    } else {
      cur.total_qty += t.total_qty
      if (t.is_priority) cur.is_priority = true
    }
  }
  return [...map.values()]
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

const TASK_PROGRESS_PAGE = 1000

type TaskProgressRow = {
  report_id: string
  current_qty: number
  total_qty: number
  is_completed: boolean
}

/** Supabase devuelve como máximo 1000 filas por consulta; sin paginar el estado «pendiente» queda mal. */
export async function fetchAllTaskProgressRows(sb: SupabaseClient): Promise<TaskProgressRow[]> {
  const out: TaskProgressRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from('nm_prod_tasks')
      .select('report_id, current_qty, total_qty, is_completed')
      .range(from, from + TASK_PROGRESS_PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as TaskProgressRow[]
    out.push(...batch)
    if (batch.length < TASK_PROGRESS_PAGE) break
    from += TASK_PROGRESS_PAGE
  }
  return out
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

  const taskData = await fetchAllTaskProgressRows(sb)

  const reports: NmProdReport[] = (repData ?? []).map((row) => {
    let fecha = normalizeCalendarDate(row.fecha)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      fecha = normalizeCalendarDate(row.created_at)
    }
    return {
      id: row.id as string,
      fecha,
      created_at: String(row.created_at ?? ''),
    }
  })

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

const TASK_SELECT_WITH_FALTAS =
  'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, from_faltas, notes, is_completed, created_at, fecha_corte'
const TASK_SELECT_LEGACY =
  'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, notes, is_completed, created_at'

function mapTaskRows(rows: unknown[] | null): NmProdTask[] {
  return (rows ?? []).map((row) => ({
    ...(row as NmProdTask),
    from_faltas: Boolean((row as { from_faltas?: boolean }).from_faltas),
  }))
}

async function resolveTaskSelect(sb: ReturnType<typeof requireSupabase>): Promise<string> {
  const probe = await sb.from('nm_prod_tasks').select(TASK_SELECT_WITH_FALTAS).limit(1)
  if (!probe.error) return TASK_SELECT_WITH_FALTAS

  const msg = String((probe.error as { message?: string }).message ?? '')
  const code = String((probe.error as { code?: string }).code ?? '')
  if (msg.includes('from_faltas') || msg.includes('fecha_corte') || code === '42703') {
    if (msg.includes('from_faltas')) return TASK_SELECT_LEGACY
    return 'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, from_faltas, notes, is_completed, created_at'
  }
  throw probe.error
}

/** Todas las tareas pendientes de todos los reportes (paginado). */
export async function fetchAllPendingTasks(): Promise<NmProdTask[]> {
  const sb = requireSupabase()
  const select = await resolveTaskSelect(sb)
  const out: NmProdTask[] = []
  let from = 0

  while (true) {
    const { data, error } = await sb
      .from('nm_prod_tasks')
      .select(select)
      .range(from, from + TASK_PROGRESS_PAGE - 1)
    if (error) throw error
    const batch = mapTaskRows(data)
    for (const task of batch) {
      if (!taskProgressRowDone(task)) out.push(task)
    }
    if ((data ?? []).length < TASK_PROGRESS_PAGE) break
    from += TASK_PROGRESS_PAGE
  }

  return out
}

export async function fetchTasks(reportId: string): Promise<NmProdTask[]> {
  const sb = requireSupabase()
  const first = await sb.from('nm_prod_tasks').select(TASK_SELECT_WITH_FALTAS).eq('report_id', reportId)
  if (!first.error) return mapTaskRows(first.data)

  const msg = String((first.error as { message?: string }).message ?? '')
  const code = String((first.error as { code?: string }).code ?? '')
  if (msg.includes('from_faltas') || msg.includes('fecha_corte') || code === '42703') {
    const withoutFechaCorte =
      'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, from_faltas, notes, is_completed, created_at'
    const second = await sb
      .from('nm_prod_tasks')
      .select(msg.includes('from_faltas') ? TASK_SELECT_LEGACY : withoutFechaCorte)
      .eq('report_id', reportId)
    if (second.error) throw second.error
    return mapTaskRows(second.data)
  }
  throw first.error
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

  const rowPayload = (tasks: NewTaskRow[], includeFromFaltas: boolean) =>
    tasks.map((t) => {
      const base = {
        report_id: reportId,
        material_type: t.material_type,
        dimensions: t.dimensions,
        total_qty: t.total_qty,
        current_qty: t.current_qty ?? 0,
        is_priority: t.is_priority ?? false,
        notes: t.notes ?? null,
      }
      return includeFromFaltas
        ? { ...base, from_faltas: t.from_faltas ?? false }
        : base
    })

  let rows = rowPayload(input.tasks, true)
  let { error: e2 } = await sb.from('nm_prod_tasks').insert(rows)
  if (e2 && isMissingFromFaltasColumn(e2)) {
    rows = rowPayload(collapseTasksForLegacySchema(input.tasks), false)
    e2 = (await sb.from('nm_prod_tasks').insert(rows)).error
  }
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
  let existingRes = await sb
    .from('nm_prod_tasks')
    .select('id, total_qty')
    .eq('report_id', reportId)
    .eq('material_type', materialType)
    .eq('dimensions', dimensions)
    .eq('from_faltas', fromFaltas)
    .maybeSingle()

  if (existingRes.error && isMissingFromFaltasColumn(existingRes.error)) {
    existingRes = await sb
      .from('nm_prod_tasks')
      .select('id, total_qty')
      .eq('report_id', reportId)
      .eq('material_type', materialType)
      .eq('dimensions', dimensions)
      .maybeSingle()
  }
  if (existingRes.error) throw existingRes.error
  const existing = existingRes.data

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

  const rowWithFaltas = {
    report_id: reportId,
    material_type: materialType,
    dimensions,
    total_qty: delta,
    current_qty: task.current_qty ?? 0,
    is_priority: task.is_priority ?? false,
    from_faltas: fromFaltas,
    notes: task.notes ?? null,
  }
  let ins = await sb.from('nm_prod_tasks').insert(rowWithFaltas)
  if (ins.error && isMissingFromFaltasColumn(ins.error)) {
    const { from_faltas: _omit, ...legacyRow } = rowWithFaltas
    ins = await sb.from('nm_prod_tasks').insert(legacyRow)
  }
  if (ins.error) throw ins.error
}

/**
 * Reimportar lista del día: usa el reporte más reciente de esa fecha y reemplaza
 * totales (no suma), conservando cuánto ya se cortó. Evita duplicar listas y
 * que medidas ya cortadas vuelvan a aparecer como pendientes.
 */
export async function importTasksIntoDay(
  fecha: string,
  tasks: NewTaskRow[],
): Promise<{ reportId: string; merged: boolean }> {
  const collapsed = collapseImportTasks(tasks)
  const existingId = await findLatestReportIdForFecha(fecha)
  if (!existingId) {
    const { reportId } = await createReportWithTasks({ fecha, tasks: collapsed })
    return { reportId, merged: false }
  }
  for (const t of collapsed) {
    await upsertTaskFromImport(existingId, t)
  }
  return { reportId: existingId, merged: true }
}

export async function findLatestReportIdForFecha(fecha: string): Promise<string | null> {
  const sb = requireSupabase()
  const day = normalizeCalendarDate(fecha)
  const { data, error } = await sb
    .from('nm_prod_reports')
    .select('id')
    .eq('fecha', day)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.id as string | undefined) ?? null
}

/** Actualiza o inserta una línea al importar (reemplaza total, mantiene corte). */
export async function upsertTaskFromImport(reportId: string, task: NewTaskRow): Promise<void> {
  const sb = requireSupabase()
  const materialType = task.material_type.trim()
  const dimensions = task.dimensions.trim()
  const importedTotal = Math.max(1, Number(task.total_qty) || 1)
  const fromFaltas = task.from_faltas ?? false

  let existingRes = await sb
    .from('nm_prod_tasks')
    .select('id, total_qty, current_qty, is_priority')
    .eq('report_id', reportId)
    .eq('material_type', materialType)
    .eq('dimensions', dimensions)
    .eq('from_faltas', fromFaltas)
    .maybeSingle()

  if (existingRes.error && isMissingFromFaltasColumn(existingRes.error)) {
    existingRes = await sb
      .from('nm_prod_tasks')
      .select('id, total_qty, current_qty, is_priority')
      .eq('report_id', reportId)
      .eq('material_type', materialType)
      .eq('dimensions', dimensions)
      .maybeSingle()
  }
  if (existingRes.error) throw existingRes.error

  const existing = existingRes.data as
    | { id: string; total_qty: number; current_qty: number; is_priority?: boolean }
    | null

  if (existing) {
    const planned = planImportUpsert(existing, importedTotal)
    const { error: upErr } = await sb
      .from('nm_prod_tasks')
      .update({
        total_qty: planned.total_qty,
        current_qty: planned.current_qty,
        is_priority: Boolean(existing.is_priority) || Boolean(task.is_priority),
      })
      .eq('id', existing.id)
    if (upErr) throw upErr
    return
  }

  const rowWithFaltas = {
    report_id: reportId,
    material_type: materialType,
    dimensions,
    total_qty: importedTotal,
    current_qty: task.current_qty ?? 0,
    is_priority: task.is_priority ?? false,
    from_faltas: fromFaltas,
    notes: task.notes ?? null,
  }
  let ins = await sb.from('nm_prod_tasks').insert(rowWithFaltas)
  if (ins.error && isMissingFromFaltasColumn(ins.error)) {
    const { from_faltas: _omit, ...legacyRow } = rowWithFaltas
    ins = await sb.from('nm_prod_tasks').insert(legacyRow)
  }
  if (ins.error) throw ins.error
}

export async function incrementTaskQty(task: NmProdTask): Promise<void> {
  if (task.current_qty >= task.total_qty) return
  const sb = requireSupabase()
  const rpc = await sb.rpc('nm_prod_increment_task_qty', { p_task_id: task.id })
  if (!rpc.error) return
  if (!isMissingRpc(rpc.error)) throw rpc.error
  await updateTaskQtyWithLock(task, (expected) => {
    if (expected >= task.total_qty) return null
    const nextQty = expected + 1
    return {
      current_qty: nextQty,
      ...(nextQty >= task.total_qty ? { is_completed: true } : {}),
    }
  })
}

export async function decrementTaskQty(task: NmProdTask): Promise<void> {
  if (task.current_qty <= 0) return
  const sb = requireSupabase()
  const rpc = await sb.rpc('nm_prod_decrement_task_qty', { p_task_id: task.id })
  if (!rpc.error) return
  if (!isMissingRpc(rpc.error)) throw rpc.error
  await updateTaskQtyWithLock(task, (expected) => {
    if (expected <= 0) return null
    return { current_qty: expected - 1, is_completed: false }
  })
}

export async function restoreTaskQty(task: NmProdTask): Promise<void> {
  const sb = requireSupabase()
  const rpc = await sb.rpc('nm_prod_restore_task_qty', { p_task_id: task.id })
  if (!rpc.error) return
  if (!isMissingRpc(rpc.error)) throw rpc.error
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({ current_qty: 0, is_completed: false })
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
  if (nextCompleted && task.current_qty < task.total_qty) {
    const rpc = await sb.rpc('nm_prod_finish_task_qty', { p_task_id: task.id })
    if (!rpc.error) return
    if (!isMissingRpc(rpc.error)) throw rpc.error
  }
  const { error } = await sb
    .from('nm_prod_tasks')
    .update({
      is_completed: nextCompleted,
      current_qty: nextCompleted ? task.total_qty : task.current_qty,
      ...(nextCompleted ? { fecha_corte: new Date().toISOString() } : { fecha_corte: null }),
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
