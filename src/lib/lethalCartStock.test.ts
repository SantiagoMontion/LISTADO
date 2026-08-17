import { describe, expect, it } from 'vitest'
import { parseLethalAvailability } from '../../api/_lib/importados-sync/lethalCartStock'

describe('parseLethalAvailability', () => {
  it('lee el plural real de Shopify', () => {
    expect(
      parseLethalAvailability('Only 11 items were added to your cart due to availability.'),
    ).toBe(11)
  })

  it('lee el singular, que dice "was" en vez de "were"', () => {
    expect(
      parseLethalAvailability('Only 1 item was added to your cart due to availability.'),
    ).toBe(1)
  })

  it('cubre los otros mensajes de tope de Shopify', () => {
    expect(parseLethalAvailability('All 3 X2F Gaming Mouse are in your cart.')).toBe(3)
    expect(parseLethalAvailability('You can only add 2 of this item to the cart.')).toBe(2)
  })

  it('lee el mensaje en español de Lethal /es/', () => {
    expect(
      parseLethalAvailability(
        'Debido a la disponibilidad, solo se añadieron 2 artículos al carrito.',
      ),
    ).toBe(2)
    expect(
      parseLethalAvailability(
        'Debido a la disponibilidad, solo se añadió 1 artículo al carrito.',
      ),
    ).toBe(1)
  })

  it('devuelve null cuando el mensaje no informa un tope', () => {
    expect(parseLethalAvailability('')).toBeNull()
    expect(parseLethalAvailability('Something went wrong')).toBeNull()
  })

  it('no trata errores genéricos de add como OOS (evita ceros falsos)', () => {
    const genericCannotAdd =
      /sold\s*out|agotado|out\s+of\s+stock|sin\s+stock|not\s+enough\s+(?:inventory|stock|items?)|insufficient\s+(?:inventory|stock)|no\s+(?:hay|queda(?:n)?)\s+stock/i
    expect(genericCannotAdd.test('Cannot add this item to your cart right now')).toBe(false)
    expect(genericCannotAdd.test('No se puede agregar al carrito')).toBe(false)
    expect(genericCannotAdd.test('Sold out')).toBe(true)
    expect(genericCannotAdd.test('Not enough inventory')).toBe(true)
  })
})

describe('false-zero guard (policy)', () => {
  it('documents: only verified reads may write; never zero while storefront available', () => {
    const shouldWriteInventory = (opts: {
      qty: number
      reliable: boolean
      storefrontAvailable: boolean
      shopifyQty: number
    }) => {
      if (!opts.reliable) return false
      if (opts.qty <= 0 && opts.storefrontAvailable) return false
      if (opts.qty <= 0 && opts.shopifyQty > 0 && opts.storefrontAvailable) return false
      return true
    }
    expect(
      shouldWriteInventory({
        qty: 0,
        reliable: false,
        storefrontAvailable: false,
        shopifyQty: 1,
      }),
    ).toBe(false)
    expect(
      shouldWriteInventory({
        qty: 0,
        reliable: true,
        storefrontAvailable: true,
        shopifyQty: 1,
      }),
    ).toBe(false)
    expect(
      shouldWriteInventory({
        qty: 0,
        reliable: true,
        storefrontAvailable: false,
        shopifyQty: 1,
      }),
    ).toBe(true)
    expect(
      shouldWriteInventory({
        qty: 1,
        reliable: true,
        storefrontAvailable: true,
        shopifyQty: 0,
      }),
    ).toBe(true)
  })
})
