/** Postgrest / Supabase a veces devuelve `{ message, code }` sin ser `instanceof Error`. */
export function formatSupabaseOrError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error_description?: unknown; details?: unknown }
    if (typeof o.message === 'string' && o.message.trim()) return o.message
    if (typeof o.error_description === 'string' && o.error_description.trim()) {
      return o.error_description
    }
    if (typeof o.details === 'string' && o.details.trim()) return o.details
  }
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return 'Error desconocido'
  }
}
