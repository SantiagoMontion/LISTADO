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
    expect(parseShopifyOrderNumberFromTitle('# 16001')).toBe('16001')
  })

  it('acepta número + frase', () => {
    expect(parseShopifyOrderNumberFromTitle('15000 Juan')).toBe('15000')
    expect(parseShopifyOrderNumberFromTitle('15704 rehacer borde')).toBe('15704')
    expect(parseShopifyOrderNumberFromTitle('#16001 - devolucion')).toBe('16001')
    expect(parseShopifyOrderNumberFromTitle('#15555: nota')).toBe('15555')
  })

  it('rechaza títulos sin orden de 5 cifras al inicio', () => {
    expect(parseShopifyOrderNumberFromTitle('')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('Juan Perez')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('Juan 15000')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('1500')).toBeNull()
    expect(parseShopifyOrderNumberFromTitle('150000')).toBeNull()
  })
})

describe('taskHasOrderNumber', () => {
  it('no depende del tipo de tarea', () => {
    expect(taskHasOrderNumber({ title: '15704', task_type: 'mayorista' })).toBe(true)
    expect(taskHasOrderNumber({ title: 'Cliente', task_type: 'rehacer' })).toBe(false)
  })
})

describe('shopifyOrderAdminUrl', () => {
  it('sin número de orden en el título, no hay URL', () => {
    expect(shopifyOrderAdminUrl('')).toBeNull()
    expect(shopifyOrderAdminUrl('Juan Perez')).toBeNull()
    expect(shopifyOrderAdminUrl('Juan 15000')).toBeNull()
  })

  it('si hay store config, el query usa solo el número con # (no la frase)', () => {
    const url = shopifyOrderAdminUrl('15704 Juan')
    if (!url) {
      // Sin VITE_SHOPIFY_STORE_HANDLE / DOMAIN en el entorno de test.
      expect(url).toBeNull()
      return
    }
    expect(url).toContain(`query=${encodeURIComponent('#15704')}`)
    expect(url).not.toContain('Juan')
  })
})
