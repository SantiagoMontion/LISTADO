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
    expect(plan?.strips[0].stripHeight).toBe(45)
    expect(plan?.strips[0].sheetCount).toBe(2)
    expect(plan?.strips[0].pieces[0]).toEqual({ label: '127×45', count: 1 })
    expect(formatOperatorPieceLine(plan!.strips[0].pieces[0])).toBe('127×45')
  })

  it('devuelve null si no hay piezas pendientes', () => {
    const done = { ...task('a', '90x40', 1), current_qty: 1 }
    expect(buildOperatorCutPlan([done], 140)).toBeNull()
  })
})
