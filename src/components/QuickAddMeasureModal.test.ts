import { describe, expect, it } from 'vitest'
import {
  mapQuickAddOption,
  parseQuickDimensions,
  sanitizeQuickDimensionInput,
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
  })
})
