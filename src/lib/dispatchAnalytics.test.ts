import { describe, expect, it } from 'vitest'
import {
  buildWeekDispatchSeries,
  computeCriticalDay,
  computeDailyAverage,
  computeDispatchAnalytics,
  computeFlowSpread,
  computeHistoricMax,
  computeProductionMedian,
  computeStabilityIndex,
  computeWeeklyComparison,
  filterBusinessDays,
  mondayOfWeekContaining,
  sumDispatchSeries,
} from './dispatchAnalytics'

const SAMPLE_WEEK_BUSINESS = [
  { fecha: '2026-05-18', dia: 'Lunes', despachados: 34 },
  { fecha: '2026-05-19', dia: 'Martes', despachados: 29 },
  { fecha: '2026-05-20', dia: 'Miércoles', despachados: 40 },
  { fecha: '2026-05-21', dia: 'Jueves', despachados: 38 },
  { fecha: '2026-05-22', dia: 'Viernes', despachados: 36 },
]

const SAMPLE_WITH_WEEKEND = [
  ...SAMPLE_WEEK_BUSINESS,
  { fecha: '2026-05-23', dia: 'Sábado', despachados: 0 },
  { fecha: '2026-05-24', dia: 'Domingo', despachados: 0 },
]

describe('dispatchAnalytics', () => {
  it('excluye sábado y domingo del filtro laborable', () => {
    expect(filterBusinessDays(SAMPLE_WITH_WEEKEND)).toHaveLength(5)
    expect(filterBusinessDays(SAMPLE_WITH_WEEKEND).map((d) => d.dia)).not.toContain('Sábado')
  })

  it('calcula promedio solo sobre lun–vie', () => {
    expect(computeDailyAverage(SAMPLE_WITH_WEEKEND)).toBe(35.4)
    expect(computeDailyAverage(SAMPLE_WEEK_BUSINESS)).toBe(35.4)
  })

  it('calcula mediana solo sobre días laborables', () => {
    expect(computeProductionMedian(SAMPLE_WITH_WEEKEND)).toBe(36)
  })

  it('detecta récord y spread sin fin de semana', () => {
    expect(computeHistoricMax(SAMPLE_WITH_WEEKEND)).toBe(40)
    expect(computeFlowSpread(SAMPLE_WITH_WEEKEND)).toBe(11)
  })

  it('marca martes como día crítico ignorando sábado en cero', () => {
    const critical = computeCriticalDay(SAMPLE_WITH_WEEKEND)
    expect(critical?.name).toBe('Martes')
    expect(critical?.percentage).toBe(18)
  })

  it('totales semanales ignoran fin de semana', () => {
    expect(sumDispatchSeries(SAMPLE_WITH_WEEKEND)).toBe(177)
  })

  it('calcula variación intersemanal', () => {
    expect(computeWeeklyComparison(177, 150)).toBe(18)
  })

  it('índice de estabilidad sobre días laborables', () => {
    expect(computeStabilityIndex(SAMPLE_WEEK_BUSINESS)).toBe(73)
  })

  it('arma analytics completo sin distorsión de fin de semana', () => {
    const analytics = computeDispatchAnalytics(SAMPLE_WITH_WEEKEND, 150)
    expect(analytics.dailyAverage).toBe(35.4)
    expect(analytics.criticalDay?.name).toBe('Martes')
    expect(analytics.weeklyComparison).toBe(18)
  })

  it('construye serie lun–vie desde mapa', () => {
    const monday = mondayOfWeekContaining('2026-05-20')
    expect(monday).toBe('2026-05-18')
    const series = buildWeekDispatchSeries(
      { '2026-05-18': 10, '2026-05-19': 5 },
      monday,
    )
    expect(series).toHaveLength(5)
    expect(series[0].despachados).toBe(10)
    expect(series[4].dia).toBe('Viernes')
  })
})
