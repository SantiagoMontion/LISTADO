import { addDaysToIsoDate } from './date'
import {
  formatWeekRangeDisplay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  weekRangeEndFriday,
} from './dispatchAnalytics'
import {
  currentArgentinaMonth,
  summarizeImportadosSales,
  type ImportadosSaleLine,
} from './importadosSalesSummary'

export {
  formatWeekRangeDisplay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  weekRangeEndFriday,
}

const WEEKDAY_LABELS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const

export type ImportadosDayRecord = {
  fecha: string
  dia: string
  unidades: number
}

export type ImportadosAnalytics = {
  weeklyUnits: number
  weeklyRevenueArs: number
  weeklyCostArs: number
  weeklyProfitArs: number
  weekendUnits: number
  dailyAverage: number
  marginPct: number | null
  criticalDay: { name: string; percentage: number } | null
  weeklyComparison: number | null
  monthProfitArs: number
  monthLabel: string
  topProduct: { label: string; units: number } | null
  missingCost: number
}

export function argentinaIsoDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function isWeekendIsoDay(isoDay: string): boolean {
  const [y, m, d] = isoDay.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return dow === 0 || dow === 6
}

export function linesInRange(
  lines: ImportadosSaleLine[],
  fromIsoDay: string,
  toIsoDay: string,
): ImportadosSaleLine[] {
  return lines.filter((line) => {
    const day = argentinaIsoDay(line.paidAt)
    return Boolean(day) && day >= fromIsoDay && day <= toIsoDay
  })
}

export function aggregateUnitsByDay(
  lines: ImportadosSaleLine[],
  weekMonday: string,
  weekFriday: string,
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const line of lines) {
    const day = argentinaIsoDay(line.paidAt)
    if (!day || day < weekMonday || day > weekFriday) continue
    if (isWeekendIsoDay(day)) continue
    totals[day] = (totals[day] ?? 0) + line.quantity
  }
  return totals
}

export function buildImportadosWeekSeries(
  dailyTotals: Record<string, number>,
  weekMonday: string,
): ImportadosDayRecord[] {
  return WEEKDAY_LABELS_ES.map((dia, i) => {
    const fecha = addDaysToIsoDate(weekMonday, i)
    return {
      fecha,
      dia,
      unidades: dailyTotals[fecha] ?? 0,
    }
  })
}

function sumLineSet(lines: ImportadosSaleLine[]): {
  units: number
  revenueArs: number
  costArs: number
  profitArs: number
  missingCost: number
} {
  let units = 0
  let revenueArs = 0
  let costArs = 0
  let profitArs = 0
  let missingCost = 0
  for (const line of lines) {
    units += line.quantity
    revenueArs += line.revenueArs
    if (line.costArs == null) missingCost += line.quantity
    else {
      costArs += line.costArs
      profitArs += line.profitArs ?? 0
    }
  }
  return { units, revenueArs, costArs, profitArs, missingCost }
}

function topProduct(lines: ImportadosSaleLine[]): { label: string; units: number } | null {
  const byKey = new Map<string, { label: string; units: number }>()
  for (const line of lines) {
    const label = line.variantTitle ? `${line.title} · ${line.variantTitle}` : line.title
    const hit = byKey.get(label) ?? { label, units: 0 }
    hit.units += line.quantity
    byKey.set(label, hit)
  }
  const ranked = [...byKey.values()].sort((a, b) => b.units - a.units)
  return ranked[0] ?? null
}

function dailyAverage(series: ImportadosDayRecord[]): number {
  const active = series.filter((row) => row.unidades > 0)
  if (!active.length) return 0
  const total = active.reduce((sum, row) => sum + row.unidades, 0)
  return Math.round((total / active.length) * 10) / 10
}

function criticalDay(
  series: ImportadosDayRecord[],
  average: number,
): { name: string; percentage: number } | null {
  const active = series.filter((row) => row.unidades > 0)
  if (!active.length || average <= 0) return null
  let worst: { name: string; percentage: number } | null = null
  for (const row of active) {
    if (row.unidades >= average) continue
    const gap = Math.round(((average - row.unidades) / average) * 100)
    if (!worst || gap > worst.percentage) worst = { name: row.dia, percentage: gap }
  }
  return worst
}

