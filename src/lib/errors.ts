/** Postgrest / Supabase / APIs a veces devuelven `{ message, code }` sin ser `instanceof Error`. */
export function formatHttpApiError(error: unknown, status: number): string {
  if (typeof error === 'string' && error.trim() && error !== '[object Object]') {
    return error.trim()
  }
  if (error && typeof error === 'object') {
    const o = error as {
      message?: unknown
      error?: unknown
      detail?: unknown
      code?: unknown
      errors?: unknown
    }
    const msg = o.message
    if (typeof msg === 'string' && msg.trim() && msg !== '[object Object]') {
      return msg.trim()
    }
    if (Array.isArray(msg)) {
      const parts = msg.filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
      if (parts.length) return parts.join(' · ')
    }
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim()
    if (typeof o.error === 'string' && o.error.trim()) return o.error.trim()
    if (typeof o.code === 'string' && o.code.trim()) return o.code.trim()
    if (o.errors) {
      try {
        return JSON.stringify(o.errors)
      } catch {
        /* fall through */
      }
    }
    try {
      const s = JSON.stringify(error)
      if (s && s !== '{}' && s !== '[]') return s
    } catch {
      /* fall through */
    }
  }
  if (status === 504 || status === 408) {
    return 'Se agotó el tiempo creando el producto (muchas variantes o imágenes). Reintentá; el cron ajusta stock después.'
  }
  if (status === 413) return 'El producto es demasiado grande para procesar de una vez.'
  return `Error HTTP ${status}`
}

export function formatSupabaseOrError(e: unknown): string {
  if (e instanceof Error) {
    // new Error(object) → message "[object Object]"
    if (e.message && e.message !== '[object Object]') return e.message
  }
  const fromObj = formatHttpApiError(e, 0)
  if (fromObj && fromObj !== 'Error HTTP 0') return fromObj
  if (typeof e === 'string') return e
  return 'Error desconocido'
}
