import { normalizeCalendarDate, todayIsoLocal } from './date'
import { fetchReportsWithTasksProgress, supabase, taskProgressRowDone } from './supabase'

export interface HubDashboardStats {
  day: string
  pendingCutItems: number
  pendingHubTasks: number
  unassignedHubTasks: number
  completedHubTasksToday: number
  hasListForDay: boolean
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

export async function fetchHubDashboardStats(forDate?: string): Promise<HubDashboardStats> {
  const day = normalizeCalendarDate(forDate ?? todayIsoLocal())
  const sb = requireClient()

  const [{ reports, reportHasPendingById }, pendingTasksRes, unassignedRes, completedRes, listRes] =
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
        .is('assigned_to', null),
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

  return {
    day,
    pendingCutItems,
    pendingHubTasks: pendingTasksRes.count ?? 0,
    unassignedHubTasks: unassignedRes.count ?? 0,
    completedHubTasksToday: completedRes.count ?? 0,
    hasListForDay: (listRes.count ?? 0) > 0,
  }
}
