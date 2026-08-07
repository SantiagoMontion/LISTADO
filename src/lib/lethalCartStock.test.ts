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

  it('devuelve null cuando el mensaje no informa un tope', () => {
    expect(parseLethalAvailability('')).toBeNull()
    expect(parseLethalAvailability('Something went wrong')).toBeNull()
  })
})
