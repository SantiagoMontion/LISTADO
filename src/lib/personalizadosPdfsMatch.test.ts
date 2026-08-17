import { describe, expect, it } from 'vitest'
import {
  designHasExtraVersionToken,
  extractLineMatchHints,
  isPersonalizadosLine,
  normalizeShopifyLineTitle,
  parseMeasurementCm,
  pickBestPrintMatch,
  pickUniqueDesignNameMatch,
} from '../../api/_lib/personalizados-pdfs/pendingPdfs'
import { copyablePersonalizadosTitle } from './personalizadosPdfsApi'

describe('isPersonalizadosLine', () => {
  it('detecta | Custom en el título', () => {
    expect(
      isPersonalizadosLine({ title: 'Mousepad SuperNegro 50x40 PRO | Custom' }),
    ).toBe(true)
  })

  it('detecta _app_source=custom', () => {
    expect(
      isPersonalizadosLine({
        title: 'Diseño X',
        properties: [{ name: '_app_source', value: 'custom' }],
      }),
    ).toBe(true)
  })

  it('no marca catálogo NotMid normal', () => {
    expect(isPersonalizadosLine({ title: 'Cable USB-C Pro' })).toBe(false)
  })
})

describe('extractLineMatchHints', () => {
  it('lee material y measurement_cm del código de la orden', () => {
    expect(
      extractLineMatchHints({
        title: 'Mousepad 9z Nan 90x32 PRO | Custom',
        properties: [
          { name: '_app_source', value: 'custom' },
          { name: 'material', value: 'PRO' },
          { name: 'measurement_cm', value: '90x32 cm' },
          { name: 'rid', value: 'mgad016g09wk' },
        ],
      }),
    ).toEqual({ material: 'PRO', measurement: '90x32' })
  })

  it('parseMeasurementCm tolera formatos varios', () => {
    expect(parseMeasurementCm('90x32 cm')).toBe('90x32')
    expect(parseMeasurementCm('90 × 32')).toBe('90x32')
    expect(parseMeasurementCm('')).toBeNull()
  })
})

describe('pickBestPrintMatch / anti-v2', () => {
  it('elige el print sin v2 cuando la orden no pide v2 (caso #16435)', () => {
    const rows = [
      {
        id: 'new',
        design_name: 'Mousepad 9z Nan 90x32 PRO | nan-v2',
        created_at: '2026-08-11T12:00:00Z',
      },
      {
        id: 'old',
        design_name: 'Mousepad 9z Nan 90x32 PRO | nan-ok',
        created_at: '2026-08-01T12:00:00Z',
      },
    ]
    // Más nuevo primero (como viene de Supabase), pero debe ganar el sin v2.
    expect(
      pickBestPrintMatch(rows, 'Mousepad 9z Nan 90x32 PRO | Custom', {
        material: 'PRO',
        measurement: '90x32',
      }),
    ).toEqual({ status: 'unique', row: rows[1] })
  })

  it('elige el título exacto y descarta “Title v2 | …”', () => {
    const rows = [
      { id: 'v2', design_name: 'Mousepad 9z Nan 90x32 PRO v2 | newer' },
      { id: 'ok', design_name: 'Mousepad 9z Nan 90x32 PRO | correct' },
    ]
    expect(pickBestPrintMatch(rows, 'Mousepad 9z Nan 90x32 PRO | Custom')).toEqual({
      status: 'unique',
      row: rows[1],
    })
  })

  it('marca ambiguous si quedan varios sin versión extra', () => {
    const rows = [
      { id: '1', design_name: 'Minecraft 90x40 | design-a' },
      { id: '2', design_name: 'Minecraft 90x40 | design-b' },
    ]
    expect(pickBestPrintMatch(rows, 'Minecraft 90x40 | Custom')).toEqual({
      status: 'ambiguous',
      count: 2,
    })
  })

  it('usa material/medida del código para desambiguar', () => {
    const rows = [
      { id: 'classic', design_name: 'Mousepad Foo 90x32 Classic | a' },
      { id: 'pro', design_name: 'Mousepad Foo 90x32 PRO | b' },
    ]
    expect(
      pickBestPrintMatch(rows, 'Mousepad Foo 90x32 PRO | Custom', {
        material: 'PRO',
        measurement: '90x32',
      }),
    ).toEqual({ status: 'unique', row: rows[1] })
  })

  it('designHasExtraVersionToken detecta v2 no pedido', () => {
    expect(designHasExtraVersionToken('Foo | bar v2', 'Foo')).toBe(true)
    expect(designHasExtraVersionToken('Foo v2 | bar', 'Foo')).toBe(true)
    expect(designHasExtraVersionToken('Foo | bar', 'Foo')).toBe(false)
    expect(designHasExtraVersionToken('Foo v2 | bar', 'Foo v2')).toBe(false)
  })
})

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
