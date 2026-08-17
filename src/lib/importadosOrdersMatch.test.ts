import { describe, expect, it } from 'vitest'
import {
  buildSupplierVariantUrl,
  buildTrackedIndex,
  expandSupplierUrls,
  lineRevenueArs,
  lineStillNeedsFulfillment,
  mapShopifyLineToOrderLine,
  resolveTrackedForLine,
} from '../../api/_lib/importados-sync/importadosOrders'
import type { TrackedProduct } from '../../api/_lib/importados-sync/supabase'
import { mergeOrderLines, type ImportadosOrderRow } from './importadosOrdersApi'

function product(partial: Partial<TrackedProduct>): TrackedProduct {
  return {
    id: partial.id ?? 'tp-1',
    provider: partial.provider ?? 'lethal',
    product_url: partial.product_url ?? 'https://lethal.gg/products/foo?_pos=1&_sid=abc',
    shopify_handle: partial.shopify_handle ?? 'foo',
    notmid_shopify_variant_id: partial.notmid_shopify_variant_id ?? null,
    notmid_shopify_product_id: partial.notmid_shopify_product_id ?? '8001',
    variant_map: partial.variant_map ?? null,
    current_price: partial.current_price ?? 45,
    in_stock: true,
    last_known_qty: 10,
    peso_kg: partial.peso_kg ?? 0.8,
    oos_pending: {},
    last_checked: null,
    is_active: true,
  }
}

const dual = product({
  variant_map: [
    {
      supplierVariantId: '463111111',
      option: 'Black',
      notmidVariantId: '9001',
      sku: 'FOO-BLACK',
    },
    {
      supplierVariantId: '463222222',
      option: 'Black / Gold',
      notmidVariantId: '9002',
      sku: 'FOO-GOLD',
    },
  ],
})

describe('importados order variant matching', () => {
  it('links the exact supplier variant from notmid variant_id', () => {
    const index = buildTrackedIndex([dual])
    const mapped = mapShopifyLineToOrderLine(
      '1',
      {
        id: 11,
        product_id: 8001,
        variant_id: 9002,
        title: 'Foo',
        variant_title: 'Black / Gold',
        quantity: 3,
        fulfillable_quantity: 3,
      },
      index,
      3,
    )
    expect(mapped.supplierVariantId).toBe('463222222')
    expect(mapped.notmidVariantId).toBe('9002')
    expect(mapped.unmatchedVariant).toBe(false)
    expect(mapped.supplierUrls).toEqual([
      'https://lethal.gg/products/foo?variant=463222222',
      'https://lethal.gg/products/foo?variant=463222222',
      'https://lethal.gg/products/foo?variant=463222222',
    ])
  })

  it('does not fuzzy-match Black against Black / Gold', () => {
    const index = buildTrackedIndex([dual])
    const goldish = resolveTrackedForLine(
      { product_id: 8001, variant_title: 'Black' },
      index,
    )
    expect(goldish?.entry?.supplierVariantId).toBe('463111111')
    expect(goldish?.entry?.option).toBe('Black')
  })

  it('leaves multi-variant lines without a URL when the variant is unknown', () => {
    const index = buildTrackedIndex([dual])
    const mapped = mapShopifyLineToOrderLine(
      '1',
      {
        id: 12,
        product_id: 8001,
        variant_id: 9999,
        title: 'Foo',
        variant_title: 'Unknown color',
        quantity: 1,
        fulfillable_quantity: 1,
      },
      index,
      1,
    )
    expect(mapped.trackedProductId).toBe('tp-1')
    expect(mapped.unmatchedVariant).toBe(true)
    expect(mapped.supplierUrls).toEqual([])
  })

  it('opens one tab per fulfillable unit', () => {
    expect(lineStillNeedsFulfillment({ quantity: 5, fulfillable_quantity: 3 })).toBe(3)
    expect(expandSupplierUrls('https://lethal.gg/products/foo?variant=1', 3)).toEqual([
      'https://lethal.gg/products/foo?variant=1',
      'https://lethal.gg/products/foo?variant=1',
      'https://lethal.gg/products/foo?variant=1',
    ])
  })

  it('uses SKU as exact fallback', () => {
    const index = buildTrackedIndex([dual])
    const hit = resolveTrackedForLine(
      { product_id: 8001, sku: 'FOO-GOLD' },
      index,
    )
    expect(hit?.entry?.supplierVariantId).toBe('463222222')
  })
})

describe('mergeOrderLines', () => {
  it('does not merge two variants that share a product title', () => {
    const order: ImportadosOrderRow = {
      orderId: '1',
      orderName: '#100',
      createdAt: '',
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      adminUrl: '',
      allSupplierUrls: [],
      lines: [
        {
          lineItemId: 'a',
          title: 'Foo',
          variantTitle: 'Black',
          quantity: 1,
          supplierUrls: [buildSupplierVariantUrl(dual.product_url, '463111111')],
          provider: 'lethal',
          trackedProductId: 'tp-1',
          notmidVariantId: '9001',
          supplierVariantId: '463111111',
          unmatchedVariant: false,
        },
        {
          lineItemId: 'b',
          title: 'Foo',
          variantTitle: 'Black / Gold',
          quantity: 2,
          supplierUrls: [
            buildSupplierVariantUrl(dual.product_url, '463222222'),
            buildSupplierVariantUrl(dual.product_url, '463222222'),
          ],
          provider: 'lethal',
          trackedProductId: 'tp-1',
          notmidVariantId: '9002',
          supplierVariantId: '463222222',
          unmatchedVariant: false,
        },
      ],
    }
    const merged = mergeOrderLines(order)
    expect(merged).toHaveLength(2)
    expect(merged[1]?.quantity).toBe(2)
    expect(merged[1]?.supplierUrls).toHaveLength(2)
  })
})

describe('lineRevenueArs', () => {
  it('subtracts allocated discount from unit price × qty', () => {
    expect(
      lineRevenueArs({ price: '100000.0', quantity: 2, total_discount: '10000.00' }),
    ).toBe(190000)
  })
})
