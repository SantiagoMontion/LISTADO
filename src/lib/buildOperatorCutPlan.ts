import { guillotineStripPack, type StripPackInputLine, type StripPlan } from './guillotineStripPack'
import { parseTaskMeasure } from './parseTaskMeasure'
import type { NmProdTask } from './types'

export interface OperatorStripPiece {
  label: string
  ancho: number
  alto: number
  rotated: boolean
}

export interface OperatorCutStrip {
  stripNumber: number
  /** Cuántas tiras iguales cortar seguidas (mismo corte en eje y mismas piezas). */
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
  strips: OperatorCutStrip[]
  unplaced: Array<{ label: string; dimensions: string }>
}

function qtyForPlan(task: NmProdTask, useCompletedQty: boolean): number {
  if (useCompletedQty) return Math.max(task.current_qty, 0)
  return Math.max(task.total_qty - task.current_qty, 0)
}

function pieceLabel(ancho: number, alto: number, rotated: boolean): string {
  if (rotated) return `${alto}×${ancho} (rotada)`
  return `${ancho}×${alto}`
}

function stripSignature(strip: StripPlan): string {
  const parts = strip.pieces.map((p) =>
    pieceLabel(p.ancho, p.alto, p.rotated),
  )
  return `${strip.stripHeight}|${parts.join('+')}`
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
      pieces: current.pieces.map((p) => ({
        label: pieceLabel(p.ancho, p.alto, p.rotated),
        ancho: p.ancho,
        alto: p.alto,
        rotated: p.rotated,
      })),
    })
    i += count
  }
  return grouped
}

/** Arma el plan de corte legible para el operario a partir de las tareas pendientes. */
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
  const totalRollLengthCm = result.strips.reduce((sum, s) => sum + s.stripHeight, 0)

  const unplaced = result.unplacedPieceIndices.map((idx) => ({
    label: pieceMeta[idx]?.dimensions ?? `#${idx}`,
    dimensions: pieceMeta[idx]?.dimensions ?? '',
  }))

  return {
    rollWidth: result.rollWidth,
    stripCount: result.stripCount,
    totalRollLengthCm,
    strips: groupIdenticalStrips(result.strips),
    unplaced,
  }
}
