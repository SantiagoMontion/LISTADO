import { describe, expect, it } from 'vitest'
import {
  partitionOrdersForPapelTag,
  type PersonalizadosPdfRow,
} from './personalizadosPdfsApi'

function row(
  partial: Partial<PersonalizadosPdfRow> &
    Pick<PersonalizadosPdfRow, 'orderId' | 'orderName' | 'lineItemId' | 'status'>,
): PersonalizadosPdfRow {
  return {
    createdAt: '2026-08-10T00:00:00Z',
    lineTitle: 'Mousepad test',
    quantity: 1,
    jobId: null,
    matchMethod: 'design_name',
    printId: null,
    fileName: null,
    filePath: null,
    reason: null,
    ...partial,
  }
}

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

  it('no etiqueta parciales (un matched + un skipped)', () => {
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
