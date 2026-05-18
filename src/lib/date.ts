export function todayIsoLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Suma días a una fecha calendario YYYY-MM-DD (zona local). */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  const y2 = base.getFullYear()
  const m2 = String(base.getMonth() + 1).padStart(2, '0')
  const d2 = String(base.getDate()).padStart(2, '0')
  return `${y2}-${m2}-${d2}`
}

const MONTH_LABELS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const

/** Año-mes actual en zona local (`YYYY-MM`). */
export function currentYearMonthLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Valida y devuelve año (1–12 mes) desde `YYYY-MM`. */
export function parseYearMonth(value: string): { year: number; month: number } | null {
  const t = value.trim()
  const m = /^(\d{4})-(\d{2})$/.exec(t)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

export function formatMonthYearLabel(yearMonth: string): string {
  const parsed = parseYearMonth(yearMonth)
  if (!parsed) return yearMonth
  return `${MONTH_LABELS_ES[parsed.month - 1]} ${parsed.year}`
}

export function addMonthsToYearMonth(yearMonth: string, delta: number): string {
  const parsed = parseYearMonth(yearMonth)
  if (!parsed) return currentYearMonthLocal()
  const base = new Date(parsed.year, parsed.month - 1 + delta, 1)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function isoDateFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type MonthCalendarCell = { iso: string; day: number } | { iso: null; day: null }

/** Grilla lun–dom con celdas vacías al inicio/fin. */
export function buildMonthCalendarGrid(year: number, month: number): MonthCalendarCell[] {
  const firstWeekdayMon0 = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const totalDays = daysInCalendarMonth(year, month)
  const cells: MonthCalendarCell[] = []
  for (let i = 0; i < firstWeekdayMon0; i++) cells.push({ iso: null, day: null })
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ iso: isoDateFromParts(year, month, d), day: d })
  }
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null })
  return cells
}

/** Etiqueta corta dd/mm para cabeceras. */
export function formatDayMonthShort(isoDate: string): string {
  const parts = isoDate.split('-')
  if (parts.length < 3) return isoDate
  return `${Number(parts[2])}/${Number(parts[1])}`
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
