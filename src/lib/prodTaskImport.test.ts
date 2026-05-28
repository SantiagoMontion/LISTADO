import { describe, expect, it } from 'vitest'
import { collapseImportTasks, planImportUpsert } from './prodTaskImport'

describe('planImportUpsert', () => {
  it('inserta línea nueva en cero', () => {
    expect(planImportUpsert(null, 15)).toEqual({ total_qty: 15, current_qty: 0 })
  })

  it('no reabre medida ya cortada si se reimporta la misma cantidad', () => {
    expect(planImportUpsert({ total_qty: 15, current_qty: 15 }, 15)).toEqual({
      total_qty: 15,
      current_qty: 15,
    })
  })

  it('deja pendiente solo el delta si la lista crece', () => {
    expect(planImportUpsert({ total_qty: 15, current_qty: 15 }, 20)).toEqual({
      total_qty: 20,
      current_qty: 15,
    })
  })

  it('no suma cantidades al reimportar (evita duplicar lista)', () => {
    expect(planImportUpsert({ total_qty: 15, current_qty: 10 }, 15)).toEqual({
      total_qty: 15,
      current_qty: 10,
    })
  })
})

describe('collapseImportTasks', () => {
  it('suma cantidades duplicadas en el mismo pegado', () => {
    const rows = collapseImportTasks([
      { material_type: 'classic', dimensions: '90x40', total_qty: 5 },
      { material_type: 'classic', dimensions: '90x40', total_qty: 10 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].total_qty).toBe(15)
  })
})
