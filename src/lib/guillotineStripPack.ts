import type { MaterialTab } from './types'

/** Ancho fijo del rollo por material (cm). */
export const ROLL_WIDTH_BY_TAB: Partial<Record<MaterialTab, number>> = {
  classic: 140,
  pro: 128,
}

export interface StripPackInputLine {
  ancho: number
  alto: number
  cant: number
}

export interface PackedPiece {
  ancho: number
  alto: number
  rotated: boolean
  sourcePieceIndex: number
}

export interface StripPlan {
  stripHeight: number
  usedWidth: number
  wasteWidth: number
  pieces: PackedPiece[]
}

export interface StripPackResult {
  rollWidth: number
  stripCount: number
  strips: StripPlan[]
  unplacedPieceIndices: number[]
  /** Suma de alturas de plancha (cm de rollo consumidos en eje). */
  totalRollLengthCm: number
  /** Suma de (ancho sobrante × alto de plancha) en cm². */
  totalWasteAreaCm2: number
}

interface ExpandedPiece {
  ancho: number
  alto: number
  sourcePieceIndex: number
}

interface BatchOrientation {
  rotated: boolean
  stripHeight: number
  pieceWidth: number
  maxPerStrip: number
}

function expandPedido(pedido: StripPackInputLine[]): ExpandedPiece[] {
  const pieces: ExpandedPiece[] = []
  let sourcePieceIndex = 0
  for (const line of pedido) {
    const cant = Math.max(0, Math.floor(line.cant))
    for (let i = 0; i < cant; i++) {
      pieces.push({
        ancho: line.ancho,
        alto: line.alto,
        sourcePieceIndex,
      })
      sourcePieceIndex += 1
    }
  }
  return pieces
}

function orientationsForBatch(ancho: number, alto: number, rollWidth: number): BatchOrientation[] {
  const candidates: BatchOrientation[] = []

  if (ancho <= rollWidth) {
    const maxPerStrip = Math.floor(rollWidth / ancho)
    if (maxPerStrip > 0) {
      candidates.push({
        rotated: false,
        stripHeight: alto,
        pieceWidth: ancho,
        maxPerStrip,
      })
    }
  }

  if (alto <= rollWidth) {
    const maxPerStrip = Math.floor(rollWidth / alto)
    if (maxPerStrip > 0) {
      candidates.push({
        rotated: true,
        stripHeight: ancho,
        pieceWidth: alto,
        maxPerStrip,
      })
    }
  }

  return candidates
}

function stripWasteArea(strip: StripPlan, rollWidth: number, pieceArea: number): number {
  const materialArea = strip.stripHeight * rollWidth
  const usedPieceArea = strip.pieces.length * pieceArea
  return materialArea - usedPieceArea
}

function buildStripsForOrientation(
  ancho: number,
  alto: number,
  pieceIndices: number[],
  batch: BatchOrientation,
  rollWidth: number,
): StripPlan[] {
  const strips: StripPlan[] = []
  let offset = 0

  while (offset < pieceIndices.length) {
    const count = Math.min(batch.maxPerStrip, pieceIndices.length - offset)
    const strip: StripPlan = {
      stripHeight: batch.stripHeight,
      usedWidth: batch.pieceWidth * count,
      wasteWidth: rollWidth - batch.pieceWidth * count,
      pieces: [],
    }
    for (let j = 0; j < count; j++) {
      strip.pieces.push({
        ancho,
        alto,
        rotated: batch.rotated,
        sourcePieceIndex: pieceIndices[offset + j],
      })
    }
    strips.push(strip)
    offset += count
  }

  return strips
}

