import { describe, expect, it } from 'vitest'
import type { ImportadosSaleLine } from './importadosSalesSummary'
import {
  argentinaIsoDay,
  buildImportadosInsightLines,
  computeImportadosAnalytics,
  formatCompactArs,
} from './importadosAnalytics'

function line(partial: Partial<ImportadosSaleLine> & Pick<ImportadosSaleLine, 'paidAt' | 'quantity'>): ImportadosSaleLine {
  return {
    lineItemId: partial.lineItemId ?? partial.paidAt,
    orderId: '1',
    orderName: '#1',
    paidAt: partial.paidAt,
    month: partial.month ?? '2026-08',
    title: partial.title ?? 'Foo',
    variantTitle: partial.variantTitle ?? 'Black',
    provider: 'lethal',
    quantity: partial.quantity,
    revenueArs: partial.revenueArs ?? 100_000,
    costUsd: 40,
    pesoKg: 0.8,
    costArs: partial.costArs ?? 40_000,
    profitArs: partial.profitArs ?? 60_000,
  }
}

describe('importados analytics', () => {
  it('builds a L–V series and weekly profit from Shopify paid times', () => {
    const { series, analytics } = computeImportadosAnalytics(
      [
        line({ paidAt: '2026-08-17T15:00:00.000Z', quantity: 2, profitArs: 120_000, costArs: 80_000, revenueArs: 200_000 }),
        line({
          paidAt: '2026-08-18T15:00:00.000Z',
          quantity: 1,
          title: 'Bar',
          variantTitle: null,
          profitArs: 50_000,
          costArs: 30_000,
          revenueArs: 80_000,
        }),
        line({
          paidAt: '2026-08-16T15:00:00.000Z',
          quantity: 4,
          profitArs: 80_000,
          costArs: 20_000,
          revenueArs: 100_000,
        }),
      ],
      '2026-08-17',
      '2026-08-10',
      new Date('2026-08-17T18:00:00.000Z'),
    )
    expect(argentinaIsoDay('2026-08-17T15:00:00.000Z')).toBe('2026-08-17')
    expect(series.map((row) => row.unidades)).toEqual([2, 1, 0, 0, 0])
    expect(analytics.weeklyUnits).toBe(3)
    expect(analytics.weekendUnits).toBe(0)
    expect(analytics.weeklyProfitArs).toBe(170_000)
    expect(analytics.topProduct?.label).toBe('Foo · Black')
  })

  it('compactes ARS like the KPI cards', () => {
    expect(formatCompactArs(3_757_975)).toBe('$3,8 M')
    expect(formatCompactArs(978_265)).toBe('$978 mil')
    expect(buildImportadosInsightLines({
      weeklyUnits: 3,
      weeklyRevenueArs: 280_000,
      weeklyCostArs: 110_000,
      weeklyProfitArs: 170_000,
      weekendUnits: 0,
      dailyAverage: 1.5,
      marginPct: 61,
      criticalDay: null,
      weeklyComparison: 50,
      monthProfitArs: 170_000,
      monthLabel: 'agosto de 2026',
      topProduct: { label: 'Foo · Black', units: 2 },
      missingCost: 0,
    }).some((line) => line.includes('61%'))).toBe(true)
  })
})
