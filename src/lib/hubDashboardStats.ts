import { normalizeCalendarDate, todayIsoLocal } from './date'
import { fetchHubDispatchedCount } from './hubDispatchedOrdersApi'
import { fetchReportsWithTasksProgress, supabase, taskProgressRowDone } from './supabase'
import type { HubUserRole } from './types'

export interface HubDashboardStats {
  /** Día ISO (local) sobre el que agrupan las métricas de tareas hub. */
  day: string
  pendingCutItems: number
  /** Tareas hub pendientes del día (`for_date`, sin `executed_at`). */
  pendingHubTasks: number
  /** Pendientes del mismo día con prioridad urgente (`importance = urgent`). */
  urgentHubTasks: number
  /** Completadas del mismo día (`for_date`, con `executed_at`). */
  completedHubTasksToday: number
  hasListForDay: boolean
  /** Pedidos despachados del día (admin / taller_1). */
  dispatchedOrdersToday: number
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

export async function fetchHubDashboardStats(
  forDate?: string,
  role?: HubUserRole | null,
): Promise<HubDashboardStats> {
  const day = normalizeCalendarDate(forDate ?? todayIsoLocal())
  const sb = requireClient()

  const [{ reports, reportHasPendingById }, pendingTasksRes, urgentRes, completedRes, listRes] =
    await Promise.all([
      fetchReportsWithTasksProgress(),
      sb
        .from('nm_hub_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('for_date', day)
        .is('executed_at', null),
      sb
        .from('nm_hub_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('for_date', day)
        .is('executed_at', null)
        .eq('importance', 'urgent'),
      sb
        .from('nm_hub_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('for_date', day)
        .not('executed_at', 'is', null),
      sb.from('nm_prod_reports').select('id', { count: 'exact', head: true }).eq('fecha', day),
    ])

  const reportsToday = reports.filter((r) => normalizeCalendarDate(r.fecha) === day)
  let pendingCutItems = 0
  if (reportsToday.length > 0) {
    const { data: taskRows, error: tasksErr } = await sb
      .from('nm_prod_tasks')
      .select('report_id, current_qty, total_qty, is_completed')
      .in(
        'report_id',
        reportsToday.map((r) => r.id),
      )

    if (!tasksErr && taskRows) {
      for (const t of taskRows) {
        const cq = Number(t.current_qty)
        const tq = Number(t.total_qty)
        if (!taskProgressRowDone(t)) pendingCutItems += Math.max(tq - cq, 0) || 1
      }
    } else {
      for (const r of reportsToday) {
        if (reportHasPendingById[r.id]) pendingCutItems += 1
      }
    }
  }

  let dispatchedOrdersToday = 0
  if (role === 'admin' || role === 'taller_1') {
    try {
      dispatchedOrdersToday = await fetchHubDispatchedCount(day)
    } catch {
      dispatchedOrdersToday = 0
    }
  }

  return {
    day,
    pendingCutItems,
    pendingHubTasks: pendingTasksRes.count ?? 0,
    urgentHubTasks: urgentRes.count ?? 0,
    completedHubTasksToday: completedRes.count ?? 0,
    hasListForDay: (listRes.count ?? 0) > 0,
    dispatchedOrdersToday,
  }
}
