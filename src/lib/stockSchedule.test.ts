import { describe, expect, it } from 'vitest'
import {
  computeLastKnownQty,
  HIGH_STOCK_TTL_MS,
  isGhostZeroSuspect,
  isProductDueForCheck,
  LOW_STOCK_TTL_MS,
  needsInitialStockSync,
  OOS_TTL_MS,
  selectDueTrackedProducts,
} from '../../api/_lib/importados-sync/stockSchedule'
import type { TrackedProduct } from '../../api/_lib/importados-sync/supabase'

function product(partial: Partial<TrackedProduct>): TrackedProduct {
  return {
    id: partial.id ?? '1',
    provider: partial.provider ?? 'lethal',
    product_url: partial.product_url ?? 'https://x.test/p',
    shopify_handle: partial.shopify_handle ?? 'x',
    notmid_shopify_variant_id: null,
    notmid_shopify_product_id: null,
    variant_map: null,
    current_price: null,
    in_stock: partial.in_stock ?? true,
    last_known_qty: partial.last_known_qty ?? null,
    peso_kg: partial.peso_kg ?? null,
    oos_pending: partial.oos_pending ?? {},
    last_checked: partial.last_checked ?? null,
    is_active: true,
  }
}

describe('stockSchedule', () => {
  it('computeLastKnownQty uses min variant qty', () => {
    expect(
      computeLastKnownQty({
        inStock: true,
        quantities: [{ qty: 19 }, { qty: 2 }],
      }),
    ).toBe(2)
    expect(computeLastKnownQty({ inStock: false, quantities: [] })).toBe(0)
    expect(computeLastKnownQty({ inStock: true, quantities: [] })).toBe(1)
  })

  it('preserve previous last_known when heal fails (no poison to 0)', () => {
    expect(
      computeLastKnownQty({
        inStock: true,
        quantities: [{ qty: 0 }],
        previousLastKnownQty: 10,
        preservePreviousOnEmptyOrZero: true,
      }),
    ).toBe(10)
    expect(
      computeLastKnownQty({
        inStock: true,
        quantities: [],
        previousLastKnownQty: 4,
        preservePreviousOnEmptyOrZero: true,
      }),
    ).toBe(4)
  })

  it('ghost zero is always due and first in queue', () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z')
    const ghost = product({
      id: 'ghost',
      in_stock: false,
      last_known_qty: 10,
      last_checked: new Date(now - 1000).toISOString(),
    })
    expect(isGhostZeroSuspect(ghost)).toBe(true)
    expect(isProductDueForCheck(ghost, now)).toBe(true)

    const due = selectDueTrackedProducts(
      [
        product({
          id: 'oos',
          in_stock: false,
          last_known_qty: 0,
          last_checked: new Date(now - OOS_TTL_MS * 2).toISOString(),
        }),
        product({
          id: 'low',
          last_known_qty: 2,
          last_checked: new Date(now - LOW_STOCK_TTL_MS * 2).toISOString(),
        }),
        ghost,
      ],
      now,
    )
    expect(due.map((p) => p.id)[0]).toBe('ghost')
  })

  it('high stock defers ~30m; low stock due after ~5m; OOS after 30m', () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z')
    const high = product({
      last_known_qty: 19,
      last_checked: new Date(now - 10 * 60 * 1000).toISOString(),
    })
    expect(isProductDueForCheck(high, now)).toBe(false)
    expect(
      isProductDueForCheck(
        product({
          last_known_qty: 19,
          last_checked: new Date(now - HIGH_STOCK_TTL_MS - 1000).toISOString(),
        }),
        now,
      ),
    ).toBe(true)

    const lowRecent = product({
      last_known_qty: 3,
      last_checked: new Date(now - 60 * 1000).toISOString(),
    })
    expect(isProductDueForCheck(lowRecent, now)).toBe(false)
    expect(
      isProductDueForCheck(
        product({
          last_known_qty: 0,
          last_checked: new Date(now - LOW_STOCK_TTL_MS - 1000).toISOString(),
        }),
        now,
      ),
    ).toBe(false)
    expect(
      isProductDueForCheck(
        product({
          last_known_qty: 0,
          last_checked: new Date(now - OOS_TTL_MS - 1000).toISOString(),
        }),
        now,
      ),
    ).toBe(true)
  })

  it('alta sin last_known_qty entra primera al cron aunque last_checked sea fresco', () => {
    const now = Date.parse('2026-08-16T20:00:00.000Z')
    const fresh = new Date(now - 1000).toISOString()
    const pending = product({
      id: 'rcc1',
      in_stock: true,
      last_known_qty: null,
      last_checked: fresh,
    })
    expect(needsInitialStockSync(pending)).toBe(true)
    expect(isProductDueForCheck(pending, now)).toBe(true)
    const due = selectDueTrackedProducts(
      [
        product({
          id: 'holgado',
          last_known_qty: 19,
          last_checked: new Date(now - HIGH_STOCK_TTL_MS * 2).toISOString(),
        }),
        pending,
      ],
      now,
    )
    expect(due[0]?.id).toBe('rcc1')
  })

  it('selectDue prioritizes restock (qty>0) over OOS', () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z')
    const old = new Date(now - OOS_TTL_MS * 2).toISOString()
    const due = selectDueTrackedProducts(
      [
        product({ id: 'hi', last_known_qty: 4, last_checked: old }),
        product({ id: 'lo', last_known_qty: 0, last_checked: old }),
        product({ id: 'need1', last_known_qty: 1, last_checked: old }),
        product({
          id: 'fresh19',
          last_known_qty: 19,
          last_checked: new Date(now - 1000).toISOString(),
        }),
      ],
      now,
    )
    expect(due.map((p) => p.id)).toEqual(['need1', 'hi', 'lo'])
  })
})
