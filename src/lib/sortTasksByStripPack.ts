import { guillotineStripPack, type StripPackInputLine } from './guillotineStripPack'
import { parseTaskMeasure } from './parseTaskMeasure'
import type { NmProdTask } from './types'

function qtyForStripPack(task: NmProdTask, useCompletedQty: boolean): number {
  if (useCompletedQty) return Math.max(task.current_qty, 0)
  return Math.max(task.total_qty - task.current_qty, 0)
}

/**
 * Ordena tareas según el plan de tiras de guillotina: primero por tira, luego por posición
 * dentro de la tira. Las tareas no empaquetables quedan al final en su orden relativo.
 */
export function sortTasksByStripPack(
  tasks: NmProdTask[],
  rollWidth: number,
  useCompletedQty = false,
): NmProdTask[] {
  if (tasks.length === 0) return tasks

  const pedido: StripPackInputLine[] = []
  const taskByPieceIndex: string[] = []
  const taskOrder = new Map<string, number>()

  tasks.forEach((task, taskIndex) => {
    taskOrder.set(task.id, taskIndex)
    const measure = parseTaskMeasure(task.dimensions)
    if (!measure) return

    const cant = qtyForStripPack(task, useCompletedQty)
    if (cant <= 0) return

    for (let i = 0; i < cant; i++) {
      pedido.push({ ...measure, cant: 1 })
      taskByPieceIndex.push(task.id)
    }
  })

  if (pedido.length === 0) return [...tasks]

  const plan = guillotineStripPack(pedido, rollWidth)
  const rankByTaskId = new Map<string, number>()

  plan.strips.forEach((strip, stripIndex) => {
    strip.pieces.forEach((piece, positionInStrip) => {
      const taskId = taskByPieceIndex[piece.sourcePieceIndex]
      if (!taskId) return
      const rank = stripIndex * 10_000 + positionInStrip
      const prev = rankByTaskId.get(taskId)
      if (prev === undefined || rank < prev) {
        rankByTaskId.set(taskId, rank)
      }
    })
  })

  return [...tasks].sort((a, b) => {
    const rankA = rankByTaskId.get(a.id)
    const rankB = rankByTaskId.get(b.id)
    if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
      return rankA - rankB
    }
    if (rankA !== undefined && rankB === undefined) return -1
    if (rankA === undefined && rankB !== undefined) return 1
    return (taskOrder.get(a.id) ?? 0) - (taskOrder.get(b.id) ?? 0)
  })
}
