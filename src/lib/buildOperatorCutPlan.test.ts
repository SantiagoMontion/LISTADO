import { describe, expect, it } from 'vitest'
import { buildOperatorCutPlan, formatOperatorPieceLine } from './buildOperatorCutPlan'
import type { NmProdTask } from './types'

function task(id: string, dimensions: string, totalQty: number): NmProdTask {
  return {
    id,
    report_id: 'r1',
    material_type: 'classic',
    dimensions,
    total_qty: totalQty,
    current_qty: 0,
    is_priority: false,
    from_faltas: false,
    notes: null,
    is_completed: false,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('buildOperatorCutPlan', () => {
  it('agrupa planchas iguales y muestra cantidad por medida', () => {
    const plan = buildOperatorCutPlan([task('a', '127x45', 2)], 140)
    expect(plan?.strips).toHaveLength(1)
    expect(plan?.strips[0].stripHeight).toBe(45)
    expect(plan?.strips[0].sheetCount).toBe(2)
    expect(plan?.strips[0].pieces[0]).toEqual({ label: '127×45', count: 2 })
    expect(formatOperatorPieceLine(plan!.strips[0].pieces[0])).toBe('2 × 127×45')
  })

  it('varias planchas iguales → una tarjeta con el total', () => {
    const plan = buildOperatorCutPlan([task('a', '70x30', 4)], 140)
    expect(plan?.strips).toHaveLength(1)
    expect(plan?.strips[0].stripHeight).toBe(30)
    expect(plan?.strips[0].sheetCount).toBe(2)
    expect(plan?.strips[0].pieces).toEqual([{ label: '70×30', count: 4 }])
  })

  it('une planchas del mismo largo aunque tengan distinto ancho usado', () => {
    const plan = buildOperatorCutPlan(
      [task('a', '25x25', 5), task('b', '65x25', 1), task('c', '47x25', 1)],
      140,
    )
    const twentyFive = plan?.strips.filter((s) => s.stripHeight === 25) ?? []
    expect(twentyFive).toHaveLength(1)
    expect(twentyFive[0].sheetCount).toBeGreaterThanOrEqual(2)
    expect(twentyFive[0].mixedLayouts).toBe(true)
  })

  it('une planchas iguales aunque no sean consecutivas en el empaquetado', () => {
    const plan = buildOperatorCutPlan(
      [task('a', '70x30', 2), task('b', '60x65', 1), task('c', '70x30', 2)],
      140,
    )
    const thirty = plan?.strips.filter((s) => s.stripHeight === 30) ?? []
    expect(thirty).toHaveLength(1)
    expect(thirty[0].sheetCount).toBe(2)
  })

  it('devuelve null si no hay piezas pendientes', () => {
    const done = { ...task('a', '90x40', 1), current_qty: 1 }
    expect(buildOperatorCutPlan([done], 140)).toBeNull()
  })
})
