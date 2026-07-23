import { describe, expect, it } from 'vitest'
import {
  parseShopifyOrderNumberFromTitle,
  shopifyOrderAdminUrl,
  taskHasOrderNumber,
} from './shopifyOrderUrl'

describe('parseShopifyOrderNumberFromTitle', () => {
  it('acepta solo el número', () => {
    expect(parseShopifyOrderNumberFromTitle('15000')).toBe('15000')
    expect(parseShopifyOrderNumberFromTitle('#15704')).toBe('15704')
  })

  it('acepta número + frase', () => {
    expect(parseShopifyOrderNumberFromTitle('15000 Juan')).toBe('15000')
    expect(parseShopifyOrderNumberFromTitle('15704 rehacer borde')).toBe('15704')
    expect(parseShopifyOrderNumberFromTitle('#16001 - devolucion')).toBe('16001')
    expect(parseShopifyOrderNumberFromTitle('15555: nota')).toBe('15555')
  })

  it('rechaza títulos sin orden de 5 cifras al inicio', () => {
    expect(parseShopifyOrderNumberFromTitle('')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('Juan 15000')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('1500')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('150000')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('abc')).toBeNull()
  })
})

describe('taskHasOrderNumber', () => {
  it('detecta orden en cualquier tipo de tarea', () => {
    expect(taskHasOrderNumber({ task_type: 'rehacer', title: '15000 Juan' })).toBe(true)
    expect(taskHasOrderNumber({ task_type: 'otra', title: '15704' })).toBe(true)
    expect(taskHasOrderNumber({ task_type: 'rehacer', title: 'sin orden' })).toBe(false)
  })
})

describe('shopifyOrderAdminUrl', () => {
  it('usa solo el número en el query (no la frase)', () => {
    const prevHandle = import.meta.env.VITE_SHOPIFY_STORE_HANDLE
    import.meta.env.VITE_SHOPIFY_STORE_HANDLE = 'notmid'
    try {
      expect(shopifyOrderAdminUrl('15704 Juan')).toBe(
        'https://admin.shopify.com/store/notmid/orders?query=15704',
      )
      expect(shopifyOrderAdminUrl('sin numero')).toBeNull()
    } finally {
      import.meta.env.VITE_SHOPIFY_STORE_HANDLE = prevHandle
    }
  })
})
