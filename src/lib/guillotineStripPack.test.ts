import { describe, expect, it } from 'vitest'
import { guillotineStripPack } from './guillotineStripPack'

function wasteArea(result: ReturnType<typeof guillotineStripPack>): number {
  return result.totalWasteAreaCm2
}

describe('guillotineStripPack', () => {
  it('90×40 ×3: plancha de 90 cm con 3 piezas (menos desperdicio que 3×40 cm)', () => {
    const result = guillotineStripPack([{ ancho: 90, alto: 40, cant: 3 }], 140)

    expect(result.stripCount).toBe(1)
    expect(result.strips[0].stripHeight).toBe(90)
    expect(result.strips[0].pieces).toHaveLength(3)
    expect(result.strips[0].pieces.every((p) => p.rotated)).toBe(true)
    expect(result.strips[0].usedWidth).toBe(120)
    expect(result.strips[0].wasteWidth).toBe(20)
  })

  it('127×45 ×2: planchas de 45 cm (menos desperdicio que rotar a 127 cm)', () => {
    const result = guillotineStripPack([{ ancho: 127, alto: 45, cant: 2 }], 140)

    expect(result.stripCount).toBe(2)
    expect(result.strips.every((s) => s.stripHeight === 45)).toBe(true)
    expect(result.strips.every((s) => s.pieces.length === 1)).toBe(true)
    expect(result.strips.every((s) => !s.pieces[0].rotated)).toBe(true)
  })

  it('70×30 ×4: 2 planchas de 30 cm con 2 piezas cada una (0 cm² de merma)', () => {
    const result = guillotineStripPack([{ ancho: 70, alto: 30, cant: 4 }], 140)

    expect(result.stripCount).toBe(2)
    expect(result.strips.every((s) => s.stripHeight === 30)).toBe(true)
    expect(result.strips.every((s) => s.pieces.length === 2)).toBe(true)
    expect(result.totalWasteAreaCm2).toBe(0)
  })

  it('90×40 ×4: 4 planchas de 40 cm (menos merma que apilar 3+1 rotadas)', () => {
    const normal = guillotineStripPack([{ ancho: 90, alto: 40, cant: 4 }], 140)
    const rotatedOnly = guillotineStripPack([{ ancho: 90, alto: 40, cant: 3 }], 140)

    expect(normal.stripCount).toBe(4)
    expect(normal.strips.every((s) => s.stripHeight === 40)).toBe(true)
    expect(normal.totalWasteAreaCm2).toBeLessThan(
      rotatedOnly.totalWasteAreaCm2 + 90 * 100,
    )
  })

  it('prefiere menos material total entre orientaciones posibles', () => {
    const rotated = guillotineStripPack([{ ancho: 90, alto: 40, cant: 3 }], 140)
    const naive = guillotineStripPack([{ ancho: 90, alto: 40, cant: 1 }], 140)
    expect(wasteArea(rotated)).toBeLessThan(wasteArea(naive) * 3)
  })

  it('82×32 ×4 en una plancha de 82 cm', () => {
    const result = guillotineStripPack([{ ancho: 82, alto: 32, cant: 4 }], 140)
    expect(result.stripCount).toBe(1)
    expect(result.strips[0].stripHeight).toBe(82)
    expect(result.strips[0].pieces).toHaveLength(4)
  })

  it('marca piezas imposibles cuando exceden el ancho del rollo', () => {
    const result = guillotineStripPack([{ ancho: 150, alto: 150, cant: 1 }], 140)
    expect(result.stripCount).toBe(0)
    expect(result.unplacedPieceIndices).toEqual([0])
  })

  it('expone largo total de rollo', () => {
    const result = guillotineStripPack([{ ancho: 80, alto: 30, cant: 2 }], 140)
    expect(result.totalRollLengthCm).toBeGreaterThan(0)
    expect(result.totalRollLengthCm).toBe(
      result.strips.reduce((s, t) => s + t.stripHeight, 0),
    )
  })
})
