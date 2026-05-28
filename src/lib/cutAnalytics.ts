import { addDaysToIsoDate } from './date'
import {
  filterBusinessDays,
  formatWeekRangeDisplay,
  isBusinessDispatchDay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  weekRangeEndFriday,
} from './dispatchAnalytics'

export type {
  CriticalDayMetric,
} from './dispatchAnalytics'

export {
  formatWeekRangeDisplay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  weekRangeEndFriday,
}

/** Volumen cortado en un día laborable (según fecha_corte / eventos). */
export interface CutDayRecord {
  fecha: string
  dia: string
  cantidad: number
}

export interface CutAnalytics {
  weeklyTotal: number
  dailyAverage: number
  criticalDay: { name: string; percentage: number } | null
  weeklyComparison: number | null
  activeDays: number
}

const WEEKDAY_LABELS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const

export interface CutEventRow {
  cut_at: string
  qty: number
}

function isoDayFromTimestamp(cutAt: string): string {
  const d = new Date(cutAt)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isWeekendIsoDay(isoDay: string): boolean {
  const [y, m, d] = isoDay.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return dow === 0 || dow === 6
}

/** Agrupa eventos por día local; excluye fines de semana. */
export function aggregateCutEventsByDay(
  events: CutEventRow[],
  weekMonday: string,
  weekFriday: string,
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const ev of events) {
    const day = isoDayFromTimestamp(ev.cut_at)
    if (!day || day < weekMonday || day > weekFriday) continue
    if (isWeekendIsoDay(day)) continue
    const qty = Number.isFinite(ev.qty) && ev.qty > 0 ? Math.floor(ev.qty) : 1
    totals[day] = (totals[day] ?? 0) + qty
  }
  return totals
}

export function buildCutWeekSeries(
  dailyTotals: Record<string, number>,
  weekMonday: string,
): CutDayRecord[] {
  const series: CutDayRecord[] = []
  for (let i = 0; i < WEEKDAY_LABELS_ES.length; i++) {
    const fecha = addDaysToIsoDate(weekMonday, i)
    series.push({
      fecha,
      dia: WEEKDAY_LABELS_ES[i],
      cantidad: dailyTotals[fecha] ?? 0,
    })
  }
  return series
}

export function sumCutSeries(series: CutDayRecord[]): number {
  return filterBusinessDays(
    series.map((row) => ({ fecha: row.fecha, dia: row.dia, despachados: row.cantidad })),
  ).reduce((sum, row) => sum + row.despachados, 0)
}

/** Promedio sobre días laborables con actividad (>0), máx. 5. */
export function computeCutDailyAverage(series: CutDayRecord[]): number {
  const active = filterBusinessDays(
    series.map((row) => ({ fecha: row.fecha, dia: row.dia, despachados: row.cantidad })),
  ).filter((row) => row.despachados > 0)
  if (active.length === 0) return 0
  const total = active.reduce((sum, row) => sum + row.despachados, 0)
  return Math.round((total / active.length) * 10) / 10
}

export function computeCutCriticalDay(series: CutDayRecord[]): { name: string; percentage: number } | null {
  const laborables = filterBusinessDays(
    series.map((row) => ({ fecha: row.fecha, dia: row.dia, despachados: row.cantidad })),
  )
  const average = computeCutDailyAverage(series)
  if (average <= 0) return null

  let worst: { name: string; percentage: number } | null = null
  for (const row of laborables) {
    if (row.despachados <= 0) continue
    if (row.despachados >= average) continue
    const gap = Math.round(((average - row.despachados) / average) * 100)
    if (!worst || gap > worst.percentage) {
      worst = { name: row.dia, percentage: gap }
    }
  }
  return worst
}

export function computeCutWeeklyComparison(currentTotal: number, previousTotal: number): number | null {
  if (previousTotal <= 0) return null
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
}

export function computeCutAnalytics(
  currentWeek: CutDayRecord[],
  previousWeekTotal = 0,
): CutAnalytics {
  const weeklyTotal = sumCutSeries(currentWeek)
  const activeDays = filterBusinessDays(
    currentWeek.map((row) => ({ fecha: row.fecha, dia: row.dia, despachados: row.cantidad })),
  ).filter((row) => row.despachados > 0).length

  return {
    weeklyTotal,
    dailyAverage: computeCutDailyAverage(currentWeek),
    criticalDay: computeCutCriticalDay(currentWeek),
    weeklyComparison: computeCutWeeklyComparison(weeklyTotal, previousWeekTotal),
    activeDays,
  }
}

export function buildCutInsightLines(
  analytics: CutAnalytics,
  criticalDay: { name: string; percentage: number } | null,
  estimacionDias: number | null,
): string[] {
  const lines: string[] = []

  if (estimacionDias !== null && estimacionDias > 0 && analytics.dailyAverage > 0) {
    lines.push(
      `El ritmo de corte actual indica que el stock pendiente rinde para aproximadamente ${estimacionDias} días de trabajo estable.`,
    )
  }

  if (criticalDay) {
    lines.push(
      `Se detecta menor actividad de corte los ${criticalDay.name.toLowerCase()} (≈${criticalDay.percentage}% bajo el promedio). Se sugiere balancear las asignaciones.`,
    )
  }

  if (analytics.weeklyComparison !== null) {
    const sign = analytics.weeklyComparison > 0 ? '+' : ''
    lines.push(
      `El volumen cortado varió un ${sign}${analytics.weeklyComparison}% respecto a la semana anterior.`,
    )
  }

  return lines
}

export function dayNameFromIso(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7
  return WEEKDAY_LABELS_ES[dow] ?? ''
}

export { isBusinessDispatchDay as isBusinessCutDay }
