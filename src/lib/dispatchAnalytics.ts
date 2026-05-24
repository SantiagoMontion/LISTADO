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

const WEEKDAY_LABELS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const

const WORKING_DAYS_PER_WEEK = WEEKDAY_LABELS_ES.length

function valuesFromSeries(series: DispatchDayRecord[]): number[] {
  return series.map((row) => row.despachados)
}

/** Excluye sábado y domingo (taller opera lun–vie). */
export function isBusinessDispatchDay(dia: string): boolean {
  const nombreDia = dia.trim().toLowerCase()
  return nombreDia !== 'sábado' && nombreDia !== 'sabado' && nombreDia !== 'domingo'
}

/** Filtra el historial a días laborables antes de métricas. */
export function filterBusinessDays(series: DispatchDayRecord[]): DispatchDayRecord[] {
  return series.filter((item) => isBusinessDispatchDay(item.dia))
}

/** Promedio diario: total / días laborables en la serie. */
export function computeDailyAverage(series: DispatchDayRecord[]): number {
  const diasLaborables = filterBusinessDays(series)
  if (diasLaborables.length === 0) return 0
  const total = diasLaborables.reduce((sum, row) => sum + row.despachados, 0)
  return Math.round((total / diasLaborables.length) * 10) / 10
}

/** Mediana de producción (capacidad estándar), solo días laborables. */
export function computeProductionMedian(series: DispatchDayRecord[]): number {
  const values = valuesFromSeries(filterBusinessDays(series)).sort((a, b) => a - b)
  const n = values.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) return values[mid]
  return Math.round(((values[mid - 1] + values[mid]) / 2) * 10) / 10
}

/** Récord histórico (máximo en días laborables). */
export function computeHistoricMax(series: DispatchDayRecord[]): number {
  const diasLaborables = filterBusinessDays(series)
  if (diasLaborables.length === 0) return 0
  return Math.max(...valuesFromSeries(diasLaborables))
}

/** Variación absoluta entre el día más alto y el más bajo (lun–vie). */
export function computeFlowSpread(series: DispatchDayRecord[]): number {
  const diasLaborables = filterBusinessDays(series)
  if (diasLaborables.length === 0) return 0
  const values = valuesFromSeries(diasLaborables)
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
 * Día laborable con mayor brecha por debajo del promedio (%).
 */
export function computeCriticalDay(series: DispatchDayRecord[]): CriticalDayMetric | null {
  const diasLaborables = filterBusinessDays(series)
  if (diasLaborables.length === 0) return null
  const average = computeDailyAverage(diasLaborables)
  if (average <= 0) return null

  let worst: CriticalDayMetric | null = null
  for (const row of diasLaborables) {
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
  return filterBusinessDays(series).reduce((sum, row) => sum + row.despachados, 0)
}

export function computeDispatchAnalytics(
  currentWeek: DispatchDayRecord[],
  previousWeekTotal = 0,
): DispatchAnalytics {
  const diasLaborables = filterBusinessDays(currentWeek)
  const currentTotal = sumDispatchSeries(currentWeek)
  return {
    dailyAverage: computeDailyAverage(diasLaborables),
    productionMedian: computeProductionMedian(diasLaborables),
    historicMax: computeHistoricMax(diasLaborables),
    flowSpread: computeFlowSpread(diasLaborables),
    stabilityIndex: computeStabilityIndex(diasLaborables),
    criticalDay: computeCriticalDay(diasLaborables),
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

/** Serie Lun–Vie a partir de un mapa ISO → conteo. */
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

export function nextWeekMonday(mondayIso: string): string {
  return addDaysToIsoDate(mondayIso, 7)
}

/** Rango visible en el paginador (ej. 18/05/2026 — 22/05/2026). */
export function formatWeekRangeDisplay(mondayIso: string, fridayIso: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return `${Number(d)}/${Number(m)}/${y}`
  }
  return `${fmt(mondayIso)} — ${fmt(fridayIso)}`
}

/** Viernes de la semana laborable (lun + 4). */
export function weekRangeEndFriday(mondayIso: string): string {
  return addDaysToIsoDate(mondayIso, WORKING_DAYS_PER_WEEK - 1)
}

/** @deprecated Usar weekRangeEndFriday */
export function weekRangeEndSaturday(mondayIso: string): string {
  return weekRangeEndFriday(mondayIso)
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
