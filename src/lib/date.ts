export function todayIsoLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** YYYY-MM-DD para comparar con `fecha` de Postgres (a veces viene con hora o espacios). */
export function normalizeCalendarDate(value: string): string {
  return String(value).trim().slice(0, 10)
}
