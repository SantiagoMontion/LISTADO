import { describe, expect, it } from 'vitest'
import {
  buildSupplierVariantUrl,
  shopifyNextPagePath,
} from '../../api/_lib/importados-sync/importadosOrders'

describe('buildSupplierVariantUrl', () => {
  it('keeps the product path and sets the exact supplier variant', () => {
    expect(
      buildSupplierVariantUrl(
        'https://lethal.gg/products/foo-bar?_pos=1&_sid=abc&_ss=r',
        '46339218735276',
      ),
    ).toBe('https://lethal.gg/products/foo-bar?variant=46339218735276')
  })

  it('works for mechanicalkeyboards without inventing a brand', () => {
    expect(
      buildSupplierVariantUrl(
        'https://mechanicalkeyboards.com/products/mk-x-wlmouse-strider-wireless-8k-mouse?variant=999',
        '50596200612140',
      ),
    ).toBe(
      'https://mechanicalkeyboards.com/products/mk-x-wlmouse-strider-wireless-8k-mouse?variant=50596200612140',
    )
  })

  it('opens the product page even when variant id is missing', () => {
    expect(
      buildSupplierVariantUrl('https://lethal.gg/products/foo-bar?_pos=4', null),
    ).toBe('https://lethal.gg/products/foo-bar')
  })
})

describe('shopifyNextPagePath', () => {
  it('reads the next cursor from Shopify Link headers', () => {
    expect(
      shopifyNextPagePath(
        '<https://notmid.myshopify.com/admin/api/2024-10/orders.json?limit=250&page_info=abc123>; rel="next"',
      ),
    ).toBe('orders.json?limit=250&page_info=abc123')
  })

  it('returns null when there is no next page', () => {
    expect(
      shopifyNextPagePath(
        '<https://notmid.myshopify.com/admin/api/2024-10/orders.json?limit=250&page_info=zzz>; rel="previous"',
      ),
    ).toBeNull()
  })
})
