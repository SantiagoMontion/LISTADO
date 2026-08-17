import { describe, expect, it } from 'vitest'
import {
  inStockFromQty,
  nextShopifyCatalogWrite,
} from '../../api/_lib/importados-sync/shopifyProductStatus'

describe('nextShopifyCatalogWrite', () => {
  it('leaves Draft/Archived alone even with stock', () => {
    expect(nextShopifyCatalogWrite(true, 'draft')).toBeNull()
    expect(nextShopifyCatalogWrite(false, 'draft')).toBeNull()
    expect(nextShopifyCatalogWrite(true, 'archived')).toBeNull()
    expect(nextShopifyCatalogWrite(true, null)).toBeNull()
  })

  it('does not auto-publish Active that already has stock', () => {
    expect(nextShopifyCatalogWrite(true, 'active')).toBeNull()
  })

  it('never returns active', () => {
    const currents = ['draft', 'archived', 'active', null] as const
    for (const current of currents) {
      expect(nextShopifyCatalogWrite(true, current)).not.toBe('active')
      expect(nextShopifyCatalogWrite(false, current)).not.toBe('active')
    }
  })
})

describe('inStockFromQty', () => {
  it('treats 1 unit as in stock', () => {
    expect(inStockFromQty(1, true)).toBe(true)
    expect(inStockFromQty(0, true)).toBe(true)
    expect(inStockFromQty(1, null)).toBe(true)
  })

  it('does not treat OOS as in stock', () => {
    expect(inStockFromQty(0, false)).toBe(false)
    expect(inStockFromQty(null, false)).toBe(false)
    expect(inStockFromQty(1, false)).toBe(false)
  })
})
