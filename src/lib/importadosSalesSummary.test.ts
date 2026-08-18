import { describe, expect, it } from 'vitest'
import { currentArgentinaMonth, summarizeImportadosSales } from './importadosSalesSummary'
import { unitCostWithFrictionArs } from '../../api/_lib/importados-sync/importadosPricing'
import { argentinaMonthKey } from '../../api/_lib/importados-sync/importadosOrders'

describe('importados monthly profits', () => {
  it('groups units, revenue, cost and profit by month', () => {
    const summaries = summarizeImportadosSales([
      {
        lineItemId: '1',
        orderId: '10',
        orderName: '#10',
        paidAt: '2026-08-02T12:00:00.000Z',
        month: '2026-08',
        title: 'Foo',
        variantTitle: 'Black',
        provider: 'lethal',
        quantity: 2,
        revenueArs: 200_000,
        costUsd: 40,
        pesoKg: 0.8,
        costArs: 80_000,
        profitArs: 120_000,
      },
      {
        lineItemId: '2',
        orderId: '11',
        orderName: '#11',
        paidAt: '2026-07-02T12:00:00.000Z',
        month: '2026-07',
        title: 'Bar',
        variantTitle: null,
        provider: 'mk',
        quantity: 1,
        revenueArs: 50_000,
        costUsd: null,
        pesoKg: null,
        costArs: null,
        profitArs: null,
      },
    ])
    expect(summaries[0]?.month).toBe('2026-08')
    expect(summaries[0]?.units).toBe(2)
    expect(summaries[0]?.profitArs).toBe(120_000)
    expect(summaries[1]?.missingCost).toBe(1)
    expect(summaries[1]?.profitArs).toBe(0)
  })

  it('uses Argentina calendar month', () => {
    expect(argentinaMonthKey('2026-08-01T02:30:00.000Z')).toBe('2026-07')
    expect(currentArgentinaMonth(new Date('2026-08-17T18:00:00.000Z'))).toBe('2026-08')
  })

  it('costs a unit with the same landed formula as sync (3% CIF × MEP)', () => {
    const cost = unitCostWithFrictionArs({
      costoProductoUsd: 50,
      pesoKg: 1,
      dolarArs: 1500,
    })
    const flete = 1 * 19
    const handling = 1.5 / 15
    const cif = 50 + flete
    const landed = 50 + flete + handling + cif * 0.03
    expect(cost).toBeCloseTo(landed * 1500, 1)
  })
})
