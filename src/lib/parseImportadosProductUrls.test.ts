import { describe, expect, it } from 'vitest'
import { parseImportadosProductUrls } from './trackedProductsApi'

describe('parseImportadosProductUrls', () => {
  it('split URLs by newline', () => {
    const raw = [
      'https://mechanicalkeyboards.com/products/keychron-v1-max',
      'https://lethal.gg/products/foo-bar',
    ].join('\n')
    expect(parseImportadosProductUrls(raw)).toEqual([
      'https://mechanicalkeyboards.com/products/keychron-v1-max',
      'https://lethal.gg/products/foo-bar',
    ])
  })

  it('split URLs on the same line separated by space', () => {
    const raw =
      'https://mechanicalkeyboards.com/products/a https://mechanicalkeyboards.com/products/b'
    expect(parseImportadosProductUrls(raw)).toEqual([
      'https://mechanicalkeyboards.com/products/a',
      'https://mechanicalkeyboards.com/products/b',
    ])
  })

  it('dedupes repeated URLs', () => {
    const raw = [
      'https://mechanicalkeyboards.com/products/a',
      'https://mechanicalkeyboards.com/products/a',
    ].join('\n')
    expect(parseImportadosProductUrls(raw)).toEqual([
      'https://mechanicalkeyboards.com/products/a',
    ])
  })

  it('ignores non-importados hosts', () => {
    const raw = [
      'https://google.com/foo',
      'https://mechanicalkeyboards.com/products/a',
    ].join('\n')
    expect(parseImportadosProductUrls(raw)).toEqual([
      'https://mechanicalkeyboards.com/products/a',
    ])
  })
})
