import { describe, expect, it } from 'vitest'
import { assessVariantMapHealth } from '../../api/_lib/importados-sync/variantMapAssess'
import type { TrackedProduct } from '../../api/_lib/importados-sync/supabase'

function base(partial: Partial<TrackedProduct>): TrackedProduct {
  return {
    id: partial.id ?? '1',
    provider: partial.provider ?? 'lethal',
    product_url: partial.product_url ?? 'https://lethal.gg/products/x',
    shopify_handle: partial.shopify_handle ?? 'x',
    notmid_shopify_variant_id: partial.notmid_shopify_variant_id ?? null,
    notmid_shopify_product_id: partial.notmid_shopify_product_id ?? null,
    variant_map: partial.variant_map ?? null,
    current_price: null,
    in_stock: true,
    last_known_qty: partial.last_known_qty ?? null,
    peso_kg: partial.peso_kg ?? null,
    oos_pending: partial.oos_pending ?? {},
    last_checked: null,
    is_active: true,
  }
}

describe('assessVariantMapHealth', () => {
  it('counts complete / incomplete / monitor_only', () => {
    const report = assessVariantMapHealth([
      base({
        id: 'a',
        notmid_shopify_product_id: '111',
        variant_map: [
          {
            supplierVariantId: 's1',
            option: 'Black',
            notmidVariantId: 'n1',
            sku: null,
          },
        ],
      }),
      base({
        id: 'b',
        notmid_shopify_variant_id: '222',
        variant_map: null,
      }),
      base({
        id: 'c',
        variant_map: null,
      }),
    ])

    expect(report.total).toBe(3)
    expect(report.complete).toBe(1)
    expect(report.incomplete).toBe(1)
    expect(report.monitorOnly).toBe(1)
  })

  it('marks partial map entries as incomplete', () => {
    const report = assessVariantMapHealth([
      base({
        id: 'd',
        notmid_shopify_product_id: '333',
        variant_map: [
          {
            supplierVariantId: '',
            option: 'Red',
            notmidVariantId: 'n2',
            sku: null,
          },
        ],
      }),
    ])
    expect(report.incomplete).toBe(1)
    expect(report.complete).toBe(0)
  })
})
