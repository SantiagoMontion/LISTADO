import { describe, expect, it } from 'vitest'
import {
  formatMayoristaDimensions,
  mayoristaLineMaterialFromOption,
  parseMayoristaDimensions,
} from './nmProdMayorista'

describe('nmProdMayorista', () => {
  it('formatMayoristaDimensions embeds line material like rectos', () => {
    expect(formatMayoristaDimensions('44x22', 'CLASSIC')).toBe('44x22 - CLASSIC')
    expect(formatMayoristaDimensions('44x22', 'PRO')).toBe('44x22 - PRO')
  })

  it('mayoristaLineMaterialFromOption maps UI labels', () => {
    expect(mayoristaLineMaterialFromOption('Classic')).toBe('CLASSIC')
    expect(mayoristaLineMaterialFromOption('PRO')).toBe('PRO')
  })

  it('parseMayoristaDimensions round-trips', () => {
    expect(parseMayoristaDimensions('44x22 - CLASSIC')).toEqual({
      measure: '44x22',
      lineMaterial: 'CLASSIC',
    })
    expect(parseMayoristaDimensions('44x22')).toBe(null)
  })
})
