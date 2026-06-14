import { describe, expect, it } from 'vitest'
import { guillotineStripPack, type StripPackInputLine } from './guillotineStripPack'

/**
 * Benchmark con medidas reales de taller.
 * Cada línea del pedido es: { ancho, alto, cant } → ej. 70×30 cm, cantidad 5.
 *
 * El resultado se lee así para el operario:
 *   "Tira 1 — corte horizontal a 40 cm de alto"
 *   "   en esa franja van, de izquierda a derecha: 90×40, 50×40"
 */

const CLASSIC = 140
const PRO = 128

function piezas(pedido: StripPackInputLine[]): number {
  return pedido.reduce((s, l) => s + l.cant, 0)
}

function imprimir(name: string, pedido: StripPackInputLine[], rollWidth: number): void {
  const result = guillotineStripPack(pedido, rollWidth)
  const total = piezas(pedido)
  const colocadas = result.strips.reduce((s, t) => s + t.pieces.length, 0)
  const altura = result.strips.reduce((s, t) => s + t.stripHeight, 0)

  console.log('\n' + '─'.repeat(60))
  console.log(name)
  console.log(`Material: rollo ${rollWidth} cm de ancho`)
  console.log('Pedido del día:')
  for (const l of pedido) {
    console.log(`  · ${l.ancho}×${l.alto} cm  ×${l.cant}`)
  }
  console.log(`Total piezas: ${total} | Colocadas: ${colocadas} | Sin colocar: ${result.unplacedPieceIndices.length}`)
  console.log(`Cortes horizontales (tiras): ${result.stripCount} | Largo total de rollo usado: ${altura} cm`)
  console.log('')

  result.strips.forEach((tira, i) => {
    const medidas = tira.pieces.map((p) => {
      const label = `${p.ancho}×${p.alto}`
      return p.rotated ? `${label} (rotada)` : label
    })
    console.log(`  Tira ${i + 1} — corte a ${tira.stripHeight} cm de alto`)
    console.log(`           piezas: ${medidas.join('  |  ')}`)
    console.log(`           ancho ocupado: ${tira.usedWidth} cm  (sobra ${tira.wasteWidth} cm a un costado)`)
  })

  if (result.unplacedPieceIndices.length > 0) {
    console.log('  ⚠ Medidas que NO entraron en el rollo (revisar manualmente)')
  }
}

const CASOS: Array<{
  nombre: string
  rollo: number
  pedido: StripPackInputLine[]
}> = [
  {
    nombre: 'Classic — medidas chicas y medianas mezcladas',
    rollo: CLASSIC,
    pedido: [
      { ancho: 70, alto: 30, cant: 4 },
      { ancho: 64, alto: 24, cant: 3 },
      { ancho: 60, alto: 65, cant: 2 },
      { ancho: 25, alto: 25, cant: 6 },
    ],
  },
  {
    nombre: 'Classic — muchas del mismo tipo (70×30)',
    rollo: CLASSIC,
    pedido: [{ ancho: 70, alto: 30, cant: 10 }],
  },
  {
    nombre: 'Classic — pieza grande + varias chicas',
    rollo: CLASSIC,
    pedido: [
      { ancho: 120, alto: 80, cant: 1 },
      { ancho: 70, alto: 30, cant: 4 },
      { ancho: 50, alto: 40, cant: 2 },
    ],
  },
  {
    nombre: 'Classic — listado típico de producción',
    rollo: CLASSIC,
    pedido: [
      { ancho: 90, alto: 40, cant: 8 },
      { ancho: 82, alto: 32, cant: 4 },
      { ancho: 50, alto: 40, cant: 3 },
      { ancho: 77, alto: 44, cant: 2 },
    ],
  },
  {
    nombre: 'Classic — pieza muy grande (tope del rollo)',
    rollo: CLASSIC,
    pedido: [
      { ancho: 140, alto: 100, cant: 1 },
      { ancho: 70, alto: 50, cant: 2 },
    ],
  },
  {
    nombre: 'Classic — medida imposible (no cabe en 140 cm)',
    rollo: CLASSIC,
    pedido: [
      { ancho: 145, alto: 90, cant: 1 },
      { ancho: 70, alto: 30, cant: 2 },
    ],
  },
  {
    nombre: 'PRO — medidas chicas y medianas',
    rollo: PRO,
    pedido: [
      { ancho: 70, alto: 30, cant: 4 },
      { ancho: 64, alto: 24, cant: 4 },
      { ancho: 60, alto: 65, cant: 1 },
      { ancho: 25, alto: 25, cant: 4 },
    ],
  },
  {
    nombre: 'PRO — listado típico',
    rollo: PRO,
    pedido: [
      { ancho: 90, alto: 40, cant: 6 },
      { ancho: 82, alto: 32, cant: 3 },
      { ancho: 50, alto: 40, cant: 2 },
    ],
  },
  {
    nombre: 'PRO — pieza ancha (120×60)',
    rollo: PRO,
    pedido: [
      { ancho: 120, alto: 60, cant: 1 },
      { ancho: 64, alto: 24, cant: 3 },
      { ancho: 70, alto: 30, cant: 2 },
    ],
  },
]

describe('benchmark medidas reales de taller', () => {
  for (const caso of CASOS) {
    it(caso.nombre, () => {
      imprimir(caso.nombre, caso.pedido, caso.rollo)
      const result = guillotineStripPack(caso.pedido, caso.rollo)

      const indices = result.strips.flatMap((s) => s.pieces.map((p) => p.sourcePieceIndex))
      expect(new Set(indices).size).toBe(indices.length)
      expect(indices.length + result.unplacedPieceIndices.length).toBe(piezas(caso.pedido))
    })
  }
})