export function computeImportadosAnalytics(
  lines: ImportadosSaleLine[],
  weekMonday: string,
  previousWeekMonday: string,
  now = new Date(),
): { series: ImportadosDayRecord[]; analytics: ImportadosAnalytics } {
  const weekFriday = weekRangeEndFriday(weekMonday)
  const weekSunday = addDaysToIsoDate(weekMonday, 6)
  const prevSunday = addDaysToIsoDate(previousWeekMonday, 6)

  const currentWeekLines = linesInRange(lines, weekMonday, weekSunday)
  const previousWeekLines = linesInRange(lines, previousWeekMonday, prevSunday)
  const weekendLines = currentWeekLines.filter((line) => isWeekendIsoDay(argentinaIsoDay(line.paidAt)))

  const weekdayTotals = aggregateUnitsByDay(currentWeekLines, weekMonday, weekFriday)
  const series = buildImportadosWeekSeries(weekdayTotals, weekMonday)
  const current = sumLineSet(currentWeekLines)
  const previous = sumLineSet(previousWeekLines)
  const average = dailyAverage(series)
  const monthKey = currentArgentinaMonth(now)
  const monthSummary = summarizeImportadosSales(lines).find((row) => row.month === monthKey)
  const [year, month] = monthKey.split('-')
  const monthLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  })

  const weeklyComparison =
    previous.units > 0
      ? Math.round(((current.units - previous.units) / previous.units) * 100)
      : null

  const marginPct =
    current.revenueArs > 0 && current.missingCost === 0
      ? Math.round((current.profitArs / current.revenueArs) * 100)
      : current.revenueArs > 0 && current.costArs > 0
        ? Math.round((current.profitArs / current.revenueArs) * 100)
        : null

  return {
    series,
    analytics: {
      weeklyUnits: current.units,
      weeklyRevenueArs: current.revenueArs,
      weeklyCostArs: current.costArs,
      weeklyProfitArs: current.profitArs,
      weekendUnits: weekendLines.reduce((sum, line) => sum + line.quantity, 0),
      dailyAverage: average,
      marginPct,
      criticalDay: criticalDay(series, average),
      weeklyComparison,
      monthProfitArs: monthSummary?.profitArs ?? 0,
      monthLabel,
      topProduct: topProduct(currentWeekLines),
      missingCost: current.missingCost,
    },
  }
}

export function formatCompactArs(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000
    const n = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10
    return `${sign}$${String(n).replace('.', ',')} M`
  }
  if (abs >= 10_000) {
    return `${sign}$${Math.round(abs / 1000)} mil`
  }
  return `${sign}$${Math.round(abs).toLocaleString('es-AR')}`
}

export function buildImportadosInsightLines(analytics: ImportadosAnalytics): string[] {
  const lines: string[] = []

  if (analytics.weeklyComparison !== null) {
    const sign = analytics.weeklyComparison > 0 ? '+' : ''
    lines.push(
      `El volumen de esta semana varió un ${sign}${analytics.weeklyComparison}% respecto a la anterior.`,
    )
  }

  if (analytics.marginPct !== null) {
    lines.push(`El margen de la semana (venta − costo unitario) es del ${analytics.marginPct}%.`)
  }

  if (analytics.monthProfitArs !== 0) {
    lines.push(
      `La ganancia acumulada de ${analytics.monthLabel} va en ${formatCompactArs(analytics.monthProfitArs)}.`,
    )
  }

  if (analytics.topProduct) {
    lines.push(
      `El importado más vendido de la semana fue ${analytics.topProduct.label} (${analytics.topProduct.units} uds).`,
    )
  }

  if (analytics.weekendUnits > 0) {
    lines.push(
      `El finde sumó ${analytics.weekendUnits} unidad${analytics.weekendUnits === 1 ? '' : 'es'} extra (no entra al gráfico L–V).`,
    )
  }

  if (analytics.missingCost > 0) {
    lines.push(
      `Hay ${analytics.missingCost} unidad${analytics.missingCost === 1 ? '' : 'es'} sin costo (falta USD o kg en Sync).`,
    )
  }

  if (analytics.criticalDay) {
    lines.push(
      `Se detecta menor volumen los ${analytics.criticalDay.name.toLowerCase()} (≈${analytics.criticalDay.percentage}% bajo el promedio).`,
    )
  }

  return lines
}
