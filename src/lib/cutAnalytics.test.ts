import { describe, expect, it } from 'vitest'
import {
  aggregateCutEventsByDay,
  buildCutWeekSeries,
  computeCutAnalytics,
  computeCutDailyAverage,
  computeCutCriticalDay,
} from './cutAnalytics'

describe('cutAnalytics', () => {
  const weekMonday = '2026-05-18'
  const weekFriday = '2026-05-22'

  it('agrupa por fecha_corte y excluye fin de semana', () => {
    const totals = aggregateCutEventsByDay(
      [
        { cut_at: '2026-05-18T10:00:00', qty: 10 },
        { cut_at: '2026-05-19T11:00:00', qty: 5 },
        { cut_at: '2026-05-23T09:00:00', qty: 99 },
      ],
      weekMonday,
      weekFriday,
    )
    expect(totals['2026-05-18']).toBe(10)
    expect(totals['2026-05-19']).toBe(5)
    expect(totals['2026-05-23']).toBeUndefined()
  })

  it('promedio solo sobre días con actividad', () => {
    const series = buildCutWeekSeries(
      { '2026-05-18': 20, '2026-05-19': 10 },
      weekMonday,
    )
    expect(computeCutDailyAverage(series)).toBe(15)
  })

  it('detecta día flojo de corte', () => {
    const series = buildCutWeekSeries(
      {
        '2026-05-18': 40,
        '2026-05-19': 20,
        '2026-05-20': 40,
        '2026-05-21': 40,
        '2026-05-22': 40,
      },
      weekMonday,
    )
    const critical = computeCutCriticalDay(series)
    expect(critical?.name).toBe('Martes')
    expect(critical?.percentage).toBe(44)
  })

  it('arma métricas semanales', () => {
    const series = buildCutWeekSeries({ '2026-05-18': 50, '2026-05-19': 30 }, weekMonday)
    const analytics = computeCutAnalytics(series, 60)
    expect(analytics.weeklyTotal).toBe(80)
    expect(analytics.activeDays).toBe(2)
    expect(analytics.weeklyComparison).toBe(33)
  })
})