/** Elige normal vs rotada minimizando área de material desperdiciada en todo el grupo. */
function packIdenticalGroupMinWaste(
  ancho: number,
  alto: number,
  pieceIndices: number[],
  rollWidth: number,
): { strips: StripPlan[]; unplaced: number[] } {
  const candidates = orientationsForBatch(ancho, alto, rollWidth)
  if (candidates.length === 0) {
    return { strips: [], unplaced: pieceIndices }
  }

  const pieceArea = ancho * alto
  let bestStrips: StripPlan[] | null = null
  let bestWaste = Infinity
  let bestLength = Infinity

  for (const batch of candidates) {
    const strips = buildStripsForOrientation(ancho, alto, pieceIndices, batch, rollWidth)
    const waste = strips.reduce((sum, s) => sum + stripWasteArea(s, rollWidth, pieceArea), 0)
    const length = strips.reduce((sum, s) => sum + s.stripHeight, 0)

    if (
      waste < bestWaste ||
      (waste === bestWaste && length < bestLength) ||
      (waste === bestWaste && length === bestLength && (bestStrips?.length ?? Infinity) > strips.length)
    ) {
      bestWaste = waste
      bestLength = length
      bestStrips = strips
    }
  }

  return { strips: bestStrips ?? [], unplaced: [] }
}

/** Une planchas del mismo alto si caben juntas en el ancho del rollo (menos cortes en eje). */
function mergeStripsSameHeight(strips: StripPlan[], rollWidth: number): StripPlan[] {
  const byHeight = new Map<number, StripPlan[]>()

  for (const strip of strips) {
    const list = byHeight.get(strip.stripHeight) ?? []
    list.push({
      ...strip,
      pieces: [...strip.pieces],
    })
    byHeight.set(strip.stripHeight, list)
  }

  const merged: StripPlan[] = []

  for (const group of byHeight.values()) {
    group.sort((a, b) => b.usedWidth - a.usedWidth)
    const open: StripPlan[] = []

    for (const strip of group) {
      let placed = false
      for (const target of open) {
        if (target.usedWidth + strip.usedWidth <= rollWidth) {
          target.pieces.push(...strip.pieces)
          target.usedWidth += strip.usedWidth
          target.wasteWidth = rollWidth - target.usedWidth
          placed = true
          break
        }
      }
      if (!placed) {
        open.push(strip)
      }
    }

    merged.push(...open)
  }

  return merged.sort((a, b) => b.stripHeight - a.stripHeight)
}

function summarizeResult(strips: StripPlan[]): Pick<StripPackResult, 'totalRollLengthCm' | 'totalWasteAreaCm2'> {
  let totalRollLengthCm = 0
  let totalWasteAreaCm2 = 0

  for (const strip of strips) {
    totalRollLengthCm += strip.stripHeight
    totalWasteAreaCm2 += strip.stripHeight * strip.wasteWidth
  }

  return { totalRollLengthCm, totalWasteAreaCm2 }
}

/**
 * Empaqueta cada medida igual con la orientación que menos material desperdicia,
 * luego fusiona planchas del mismo alto cuando caben en el rollo.
 */
export function guillotineStripPack(
  pedido: StripPackInputLine[],
  rollWidth: number,
): StripPackResult {
  if (rollWidth <= 0) {
    return {
      rollWidth,
      stripCount: 0,
      strips: [],
      unplacedPieceIndices: [],
      totalRollLengthCm: 0,
      totalWasteAreaCm2: 0,
    }
  }

  const expanded = expandPedido(pedido)
  const groups = new Map<string, ExpandedPiece[]>()

  for (const piece of expanded) {
    const key = `${piece.ancho}x${piece.alto}`
    const list = groups.get(key) ?? []
    list.push(piece)
    groups.set(key, list)
  }

  const groupStrips: StripPlan[] = []
  const unplacedPieceIndices: number[] = []

  for (const key of groups.keys()) {
    const pieces = groups.get(key) ?? []
    const [ancho, alto] = key.split('x').map(Number)
    const indices = pieces.map((p) => p.sourcePieceIndex)
    const packed = packIdenticalGroupMinWaste(ancho, alto, indices, rollWidth)
    groupStrips.push(...packed.strips)
    unplacedPieceIndices.push(...packed.unplaced)
  }

  const strips = mergeStripsSameHeight(groupStrips, rollWidth)
  const totals = summarizeResult(strips)

  return {
    rollWidth,
    stripCount: strips.length,
    strips,
    unplacedPieceIndices,
    ...totals,
  }
}
