import { describe, expect, it } from 'vitest'
import {
  guillotineStripPack,
  type StripPackInputLine,
  type StripPackResult,
} from './guillotineStripPack'

const CLASSIC_W = 140
const PRO_W = 128

interface BenchmarkCase {
  name: string
  rollWidth: number
  pedido: StripPackInputLine[]
  /** Piezas que no deben poder colocarse (ej. 145×145 en rollo 140). */
  expectUnplaced?: number
}

function expandExpected(pedido: StripPackInputLine[]): Array<{ ancho: number; alto: number; idx: number }> {
  const out: Array<{ ancho: number; alto: number; idx: number }> = []
  let idx = 0
  for (const line of pedido) {
    for (let i = 0; i < line.cant; i++) {
      out.push({ ancho: line.ancho, alto: line.alto, idx })
      idx += 1
    }
  }
  return out
}

function naiveTotalHeight(pedido: StripPackInputLine[]): number {
  let total = 0
  for (const line of pedido) {
    for (let i = 0; i < line.cant; i++) {
      total += Math.min(line.ancho, line.alto <= line.ancho ? line.alto : line.ancho)
      // naive: one strip per piece, natural orientation height = alto if fits width else ancho
      const h =
        line.ancho <= CLASSIC_W ? line.alto : line.alto <= CLASSIC_W ? line.ancho : Infinity
      total += h === Infinity ? 0 : h
    }
  }
  return total
}

function naiveOnePiecePerStrip(pedido: StripPackInputLine[], rollWidth: number): number {
  let total = 0
  for (const line of pedido) {
    for (let i = 0; i < line.cant; i++) {
      const normalFits = line.ancho <= rollWidth
      const rotatedFits = line.alto <= rollWidth
      if (normalFits) total += line.alto
      else if (rotatedFits) total += line.ancho
    }
  }
  return total
}

function validatePlan(
  pedido: StripPackInputLine[],
  result: StripPackResult,
): { ok: boolean; errors: string[]; stats: Record<string, number | string> } {
  const errors: string[] = []
  const expected = expandExpected(pedido)
  const placedIndices = result.strips.flatMap((s) => s.pieces.map((p) => p.sourcePieceIndex))

  // 1. Cada pieza exactamente una vez
  const sortedPlaced = [...placedIndices].sort((a, b) => a - b)
  const sortedExpected = expected.map((_, i) => i)
  if (sortedPlaced.length !== sortedExpected.length) {
    errors.push(
      `Cantidad: esperadas ${sortedExpected.length}, colocadas ${sortedPlaced.length}, sin colocar ${result.unplacedPieceIndices.length}`,
    )
  }
  for (let i = 0; i < sortedExpected.length; i++) {
    if (sortedPlaced[i] !== i && !result.unplacedPieceIndices.includes(i)) {
      errors.push(`Falta índice ${i} o hay duplicado`)
      break
    }
  }
  const placedSet = new Set(placedIndices)
  if (placedSet.size !== placedIndices.length) {
    errors.push(`DUPLICADOS detectados: ${placedIndices.length} colocadas vs ${placedSet.size} únicas`)
  }

  // 2. Restricciones físicas por tira
  let totalWaste = 0
  let totalHeight = 0
  for (const [si, strip] of result.strips.entries()) {
    totalHeight += strip.stripHeight
    totalWaste += strip.wasteWidth
    let used = 0
    for (const piece of strip.pieces) {
      const exp = expected[piece.sourcePieceIndex]
      if (!exp) {
        errors.push(`Índice ${piece.sourcePieceIndex} fuera de rango`)
        continue
      }
      if (exp.ancho !== piece.ancho || exp.alto !== piece.alto) {
        errors.push(
          `Tira ${si + 1}: pieza ${piece.sourcePieceIndex} dimensiones originales no coinciden`,
        )
      }
      const pw = piece.rotated ? piece.alto : piece.ancho
      const ph = piece.rotated ? piece.ancho : piece.alto
      if (ph > strip.stripHeight) {
        errors.push(`Tira ${si + 1}: pieza ${pw}x${ph} supera alto de tira ${strip.stripHeight}`)
      }
      used += pw
    }
    if (used !== strip.usedWidth) {
      errors.push(`Tira ${si + 1}: ancho usado inconsistente ${used} vs ${strip.usedWidth}`)
    }
    if (used > result.rollWidth) {
      errors.push(`Tira ${si + 1}: ancho ${used} > rollo ${result.rollWidth}`)
    }
  }

  const naiveH = naiveOnePiecePerStrip(pedido, result.rollWidth)
  const savingsPct =
    naiveH > 0 ? Math.round(((naiveH - totalHeight) / naiveH) * 100) : 0

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      piezas: expected.length,
      colocadas: placedIndices.length,
      sinColocar: result.unplacedPieceIndices.length,
      tiras: result.stripCount,
      alturaTotalCm: totalHeight,
      naiveUnaPiezaPorTiraCm: naiveH,
      ahorroVsNaivePct: `${savingsPct}%`,
      desperdicioAnchoTotalCm: totalWaste,
    },
  }
}

