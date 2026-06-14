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
  /** Índice en la lista expandida de piezas de entrada. */
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
  /** Piezas que no caben en el rollo en ninguna orientación. */
  unplacedPieceIndices: number[]
}

interface ExpandedPiece {
  ancho: number
  alto: number
  sourcePieceIndex: number
}

interface Orientation {
  rotated: boolean
  pieceWidth: number
  pieceHeight: number
}

function orientations(ancho: number, alto: number, rollWidth: number): Orientation[] {
  const opts: Orientation[] = []
  if (ancho <= rollWidth) {
    opts.push({ rotated: false, pieceWidth: ancho, pieceHeight: alto })
  }
  if (alto <= rollWidth && alto !== ancho) {
    opts.push({ rotated: true, pieceWidth: alto, pieceHeight: ancho })
  } else if (alto <= rollWidth && ancho > rollWidth) {
    opts.push({ rotated: true, pieceWidth: alto, pieceHeight: ancho })
  }
  return opts
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

function sortPiecesForPacking(pieces: ExpandedPiece[]): ExpandedPiece[] {
  return [...pieces].sort((a, b) => {
    if (b.alto !== a.alto) return b.alto - a.alto
    if (b.ancho !== a.ancho) return b.ancho - a.ancho
    return a.sourcePieceIndex - b.sourcePieceIndex
  })
}

function pickNewStripOrientation(
  ancho: number,
  alto: number,
  rollWidth: number,
): Orientation | null {
  const opts = orientations(ancho, alto, rollWidth)
  if (opts.length === 0) return null
  const normal = opts.find((o) => !o.rotated)
  return normal ?? opts[0]
}

function findBestStripPlacement(
  piece: ExpandedPiece,
  strips: StripPlan[],
  rollWidth: number,
): { stripIndex: number; orientation: Orientation } | null {
  let best: { stripIndex: number; orientation: Orientation; score: number } | null = null

  for (let stripIndex = 0; stripIndex < strips.length; stripIndex++) {
    const strip = strips[stripIndex]
    const remaining = rollWidth - strip.usedWidth
    if (remaining <= 0) continue

    for (const orientation of orientations(piece.ancho, piece.alto, rollWidth)) {
      if (orientation.pieceHeight > strip.stripHeight) continue
      if (orientation.pieceWidth > remaining) continue

      const leftover = remaining - orientation.pieceWidth
      const heightMismatch = strip.stripHeight - orientation.pieceHeight
      const rotationPenalty = orientation.rotated ? 5_000 : 0
      const score = heightMismatch * 1_000 + leftover + rotationPenalty

      if (!best || score < best.score) {
        best = { stripIndex, orientation, score }
      }
    }
  }

  return best ? { stripIndex: best.stripIndex, orientation: best.orientation } : null
}

function addPieceToStrip(
  strip: StripPlan,
  piece: ExpandedPiece,
  orientation: Orientation,
  rollWidth: number,
): void {
  strip.pieces.push({
    ancho: piece.ancho,
    alto: piece.alto,
    rotated: orientation.rotated,
    sourcePieceIndex: piece.sourcePieceIndex,
  })
  strip.usedWidth += orientation.pieceWidth
  strip.wasteWidth = rollWidth - strip.usedWidth
}

/**
 * Heurística Best-Fit Decreasing Height para empaquetado en tiras de guillotina
 * (corte horizontal en eje + piezas lado a lado en el ancho W del rollo).
 */
export function guillotineStripPack(
  pedido: StripPackInputLine[],
  rollWidth: number,
): StripPackResult {
  if (rollWidth <= 0) {
    return { rollWidth, stripCount: 0, strips: [], unplacedPieceIndices: [] }
  }

  const expanded = expandPedido(pedido)
  const sorted = sortPiecesForPacking(expanded)
  const strips: StripPlan[] = []
  const unplacedPieceIndices: number[] = []

  for (const piece of sorted) {
    const placement = findBestStripPlacement(piece, strips, rollWidth)
    if (placement) {
      addPieceToStrip(strips[placement.stripIndex], piece, placement.orientation, rollWidth)
      continue
    }

    const newOrientation = pickNewStripOrientation(piece.ancho, piece.alto, rollWidth)
    if (!newOrientation || newOrientation.pieceWidth > rollWidth) {
      unplacedPieceIndices.push(piece.sourcePieceIndex)
      continue
    }

    const strip: StripPlan = {
      stripHeight: newOrientation.pieceHeight,
      usedWidth: 0,
      wasteWidth: rollWidth,
      pieces: [],
    }
    addPieceToStrip(strip, piece, newOrientation, rollWidth)
    strips.push(strip)
  }

  return {
    rollWidth,
    stripCount: strips.length,
    strips,
    unplacedPieceIndices,
  }
}
