import { describe, expect, it } from 'vitest'
import { guillotineStripPack } from './guillotineStripPack'
import { sortTasksByStripPack } from './sortTasksByStripPack'
import type { NmProdTask } from './types'

describe('guillotineStripPack', () => {
  it('agrupa piezas del mismo alto en tiras y minimiza altura total', () => {
    const pedido = [
      { ancho: 60, alto: 30, cant: 1 },
      { ancho: 61, alto: 30, cant: 1 },
      { ancho: 40, alto: 60, cant: 2 },
      { ancho: 35, alto: 90, cant: 1 },
    ]

    const result = guillotineStripPack(pedido, 140)

    expect(result.stripCount).toBe(2)
    expect(result.unplacedPieceIndices).toEqual([])

    const totalHeight = result.strips.reduce((sum, s) => sum + s.stripHeight, 0)
    expect(totalHeight).toBe(120)

    const strip90 = result.strips.find((s) => s.stripHeight === 90)
    expect(strip90?.pieces).toHaveLength(3)
    expect(strip90?.usedWidth).toBe(115)

    const strip30 = result.strips.find((s) => s.stripHeight === 30)
    expect(strip30?.pieces).toHaveLength(2)
    expect(strip30?.usedWidth).toBe(121)
    expect(strip30?.pieces.every((p) => !p.rotated)).toBe(true)
  })

  it('prefiere orientación original cuando cabe en el rollo', () => {
    const result = guillotineStripPack([{ ancho: 100, alto: 40, cant: 1 }], 128)
    expect(result.stripCount).toBe(1)
    expect(result.strips[0].pieces[0].rotated).toBe(false)
  })

  it('rota piezas cuando la orientación original no cabe en el ancho', () => {
    const result = guillotineStripPack([{ ancho: 150, alto: 40, cant: 1 }], 140)
    expect(result.stripCount).toBe(1)
    expect(result.strips[0].pieces[0].rotated).toBe(true)
  })

  it('marca piezas imposibles cuando exceden el ancho del rollo', () => {
    const result = guillotineStripPack([{ ancho: 150, alto: 150, cant: 1 }], 140)
    expect(result.stripCount).toBe(0)
    expect(result.unplacedPieceIndices).toEqual([0])
  })
})

describe('sortTasksByStripPack', () => {
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

  it('ordena tareas según el plan de tiras', () => {
    const tasks = [
      task('a', '60x30', 1),
      task('b', '61x30', 1),
      task('c', '40x60', 2),
      task('d', '35x90', 1),
    ]

    const ordered = sortTasksByStripPack(tasks, 140)
    const ids = ordered.map((t) => t.id)

    expect(ids.indexOf('d')).toBeLessThan(ids.indexOf('a'))
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('a'))
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'))
  })
})