function fmtPiece(p: { ancho: number; alto: number; rotated: boolean }): string {
  if (p.rotated) return `${p.alto}x${p.ancho}(R)`
  return `${p.ancho}x${p.alto}`
}

function printPlan(name: string, pedido: StripPackInputLine[], result: StripPackResult): void {
  const v = validatePlan(pedido, result)
  console.log(`\n${'='.repeat(72)}`)
  console.log(`CASO: ${name}`)
  console.log(`Rollo W=${result.rollWidth}cm | ${JSON.stringify(v.stats)}`)
  if (!v.ok) console.log(`ERRORES: ${v.errors.join('; ')}`)
  for (const [i, strip] of result.strips.entries()) {
    const pieces = strip.pieces.map(fmtPiece).join(' + ')
    console.log(
      `  Tira ${i + 1} | H=${strip.stripHeight}cm | usado=${strip.usedWidth}cm | merma=${strip.wasteWidth}cm | ${pieces}`,
    )
  }
  if (result.unplacedPieceIndices.length) {
    console.log(`  SIN COLOCAR índices: ${result.unplacedPieceIndices.join(', ')}`)
  }
}

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    name: 'Classic — estándar taller (90x40, 82x32, 50x40)',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 90, alto: 40, cant: 15 },
      { ancho: 82, alto: 32, cant: 8 },
      { ancho: 50, alto: 40, cant: 6 },
    ],
  },
  {
    name: 'Classic — mix chico a grande',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 25, alto: 25, cant: 4 },
      { ancho: 40, alto: 30, cant: 3 },
      { ancho: 60, alto: 45, cant: 2 },
      { ancho: 90, alto: 60, cant: 2 },
      { ancho: 120, alto: 80, cant: 1 },
      { ancho: 140, alto: 100, cant: 1 },
    ],
  },
  {
    name: 'Classic — muchas piezas iguales (¿agrupa bien?)',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 70, alto: 35, cant: 12 },
      { ancho: 35, alto: 35, cant: 8 },
    ],
  },
  {
    name: 'Classic — medidas que obligan rotación',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 150, alto: 40, cant: 2 },
      { ancho: 100, alto: 50, cant: 3 },
      { ancho: 30, alto: 130, cant: 1 },
    ],
  },
  {
    name: 'Classic — pedido del ejemplo original',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 60, alto: 30, cant: 1 },
      { ancho: 61, alto: 30, cant: 1 },
      { ancho: 40, alto: 60, cant: 2 },
      { ancho: 35, alto: 90, cant: 1 },
    ],
  },
  {
    name: 'Classic — día pesado simulado',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 90, alto: 40, cant: 20 },
      { ancho: 82, alto: 32, cant: 10 },
      { ancho: 50, alto: 40, cant: 8 },
      { ancho: 77, alto: 44, cant: 4 },
      { ancho: 100, alto: 60, cant: 3 },
      { ancho: 60, alto: 30, cant: 6 },
      { ancho: 35, alto: 90, cant: 2 },
      { ancho: 25, alto: 25, cant: 10 },
    ],
  },
  {
    name: 'Classic — imposible (145x145 no cabe en rollo 140)',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 145, alto: 145, cant: 1 },
      { ancho: 70, alto: 50, cant: 4 },
    ],
    expectUnplaced: 1,
  },
  {
    name: 'Classic — grande + medianas',
    rollWidth: CLASSIC_W,
    pedido: [
      { ancho: 140, alto: 100, cant: 1 },
      { ancho: 70, alto: 50, cant: 4 },
    ],
  },
  {
    name: 'PRO — estándar taller',
    rollWidth: PRO_W,
    pedido: [
      { ancho: 90, alto: 40, cant: 10 },
      { ancho: 82, alto: 32, cant: 6 },
      { ancho: 50, alto: 40, cant: 5 },
    ],
  },
  {
    name: 'PRO — mix 25x25 a 120x60',
    rollWidth: PRO_W,
    pedido: [
      { ancho: 25, alto: 25, cant: 6 },
      { ancho: 50, alto: 40, cant: 4 },
      { ancho: 80, alto: 50, cant: 3 },
      { ancho: 100, alto: 55, cant: 2 },
      { ancho: 120, alto: 60, cant: 1 },
    ],
  },
  {
    name: 'PRO — piezas anchas en rollo 128',
    rollWidth: PRO_W,
    pedido: [
      { ancho: 128, alto: 60, cant: 2 },
      { ancho: 64, alto: 60, cant: 4 },
      { ancho: 90, alto: 40, cant: 5 },
    ],
  },
  {
    name: 'PRO — rotación forzada (ancho > 128)',
    rollWidth: PRO_W,
    pedido: [
      { ancho: 140, alto: 40, cant: 3 },
      { ancho: 60, alto: 120, cant: 2 },
      { ancho: 90, alto: 40, cant: 4 },
    ],
  },
  {
    name: 'PRO — día pesado simulado',
    rollWidth: PRO_W,
    pedido: [
      { ancho: 90, alto: 40, cant: 15 },
      { ancho: 82, alto: 32, cant: 8 },
      { ancho: 64, alto: 32, cant: 6 },
      { ancho: 50, alto: 40, cant: 6 },
      { ancho: 100, alto: 50, cant: 2 },
      { ancho: 30, alto: 30, cant: 10 },
    ],
  },
]

