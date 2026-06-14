import { describe, expect, it } from 'vitest'
import { buildOperatorCutPlan } from './buildOperatorCutPlan'
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
  it('agrupa tiras iguales y describe medidas para el operario', () => {
    const plan = buildOperatorCutPlan(
      [
        task('a', '90x40', 3),
        task('b', '50x40', 3),
        task('c', '82x32', 1),
      ],
      140,
    )

    expect(plan).not.toBeNull()
    expect(plan!.stripCount).toBe(4)
    const paired = plan!.strips.find((s) => s.sheetCount === 3 && s.stripHeight === 40)
    expect(paired?.pieces.map((p) => p.label)).toEqual(['90×40', '50×40'])
  })

  it('devuelve null si no hay piezas pendientes', () => {
    const done = { ...task('a', '90x40', 1), current_qty: 1 }
    expect(buildOperatorCutPlan([done], 140)).toBeNull()
  })
})
