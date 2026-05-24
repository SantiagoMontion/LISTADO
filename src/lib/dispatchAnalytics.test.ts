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
  mondayOfWeekContaining,
} from './dispatchAnalytics'

const SAMPLE_WEEK = [
  { fecha: '2026-05-18', dia: 'Lunes', despachados: 34 },
  { fecha: '2026-05-19', dia: 'Martes', despachados: 29 },
  { fecha: '2026-05-20', dia: 'Miércoles', despachados: 40 },
  { fecha: '2026-05-21', dia: 'Jueves', despachados: 38 },
  { fecha: '2026-05-22', dia: 'Viernes', despachados: 36 },
  { fecha: '2026-05-23', dia: 'Sábado', despachados: 33 },
]

describe('dispatchAnalytics', () => {
  it('calcula promedio diario sobre la serie', () => {
    expect(computeDailyAverage(SAMPLE_WEEK)).toBe(35)
  })

  it('calcula mediana con serie par', () => {
    expect(computeProductionMedian(SAMPLE_WEEK)).toBe(35)
  })

  it('detecta récord y spread', () => {
    expect(computeHistoricMax(SAMPLE_WEEK)).toBe(40)
    expect(computeFlowSpread(SAMPLE_WEEK)).toBe(11)
  })

  it('marca martes como día crítico (~15% bajo promedio)', () => {
    const critical = computeCriticalDay(SAMPLE_WEEK)
    expect(critical?.name).toBe('Martes')
    expect(critical?.percentage).toBe(17)
  })

  it('calcula variación intersemanal', () => {
    const total = SAMPLE_WEEK.reduce((s, r) => s + r.despachados, 0)
    expect(computeWeeklyComparison(total, 180)).toBe(17)
  })

  it('índice de estabilidad baja con alto spread', () => {
    expect(computeStabilityIndex(SAMPLE_WEEK)).toBe(73)
  })

  it('arma analytics completo', () => {
    const analytics = computeDispatchAnalytics(SAMPLE_WEEK, 180)
    expect(analytics.dailyAverage).toBe(35)
    expect(analytics.criticalDay?.name).toBe('Martes')
    expect(analytics.weeklyComparison).toBe(17)
  })

  it('construye serie lun–sáb desde mapa', () => {
    const monday = mondayOfWeekContaining('2026-05-20')
    expect(monday).toBe('2026-05-18')
    const series = buildWeekDispatchSeries(
      { '2026-05-18': 10, '2026-05-19': 5 },
      monday,
    )
    expect(series).toHaveLength(6)
    expect(series[0].despachados).toBe(10)
    expect(series[1].despachados).toBe(5)
    expect(series[2].despachados).toBe(0)
  })
})