describe('guillotineStripPack benchmark local', () => {
  const summaries: Array<{ name: string; ok: boolean; stats: Record<string, number | string> }> = []

  for (const bc of BENCHMARK_CASES) {
    it(bc.name, () => {
      const result = guillotineStripPack(bc.pedido, bc.rollWidth)
      printPlan(bc.name, bc.pedido, result)
      const v = validatePlan(bc.pedido, result)

      // Duplicados nunca
      const indices = result.strips.flatMap((s) => s.pieces.map((p) => p.sourcePieceIndex))
      expect(new Set(indices).size).toBe(indices.length)

      // Piezas colocadas + unplaced = total
      const totalExpected = bc.pedido.reduce((s, l) => s + l.cant, 0)
      expect(indices.length + result.unplacedPieceIndices.length).toBe(totalExpected)
      if (bc.expectUnplaced !== undefined) {
        expect(result.unplacedPieceIndices.length).toBe(bc.expectUnplaced)
      } else {
        expect(result.unplacedPieceIndices.length).toBe(0)
      }

      // Restricciones físicas (sin contar piezas imposibles como error)
      const physicalErrors = v.errors.filter(
        (e) =>
          !e.includes('Cantidad') &&
          !e.includes('Falta índice') &&
          !e.includes('DUPLICADOS'),
      )
      expect(physicalErrors).toEqual([])
      if (bc.expectUnplaced === undefined) {
        expect(v.ok).toBe(true)
      }

      summaries.push({
        name: bc.name,
        ok: bc.expectUnplaced !== undefined ? physicalErrors.length === 0 : v.ok,
        stats: v.stats,
      })
    })
  }

  it('resumen comparativo', () => {
    console.log(`\n${'#'.repeat(72)}`)
    console.log('RESUMEN BENCHMARK')
    console.log('#'.repeat(72))
    console.log(
      'Caso'.padEnd(52) +
        'Tiras'.padStart(6) +
        'Alt.cm'.padStart(8) +
        'Ahorro'.padStart(8) +
        ' OK'.padStart(4),
    )
    console.log('-'.repeat(78))
    for (const s of summaries) {
      const label = s.name.length > 50 ? s.name.slice(0, 47) + '…' : s.name
      console.log(
        label.padEnd(52) +
          String(s.stats.tiras).padStart(6) +
          String(s.stats.alturaTotalCm).padStart(8) +
          String(s.stats.ahorroVsNaivePct).padStart(8) +
          (s.ok ? '  ✓' : '  ✗').padStart(4),
      )
    }
    const allOk = summaries.every((s) => s.ok)
    console.log(`\nTotal casos: ${summaries.length} | Integridad OK: ${allOk ? 'SÍ' : 'NO'}`)
    expect(allOk).toBe(true)
  })
})
