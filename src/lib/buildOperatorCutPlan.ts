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
  /** Varias disposiciones en el ancho para el mismo largo. */
  mixedLayouts: boolean
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

function aggregatePiecesFromStrips(strips: StripPlan[]): OperatorStripPiece[] {
  const tallies = new Map<string, number>()
  for (const strip of strips) {
    for (const p of strip.pieces) {
      const label = pieceLabel(p.ancho, p.alto)
      tallies.set(label, (tallies.get(label) ?? 0) + 1)
    }
  }
  return [...tallies.entries()].map(([label, count]) => ({ label, count }))
}

function layoutSignature(strip: StripPlan): string {
  const tallies = new Map<string, number>()
  for (const p of strip.pieces) {
    const label = pieceLabel(p.ancho, p.alto)
    tallies.set(label, (tallies.get(label) ?? 0) + 1)
  }
  const parts = [...tallies.entries()].map(([label, n]) => (n > 1 ? `${label}×${n}` : label))
  return `${strip.usedWidth}|${parts.join('+')}`
}

/** Agrupa todas las planchas del mismo largo (corte en eje). */
function groupStripsByHeight(strips: StripPlan[]): OperatorCutStrip[] {
  const buckets = new Map<number, StripPlan[]>()
  const order: number[] = []

  for (const strip of strips) {
    const list = buckets.get(strip.stripHeight)
    if (list) {
      list.push(strip)
    } else {
      buckets.set(strip.stripHeight, [strip])
      order.push(strip.stripHeight)
    }
  }

  return order.map((height, idx) => {
    const group = buckets.get(height)!
    const layoutSigs = new Set(group.map(layoutSignature))
    const sameLayout = layoutSigs.size === 1
    const ref = group[0]

    return {
      stripNumber: idx + 1,
      sheetCount: group.length,
      stripHeight: height,
      usedWidth: sameLayout ? ref.usedWidth : 0,
      wasteWidth: sameLayout ? ref.wasteWidth : 0,
      pieces: aggregatePiecesFromStrips(group),
      mixedLayouts: !sameLayout,
    }
  })
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
    strips: groupStripsByHeight(result.strips),
    unplaced,
  }
}

export function formatOperatorPieceLine(piece: OperatorStripPiece): string {
  if (piece.count > 1) return `${piece.count} × ${piece.label}`
  return piece.label
}

function tasksToPedidoLines(
  tasks: NmProdTask[],
  useCompletedQty: boolean,
): StripPackInputLine[] {
  const pedido: StripPackInputLine[] = []
  for (const task of tasks) {
    const measure = parseTaskMeasure(task.dimensions)
    if (!measure) continue
    const cant = qtyForPlan(task, useCompletedQty)
    if (cant <= 0) continue
    pedido.push({ ...measure, cant })
  }
  return pedido
}

/** Metros de rollo (cm) para un conjunto de tareas, usando el empaquetado óptimo. */
export function computeRollLengthCmFromTasks(
  tasks: NmProdTask[],
  rollWidth: number,
  useCompletedQty = false,
): number {
  const pedido = tasksToPedidoLines(tasks, useCompletedQty)
  if (pedido.length === 0) return 0
  return guillotineStripPack(pedido, rollWidth).totalRollLengthCm
}

export function formatRollMeters(cm: number): string {
  const m = cm / 100
  return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`
}
