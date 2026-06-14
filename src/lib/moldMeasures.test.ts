import { describe, expect, it } from 'vitest'
import { computeRollLengthCmFromTasks, formatRollMeters } from './buildOperatorCutPlan'
import {
  firstPendingMoldSource,
  isMoldMeasure,
  lastCutMoldSource,
  mergeMoldTasksByMeasure,
  splitMoldAndPlanTasks,
} from './moldMeasures'
import type { NmProdTask } from './types'

function task(id: string, dimensions: string, totalQty: number, currentQty = 0): NmProdTask {
  return {
    id,
    report_id: `r-${id}`,
    material_type: 'classic',
    dimensions,
    total_qty: totalQty,
    current_qty: currentQty,
    is_priority: false,
    from_faltas: false,
    notes: null,
    is_completed: false,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('moldMeasures', () => {
  it('separa 90×40 y 82×32 del plan', () => {
    const tasks = [
      { dimensions: '90x40' },
      { dimensions: '82x32' },
      { dimensions: '127x45' },
    ]
    const { moldTasks, planTasks } = splitMoldAndPlanTasks(tasks)
    expect(moldTasks.map((t) => t.dimensions)).toEqual(['90x40', '82x32'])
    expect(planTasks.map((t) => t.dimensions)).toEqual(['127x45'])
    expect(isMoldMeasure('90X40')).toBe(true)
  })

  it('une medidas de molde iguales al sumar listas', () => {
    const merged = mergeMoldTasksByMeasure([
      task('a', '90x40', 2),
      task('b', '90x40', 3),
      task('c', '82x32', 4),
    ])

    expect(merged).toHaveLength(2)
    const ninety = merged.find((g) => g.measureKey === '90x40')!
    const eightyTwo = merged.find((g) => g.measureKey === '82x32')!
    expect(ninety.sources).toHaveLength(2)
    expect(ninety.displayTask.total_qty).toBe(5)
    expect(ninety.displayTask.current_qty).toBe(0)
    expect(eightyTwo.displayTask.total_qty).toBe(4)
  })

  it('encuentra fuente para +/− en grupo unido', () => {
    const sources = [
      task('a', '90x40', 2, 2),
      task('b', '90x40', 3, 1),
    ]
    expect(firstPendingMoldSource(sources)?.id).toBe('b')
    expect(lastCutMoldSource(sources)?.id).toBe('b')
  })
})

describe('computeRollLengthCmFromTasks', () => {
  it('90×40 ×3 → 90 cm de rollo (Classic)', () => {
    const cm = computeRollLengthCmFromTasks([task('a', '90x40', 3)], 140)
    expect(cm).toBe(90)
  })

  it('82×32 ×4 → 82 cm de rollo (Classic)', () => {
    const cm = computeRollLengthCmFromTasks([task('a', '82x32', 4)], 140)
    expect(cm).toBe(82)
  })

  it('suma molde + medidas personalizadas', () => {
    const moldCm = computeRollLengthCmFromTasks([task('a', '90x40', 3)], 140)
    const planCm = computeRollLengthCmFromTasks([task('b', '127x45', 2)], 140)
    expect(moldCm + planCm).toBe(90 + 90)
  })

  it('formatRollMeters', () => {
    expect(formatRollMeters(90)).toBe('0.90 m')
    expect(formatRollMeters(1500)).toBe('15.0 m')
  })
})
