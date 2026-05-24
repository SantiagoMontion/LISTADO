import { supabase } from './supabase'
import type { CutEventRow } from './cutAnalytics'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

function rangeBounds(startDate: string, endDate: string): { start: string; end: string } {
  return {
    start: `${startDate}T00:00:00`,
    end: `${endDate}T23:59:59.999`,
  }
}

/** Eventos de corte en rango inclusivo (ISO date). */
export async function fetchCutEventsForRange(
  startDate: string,
  endDate: string,
): Promise<CutEventRow[]> {
  const { start, end } = rangeBounds(startDate, endDate)
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_prod_task_cut_events')
    .select('cut_at, qty')
    .gte('cut_at', start)
    .lte('cut_at', end)
  if (error) throw error
  return (data ?? []).map((row) => ({
    cut_at: String(row.cut_at),
    qty: Number(row.qty) || 1,
  }))
}

/** Unidades pendientes de cortar (todas las listas). */
export async function fetchPendingCutUnitsTotal(): Promise<number> {
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_prod_tasks')
    .select('current_qty, total_qty, is_completed')
  if (error) throw error
  let pending = 0
  for (const row of data ?? []) {
    const cq = Number(row.current_qty)
    const tq = Number(row.total_qty)
    if (!Number.isFinite(cq) || !Number.isFinite(tq)) continue
    if (row.is_completed === true || cq >= tq) continue
    pending += Math.max(tq - cq, 0)
  }
  return pending
}
