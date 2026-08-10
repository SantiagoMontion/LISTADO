import { describe, expect, it } from 'vitest'
import {
  normalizeShopifyLineTitle,
  pickUniqueDesignNameMatch,
} from '../../api/_lib/personalizados-pdfs/pendingPdfs'
import { copyablePersonalizadosTitle } from './personalizadosPdfsApi'

describe('pickUniqueDesignNameMatch', () => {
  it('acepta un único match por título de producto', () => {
    const rows = [
      { id: '1', design_name: 'Minecraft 90x40 | steve-xyz' },
      { id: '2', design_name: 'Otro 90x40 | foo' },
    ]
    expect(pickUniqueDesignNameMatch(rows, 'Minecraft 90x40')).toEqual({
      status: 'unique',
      row: rows[0],
    })
  })

  it('marca ambiguous si hay varios con el mismo título base', () => {
    const rows = [
      { id: '1', design_name: 'Minecraft 90x40 | design-a' },
      { id: '2', design_name: 'Minecraft 90x40 | design-b' },
      { id: '3', design_name: 'Minecraft 90x40 | design-c' },
    ]
    expect(pickUniqueDesignNameMatch(rows, 'Minecraft 90x40 | Custom')).toEqual({
      status: 'ambiguous',
      count: 3,
    })
  })

  it('normaliza el sufijo | Custom del título de Shopify', () => {
    expect(normalizeShopifyLineTitle('Minecraft 90x40 | Custom')).toBe('Minecraft 90x40')
  })
})

describe('copyablePersonalizadosTitle', () => {
  it('saca Mousepad y | Custom', () => {
    expect(copyablePersonalizadosTitle('Mousepad SuperNegro 50x40 PRO | Custom')).toBe(
      'SuperNegro 50x40 PRO',
    )
  })

  it('saca Glasspad y | Custom', () => {
    expect(copyablePersonalizadosTitle('Glasspad Neon 90x40 | Custom')).toBe('Neon 90x40')
  })

  it('si no hay prefijo, igual limpia Custom', () => {
    expect(copyablePersonalizadosTitle('Choso 100x50 Classic | Custom')).toBe(
      'Choso 100x50 Classic',
    )
  })
})
