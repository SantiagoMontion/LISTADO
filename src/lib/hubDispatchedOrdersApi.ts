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

/** Solo admin (RLS en RPC). Devuelve el nuevo total. */
export async function incrementHubDispatchedCount(forDate: string): Promise<number> {
  const day = normalizeCalendarDate(forDate)
  const sb = requireClient()
  const { data, error } = await sb.rpc('nm_hub_increment_dispatched', { p_for_date: day })
  if (error) throw error
  const n = Number(data)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Respuesta inválida al registrar pedido despachado.')
  }
  return n
}
