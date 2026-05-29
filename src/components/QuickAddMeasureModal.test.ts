import { describe, expect, it } from 'vitest'
import {
  mapQuickAddOption,
  parseQuickDimensions,
  parseQuickQuantity,
  sanitizeQuickDimensionInput,
  sanitizeQuickQuantityInput,
} from './QuickAddMeasureModal'

describe('QuickAddMeasureModal helpers', () => {
  it('sanitizeQuickDimensionInput keeps digits and single x', () => {
    expect(sanitizeQuickDimensionInput('90x40 Classic')).toBe('90x40')
    expect(sanitizeQuickDimensionInput('50×44')).toBe('50x44')
    expect(sanitizeQuickDimensionInput('12xx34')).toBe('12x34')
  })

  it('parseQuickDimensions accepts valid measure', () => {
    expect(parseQuickDimensions('90x40')).toBe('90x40')
    expect(parseQuickDimensions('50x44')).toBe('50x44')
    expect(parseQuickDimensions('90x')).toBe(null)
    expect(parseQuickDimensions('classic')).toBe(null)
  })

  it('parseQuickQuantity accepts positive integers', () => {
    expect(parseQuickQuantity('5')).toBe(5)
    expect(parseQuickQuantity('0')).toBe(null)
    expect(parseQuickQuantity('')).toBe(null)
  })

  it('sanitizeQuickQuantityInput keeps digits only', () => {
    expect(sanitizeQuickQuantityInput('5u')).toBe('5')
    expect(sanitizeQuickQuantityInput('12345')).toBe('1234')
  })

  it('mapQuickAddOption maps Falta to faltas row', () => {
    expect(mapQuickAddOption('Falta')).toEqual({
      materialType: 'classic',
      from_faltas: true,
      is_priority: true,
    })
    expect(mapQuickAddOption('Rectos')).toEqual({
      materialType: 'bordes_rectos',
      from_faltas: false,
      is_priority: false,
    })
    expect(mapQuickAddOption('Mayorista')).toEqual({
      materialType: 'mayorista',
      from_faltas: false,
      is_priority: false,
    })
  })

  it('mayorista dimensions include Classic/PRO suffix via formatMayoristaDimensions', async () => {
    const { formatMayoristaDimensions, mayoristaLineMaterialFromOption } = await import(
      '../lib/nmProdMayorista'
    )
    expect(
      formatMayoristaDimensions('44x22', mayoristaLineMaterialFromOption('Classic')),
    ).toBe('44x22 - CLASSIC')
    expect(formatMayoristaDimensions('44x22', mayoristaLineMaterialFromOption('PRO'))).toBe(
      '44x22 - PRO',
    )
  })
})
