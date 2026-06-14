import { guillotineStripPack, type StripPackInputLine, type StripPlan } from './guillotineStripPack'
import { parseTaskMeasure } from './parseTaskMeasure'
import type { NmProdTask } from './types'

export interface OperatorStripPiece {
  label: string
  count: number
}

export interface OperatorCutStrip {
  stripNumber: number
  sheetCount: number
  stripHeight: number
  usedWidth: number
  wasteWidth: number
  pieces: OperatorStripPiece[]
}

export interface OperatorCutPlan {
  rollWidth: number
  stripCount: number
  totalRollLengthCm: number
  totalWasteAreaCm2: number
  strips: OperatorCutStrip[]
  unplaced: Array<{ label: string; dimensions: string }>
}

function qtyForPlan(task: NmProdTask, useCompletedQty: boolean): number {
  if (useCompletedQty) return Math.max(task.current_qty, 0)
  return Math.max(task.total_qty - task.current_qty, 0)
}

function pieceLabel(ancho: number, alto: number): string {
  return `${ancho}×${alto}`
}

function stripSignature(strip: StripPlan): string {
  const tallies = new Map<string, number>()
  for (const p of strip.pieces) {
    const label = pieceLabel(p.ancho, p.alto)
    tallies.set(label, (tallies.get(label) ?? 0) + 1)
  }
  const parts = [...tallies.entries()].map(([label, n]) => (n > 1 ? `${label}×${n}` : label))
  return `${strip.stripHeight}|${parts.join('+')}`
}

function aggregatePieces(strip: StripPlan): OperatorStripPiece[] {
  const tallies = new Map<string, number>()
  for (const p of strip.pieces) {
    const label = pieceLabel(p.ancho, p.alto)
    tallies.set(label, (tallies.get(label) ?? 0) + 1)
  }
  return [...tallies.entries()].map(([label, count]) => ({ label, count }))
}

function groupIdenticalStrips(strips: StripPlan[]): OperatorCutStrip[] {
  const grouped: OperatorCutStrip[] = []
  let i = 0
  while (i < strips.length) {
    const current = strips[i]
    let count = 1
    while (i + count < strips.length && stripSignature(strips[i + count]) === stripSignature(current)) {
      count += 1
    }
    grouped.push({
      stripNumber: grouped.length + 1,
      sheetCount: count,
      stripHeight: current.stripHeight,
      usedWidth: current.usedWidth,
      wasteWidth: current.wasteWidth,
      pieces: aggregatePieces(current),
    })
    i += count
  }
  return grouped
}

export function buildOperatorCutPlan(
  tasks: NmProdTask[],
  rollWidth: number,
  useCompletedQty = false,
): OperatorCutPlan | null {
  const pedido: StripPackInputLine[] = []
  const pieceMeta: Array<{ dimensions: string }> = []

  for (const task of tasks) {
    const measure = parseTaskMeasure(task.dimensions)
    if (!measure) continue
    const cant = qtyForPlan(task, useCompletedQty)
    if (cant <= 0) continue
    for (let i = 0; i < cant; i++) {
      pedido.push({ ...measure, cant: 1 })
      pieceMeta.push({ dimensions: task.dimensions.trim() })
    }
  }

  if (pedido.length === 0) return null

  const result = guillotineStripPack(pedido, rollWidth)

  const unplaced = result.unplacedPieceIndices.map((idx) => ({
    label: pieceMeta[idx]?.dimensions ?? `#${idx}`,
    dimensions: pieceMeta[idx]?.dimensions ?? '',
  }))

  return {
    rollWidth: result.rollWidth,
    stripCount: result.stripCount,
    totalRollLengthCm: result.totalRollLengthCm,
    totalWasteAreaCm2: result.totalWasteAreaCm2,
    strips: groupIdenticalStrips(result.strips),
    unplaced,
  }
}

export function formatOperatorPieceLine(piece: OperatorStripPiece): string {
  if (piece.count > 1) return `${piece.count} × ${piece.label}`
  return piece.label
}
