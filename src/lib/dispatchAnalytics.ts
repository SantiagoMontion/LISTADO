import { addDaysToIsoDate } from './date'

/** Un día de la serie semanal de despachos. */
export interface DispatchDayRecord {
  fecha: string
  dia: string
  despachados: number
}

export interface CriticalDayMetric {
  name: string
  percentage: number
}

export interface DispatchAnalytics {
  dailyAverage: number
  productionMedian: number
  historicMax: number
  flowSpread: number
  stabilityIndex: number
  criticalDay: CriticalDayMetric | null
  weeklyComparison: number | null
}

const WEEKDAY_LABELS_ES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const

const WORKING_DAYS_PER_WEEK = WEEKDAY_LABELS_ES.length

function valuesFromSeries(series: DispatchDayRecord[]): number[] {
  return series.map((row) => row.despachados)
}

/** Promedio diario: total / días en la serie. */
export function computeDailyAverage(series: DispatchDayRecord[]): number {
  if (series.length === 0) return 0
  const total = series.reduce((sum, row) => sum + row.despachados, 0)
  return Math.round((total / series.length) * 10) / 10
}

/** Mediana de producción (capacidad estándar). */
export function computeProductionMedian(series: DispatchDayRecord[]): number {
  const values = valuesFromSeries(series).sort((a, b) => a - b)
  const n = values.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) return values[mid]
  return Math.round(((values[mid - 1] + values[mid]) / 2) * 10) / 10
}

/** Récord histórico (máximo en la serie). */
export function computeHistoricMax(series: DispatchDayRecord[]): number {
  if (series.length === 0) return 0
  return Math.max(...valuesFromSeries(series))
}

/** Variación absoluta entre el día más alto y el más bajo. */
export function computeFlowSpread(series: DispatchDayRecord[]): number {
  if (series.length === 0) return 0
  const values = valuesFromSeries(series)
  return Math.max(...values) - Math.min(...values)
}

/**
 * Índice de estabilidad de flujo (0–100).
 * 100 = sin variación; baja cuando el spread relativo al máximo crece.
 */
export function computeStabilityIndex(series: DispatchDayRecord[]): number {
  const max = computeHistoricMax(series)
  if (max <= 0) return 100
  const spread = computeFlowSpread(series)
  return Math.max(0, Math.min(100, Math.round((1 - spread / max) * 100)))
}

/**
 * Día con mayor brecha por debajo del promedio general (%).
 * Ej.: promedio 40 y martes 34 → ~15% menos.
 */
export function computeCriticalDay(series: DispatchDayRecord[]): CriticalDayMetric | null {
  if (series.length === 0) return null
  const average = computeDailyAverage(series)
  if (average <= 0) return null

  let worst: CriticalDayMetric | null = null
  for (const row of series) {
    if (row.despachados >= average) continue
    const gap = Math.round(((average - row.despachados) / average) * 100)
    if (!worst || gap > worst.percentage) {
      worst = { name: row.dia, percentage: gap }
    }
  }
  return worst
}

/** Variación intersemanal en %. Null si la semana anterior no tiene base. */
export function computeWeeklyComparison(
  currentWeekTotal: number,
  previousWeekTotal: number,
): number | null {
  if (previousWeekTotal <= 0) return null
  return Math.round(((currentWeekTotal - previousWeekTotal) / previousWeekTotal) * 100)
}

export function sumDispatchSeries(series: DispatchDayRecord[]): number {
  return series.reduce((sum, row) => sum + row.despachados, 0)
}

export function computeDispatchAnalytics(
  currentWeek: DispatchDayRecord[],
  previousWeekTotal = 0,
): DispatchAnalytics {
  const currentTotal = sumDispatchSeries(currentWeek)
  return {
    dailyAverage: computeDailyAverage(currentWeek),
    productionMedian: computeProductionMedian(currentWeek),
    historicMax: computeHistoricMax(currentWeek),
    flowSpread: computeFlowSpread(currentWeek),
    stabilityIndex: computeStabilityIndex(currentWeek),
    criticalDay: computeCriticalDay(currentWeek),
    weeklyComparison: computeWeeklyComparison(currentTotal, previousWeekTotal),
  }
}

/** Lunes de la semana que contiene `isoDate` (zona local). */
export function mondayOfWeekContaining(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const mondayOffset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - mondayOffset)
  const y2 = date.getFullYear()
  const m2 = String(date.getMonth() + 1).padStart(2, '0')
  const d2 = String(date.getDate()).padStart(2, '0')
  return `${y2}-${m2}-${d2}`
}

/** Serie Lun–Sáb a partir de un mapa ISO → conteo. */
export function buildWeekDispatchSeries(
  counts: Record<string, number>,
  weekStartMonday: string,
): DispatchDayRecord[] {
  const series: DispatchDayRecord[] = []
  for (let i = 0; i < WORKING_DAYS_PER_WEEK; i++) {
    const fecha = addDaysToIsoDate(weekStartMonday, i)
    series.push({
      fecha,
      dia: WEEKDAY_LABELS_ES[i],
      despachados: counts[fecha] ?? 0,
    })
  }
  return series
}

export function previousWeekMonday(mondayIso: string): string {
  return addDaysToIsoDate(mondayIso, -7)
}

export function weekRangeEndSaturday(mondayIso: string): string {
  return addDaysToIsoDate(mondayIso, WORKING_DAYS_PER_WEEK - 1)
}

/** Textos extra para el feed (sin duplicar KPIs ya mostrados arriba). */
export function buildDispatchInsightLines(
  analytics: DispatchAnalytics,
  criticalDay: CriticalDayMetric | null,
): string[] {
  const lines: string[] = []

  if (analytics.weeklyComparison !== null) {
    const sign = analytics.weeklyComparison > 0 ? '+' : ''
    lines.push(
      `El volumen de esta semana varió un ${sign}${analytics.weeklyComparison}% respecto a la anterior.`,
    )
  }

  if (criticalDay) {
    lines.push(
      `Se detectó un cuello de botella estructural los ${criticalDay.name.toLowerCase()} (≈${criticalDay.percentage}% bajo el promedio).`,
    )
  }

  if (analytics.flowSpread > 0) {
    lines.push(
      `La dispersión entre el mejor y el peor día fue de ${analytics.flowSpread} pedidos (mediana ${analytics.productionMedian}).`,
    )
  }

  return lines
}
