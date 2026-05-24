import { normalizeCalendarDate } from './date'
import { supabase } from './supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

function parseCountValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value)
    return n >= 0 ? n : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Math.floor(Number(value))
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

function rpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const msg = (error.message ?? '').toLowerCase()
  return (
    error.code === 'PGRST202' ||
    msg.includes('nm_hub_set_dispatched') ||
    msg.includes('could not find the function')
  )
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
  return parseCountValue(data?.count) ?? 0
}

async function upsertHubDispatchedCount(forDate: string, total: number): Promise<number> {
  const day = normalizeCalendarDate(forDate)
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_dispatched_orders')
    .upsert({ for_date: day, count: total }, { onConflict: 'for_date' })
    .select('count')
    .single()
  if (error) throw error
  const n = parseCountValue(data?.count)
  if (n === null) {
    throw new Error('No se pudo confirmar el total guardado.')
  }
  return n
}

/** Solo admin. Fija el total del día (sobrescribe si ya existía). */
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

  if (!error) {
    const fromRpc = parseCountValue(data)
    if (fromRpc !== null) return fromRpc
  } else if (!rpcMissing(error)) {
    throw error
  }

  return upsertHubDispatchedCount(day, total)
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
    const n = parseCountValue(row.count)
    if (iso && n !== null) out[iso] = n
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

/** Conteos por día en un rango inclusivo (`YYYY-MM-DD`). */
export async function fetchHubDispatchedCountsForRange(
  startDate: string,
  endDate: string,
): Promise<HubDispatchedDayCounts> {
  const start = normalizeCalendarDate(startDate)
  const end = normalizeCalendarDate(endDate)
  if (!start || !end) throw new Error('Rango de fechas inválido.')
  if (start > end) throw new Error('La fecha inicial no puede ser posterior a la final.')

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
    const n = parseCountValue(row.count)
    if (iso && n !== null) out[iso] = n
  }
  return out
}
