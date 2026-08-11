import { describe, expect, it } from 'vitest'
import {
  expandMatchedRowsForZip,
  mergeIdenticalProductRows,
  partitionOrdersForPapelTag,
  type PersonalizadosPdfRow,
} from './personalizadosPdfsApi'

function row(
  partial: Partial<PersonalizadosPdfRow> &
    Pick<PersonalizadosPdfRow, 'orderId' | 'orderName' | 'lineItemId' | 'status'>,
): PersonalizadosPdfRow {
  const merged = {
    createdAt: '2026-08-10T00:00:00Z',
    lineTitle: 'Mousepad test',
    quantity: 1,
    jobId: null as string | null,
    matchMethod: 'design_name' as const,
    printId: null as string | null,
    fileName: null as string | null,
    filePath: null as string | null,
    designName: null as string | null,
    reason: null as string | null,
    ...partial,
  }
  return {
    ...merged,
    designName: merged.designName ?? null,
    reason: merged.reason ?? null,
    jobId: merged.jobId ?? null,
    printId: merged.printId ?? null,
    fileName: merged.fileName ?? null,
    filePath: merged.filePath ?? null,
  }
}

describe('expandMatchedRowsForZip', () => {
  it('incluye el PDF una vez por unidad (qty 2 → 2 entradas)', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'matched',
        printId: 'p1',
        quantity: 2,
      }),
    ]
    expect(expandMatchedRowsForZip(rows)).toHaveLength(2)
  })

  it('no dedupea el mismo printId entre pedidos distintos', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'matched',
        printId: 'same',
        quantity: 1,
      }),
      row({
        orderId: '2',
        orderName: '#2',
        lineItemId: 'b',
        status: 'matched',
        printId: 'same',
        quantity: 1,
      }),
    ]
    expect(expandMatchedRowsForZip(rows)).toHaveLength(2)
  })

  it('ignora skipped', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'skipped',
        quantity: 3,
      }),
    ]
    expect(expandMatchedRowsForZip(rows)).toHaveLength(0)
  })
})

describe('mergeIdenticalProductRows', () => {
  it('une 2 iguales en una fila ×2', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'matched',
        printId: 'same',
        quantity: 1,
        lineTitle: 'Pad A',
      }),
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'b',
        status: 'matched',
        printId: 'same',
        quantity: 1,
        lineTitle: 'Pad A',
      }),
    ]
    const groups = mergeIdenticalProductRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].quantity).toBe(2)
    expect(groups[0].members).toHaveLength(2)
  })

  it('no une productos distintos', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'matched',
        printId: 'p1',
        lineTitle: 'Pad A',
      }),
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'b',
        status: 'skipped',
        lineTitle: 'Pad B',
      }),
    ]
    expect(mergeIdenticalProductRows(rows)).toHaveLength(2)
  })
})

describe('partitionOrdersForPapelTag', () => {
  it('marca completo solo si todas las líneas matched se descargaron', () => {
    const rows = [
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'a',
        status: 'matched',
        printId: 'p1',
      }),
      row({
        orderId: '1',
        orderName: '#1',
        lineItemId: 'b',
        status: 'matched',
        printId: 'p2',
      }),
    ]
    const { complete, partial } = partitionOrdersForPapelTag(rows, ['p1', 'p2'])
    expect(complete).toEqual([{ orderId: '1', orderName: '#1' }])
    expect(partial).toEqual([])
  })

  it('no etiqueta si falta un producto distinto', () => {
    const rows = [
      row({
        orderId: '2',
        orderName: '#2',
        lineItemId: 'a',
        status: 'matched',
        printId: 'p1',
      }),
      row({
        orderId: '2',
        orderName: '#2',
        lineItemId: 'b',
        status: 'skipped',
        reason: 'print_not_found',
      }),
    ]
    const { complete, partial } = partitionOrdersForPapelTag(rows, ['p1'])
    expect(complete).toEqual([])
    expect(partial).toEqual([
      { orderId: '2', orderName: '#2', matched: 1, skipped: 1 },
    ])
  })

  it('con 2 iguales, un OK manual sobre ambas claves alcanza para Papel', () => {
    const rows = [
      row({
        orderId: '5',
        orderName: '#5',
        lineItemId: 'a',
        status: 'skipped',
        printId: null,
        lineTitle: 'Pad',
      }),
      row({
        orderId: '5',
        orderName: '#5',
        lineItemId: 'b',
        status: 'skipped',
        printId: null,
        lineTitle: 'Pad',
      }),
    ]
    const keys = rows.map(
      (r) => `${r.orderId}-${r.lineItemId}-${r.jobId || r.printId || r.lineTitle}`,
    )
    const { complete } = partitionOrdersForPapelTag(rows, [], keys)
    expect(complete).toEqual([{ orderId: '5', orderName: '#5' }])
  })

  it('ignora pedidos sin ninguna descarga', () => {
    const rows = [
      row({
        orderId: '3',
        orderName: '#3',
        lineItemId: 'a',
        status: 'skipped',
        reason: 'print_not_found',
      }),
    ]
    const { complete, partial } = partitionOrdersForPapelTag(rows, [])
    expect(complete).toEqual([])
    expect(partial).toEqual([])
  })
})
