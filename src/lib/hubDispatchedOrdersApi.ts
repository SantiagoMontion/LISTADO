import { normalizeCalendarDate } from './date'
import { supabase } from './supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

/** Conteo del día; 0 si no hay fila. */
export async function fetchHubDispatchedCount(forDate: string): Promise<number> {
  const day = normalizeCalendarDate(forDate)
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_dispatched_orders')
    .select('count')
    .eq('for_date', day)
    .maybeSingle()
  if (error) throw error
  const n = Number(data?.count)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Solo admin (RPC). Fija el total del día y devuelve el valor guardado. */
export async function setHubDispatchedCount(forDate: string, count: number): Promise<number> {
  const day = normalizeCalendarDate(forDate)
  const total = Math.floor(count)
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('Ingresá un número mayor o igual a 0.')
  }
  const sb = requireClient()
  const { data, error } = await sb.rpc('nm_hub_set_dispatched', {
    p_for_date: day,
    p_count: total,
  })
  if (error) throw error
  const n = Number(data)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Respuesta inválida al guardar pedidos despachados.')
  }
  return n
}

export type HubDispatchedDayCounts = Record<string, number>

/** Conteos por día en un mes (`YYYY-MM`). Días sin fila no aparecen en el mapa. */
export async function fetchHubDispatchedCountsForMonth(
  yearMonth: string,
): Promise<HubDispatchedDayCounts> {
  const parsed = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim())
  if (!parsed) throw new Error('Mes inválido.')
  const year = Number(parsed[1])
  const month = Number(parsed[2])
  if (month < 1 || month > 12) throw new Error('Mes inválido.')

  const start = `${year}-${parsed[2]}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${parsed[2]}-${String(lastDay).padStart(2, '0')}`

  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_dispatched_orders')
    .select('for_date, count')
    .gte('for_date', start)
    .lte('for_date', end)
  if (error) throw error

  const out: HubDispatchedDayCounts = {}
  for (const row of data ?? []) {
    const iso = normalizeCalendarDate(row.for_date)
    const n = Number(row.count)
    if (iso && Number.isFinite(n) && n >= 0) out[iso] = n
  }
  return out
}

export function sumHubDispatchedCounts(counts: HubDispatchedDayCounts): number {
  let total = 0
  for (const n of Object.values(counts)) {
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}
