import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
  notes?: string | null
}

export type TaskProgressRow = {
  report_id: string
  total_qty: number
  current_qty: number
  is_completed: boolean
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
      'id, report_id, material_type, dimensions, total_qty, current_qty, is_priority, notes, is_completed, created_at, updated_at',
    )
    .eq('report_id', reportId)

  if (error) throw error
  return (data ?? []) as NmProdTask[]
}

export async function fetchTaskProgressRows(): Promise<TaskProgressRow[]> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('nm_prod_tasks')
    .select('report_id, total_qty, current_qty, is_completed')

  if (error) throw error
  return (data ?? []) as TaskProgressRow[]
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
    notes: t.notes ?? null,
  }))

  const { error: e2 } = await sb.from('nm_prod_tasks').insert(rows)
  if (e2) throw e2

  return { reportId }
}

export async function addTaskToReport(reportId: string, task: NewTaskRow): Promise<void> {
  const sb = requireSupabase()
  const row = {
    report_id: reportId,
    material_type: task.material_type,
    dimensions: task.dimensions,
    total_qty: task.total_qty,
    current_qty: task.current_qty ?? 0,
    is_priority: task.is_priority ?? false,
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
