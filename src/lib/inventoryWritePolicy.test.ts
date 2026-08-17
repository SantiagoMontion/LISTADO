import { describe, expect, it } from 'vitest'
import {
  OOS_CONFIRM_MS,
  decideInventoryWrite,
  parseOosPending,
  shouldAlertZeroWrite,
} from '../../api/_lib/importados-sync/inventoryWritePolicy'

describe('decideInventoryWrite', () => {
  const base = {
    provider: 'lethal' as const,
    notmidVariantId: 'v1',
    oosPending: {},
    lastKnownQty: 29,
    nowMs: 1_000_000,
  }

  it('available + reliable qty → escribe qty real', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: true,
      reliable: true,
      supplierQty: 29,
      shopifyQty: 0,
    })
    expect(d.action).toBe('write')
    if (d.action === 'write') expect(d.writeQty).toBe(29)
  })

  it('Lethal no apaga stock NotMid (solo restock)', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: false,
      reliable: true,
      supplierQty: 0,
      shopifyQty: 29,
      oosPending: { v1: new Date(base.nowMs - OOS_CONFIRM_MS - 1).toISOString() },
    })
    expect(d).toMatchObject({ action: 'skip', reason: 'lethal_restock_only' })
  })

  it('MK sí apaga tras doble confirm', () => {
    const d = decideInventoryWrite({
      ...base,
      provider: 'mk',
      storefrontAvailable: false,
      reliable: true,
      supplierQty: 0,
      shopifyQty: 29,
      oosPending: { v1: new Date(base.nowMs - OOS_CONFIRM_MS - 1).toISOString() },
    })
    expect(d.action).toBe('write')
    if (d.action === 'write') expect(d.writeQty).toBe(0)
  })

  it('unreliable → skip', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: false,
      reliable: false,
      supplierQty: 0,
      shopifyQty: 29,
    })
    expect(d).toMatchObject({ action: 'skip', reason: 'unreliable_probe' })
  })

  it('ghost zero Lethal (Shopify 0, last_known 29) restaura 29 aunque el probe diga OOS', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: false,
      reliable: true,
      supplierQty: 0,
      shopifyQty: 0,
      lastKnownQty: 29,
    })
    expect(d.action).toBe('write')
    if (d.action === 'write') {
      expect(d.writeQty).toBe(29)
      expect(d.reason).toBe('ghost_zero_restore_last_known')
    }
  })

  it('vitrina available + probe dudoso usa last_known, nunca 1 si ya sabíamos 29', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: true,
      reliable: false,
      supplierQty: 0,
      shopifyQty: 0,
      lastKnownQty: 29,
    })
    expect(d.action).toBe('write')
    if (d.action === 'write') expect(d.writeQty).toBe(29)
  })

  it('Lethal no escribe 0 en Shopify vacío si no hay last_known', () => {
    const d = decideInventoryWrite({
      ...base,
      storefrontAvailable: false,
      reliable: true,
      supplierQty: 0,
      shopifyQty: 0,
      lastKnownQty: 0,
    })
    expect(d).toMatchObject({ action: 'skip', reason: 'lethal_oos_leave_zero' })
  })
})

describe('helpers', () => {
  it('parseOosPending', () => {
    expect(parseOosPending({ a: '2026-01-01T00:00:00.000Z', b: 'x' })).toEqual({
      a: '2026-01-01T00:00:00.000Z',
    })
  })
  it('shouldAlertZeroWrite', () => {
    expect(
      shouldAlertZeroWrite({
        reason: 'oos_confirmed_from_high',
        shopifyQty: 29,
        lastKnownQty: 29,
      }),
    ).toBe(true)
  })
})
