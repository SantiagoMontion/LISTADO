import { describe, expect, it } from 'vitest'
import {
  buildVariantAxes,
  type CreateNotmidVariantInput,
} from '../../api/_lib/importados-sync/shopify'

function variant(
  option1: string,
  option2?: string | null,
  option3?: string | null,
): CreateNotmidVariantInput {
  return {
    option1,
    option2,
    option3,
    sku: null,
    price: 100,
    inventoryQuantity: 1,
    supplierVariantId: `${option1}-${option2 ?? ''}-${option3 ?? ''}`,
  }
}

describe('buildVariantAxes', () => {
  it('deja intacto el caso simple de un solo eje', () => {
    const { optionNames, rows } = buildVariantAxes(
      [variant('Black'), variant('White')],
      [{ name: 'Color' }],
    )
    expect(optionNames).toEqual(['Color'])
    expect(rows.map((r) => r.label)).toEqual(['Black', 'White'])
  })

  it('usa el segundo eje del proveedor en vez de chocar por color repetido', () => {
    const { optionNames, rows } = buildVariantAxes(
      [variant('Black', 'Size 1'), variant('Black', 'Size 2'), variant('Red', 'Size 1')],
      [{ name: 'Color' }, { name: 'Size' }],
    )
    expect(optionNames).toEqual(['Color', 'Size'])
    expect(rows.map((r) => r.label)).toEqual(['Black / Size 1', 'Black / Size 2', 'Red / Size 1'])
    expect(new Set(rows.map((r) => r.label)).size).toBe(3)
  })

  it('desempata sin perder variantes cuando el choque es real', () => {
    const { optionNames, rows } = buildVariantAxes(
      [variant('Black'), variant('Black'), variant('Black')],
      [{ name: 'Color' }],
    )
    expect(optionNames).toEqual(['Color'])
    expect(rows.map((r) => r.label)).toEqual(['Black', 'Black 2', 'Black 3'])
    expect(rows).toHaveLength(3)
  })

  it('ignora el segundo eje si solo algunas variantes lo tienen', () => {
    const { optionNames, rows } = buildVariantAxes(
      [variant('Black', 'Size 1'), variant('White')],
      [{ name: 'Color' }, { name: 'Size' }],
    )
    expect(optionNames).toEqual(['Color'])
    expect(rows.map((r) => r.label)).toEqual(['Black', 'White'])
  })

  it('conserva el vínculo con la variante original del proveedor', () => {
    const { rows } = buildVariantAxes([variant('Black'), variant('Black')], [{ name: 'Color' }])
    expect(rows[1].label).toBe('Black 2')
    expect(rows[1].source.supplierVariantId).toBe('Black--')
  })
})
