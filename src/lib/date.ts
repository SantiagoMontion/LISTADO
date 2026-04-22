export function todayIsoLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** YYYY-MM-DD para comparar con `fecha` de Postgres (string, ISO, o Date). */
export function normalizeCalendarDate(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'string') {
    const t = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
    return t.slice(0, 10)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return normalizeCalendarDate((value as { value: unknown }).value)
  }
  const s = String(value)
  if (s === '[object Object]') return ''
  return s.trim().slice(0, 10)
}
