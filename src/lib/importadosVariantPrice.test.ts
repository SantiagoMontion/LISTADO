import { describe, expect, it } from 'vitest'
import {
  pricesArsEqual,
  shopifyArsFromSupplierUsd,
} from '../../api/_lib/importados-sync/importadosPricing'
import { pesoKgForNotmidVariant, pesoKgFromTracked, variantMapWithPesoKg } from '../../api/_lib/importados-sync/supabase'

describe('per-variant shopify pricing', () => {
  it('prices Canvas/White differently for same peso+MEP', () => {
    const pesoKg = 0.5
    const dolarArs = 1500
    const white = shopifyArsFromSupplierUsd({
      costoProductoUsd: 45,
      pesoKg,
      dolarArs,
    })
    const canvas = shopifyArsFromSupplierUsd({
      costoProductoUsd: 60,
      pesoKg,
      dolarArs,
    })
    expect(canvas).toBeGreaterThan(white)
    expect(pricesArsEqual(white, canvas)).toBe(false)
  })

  it('reads Hub peso from column or variant_map, never Shopify', () => {
    expect(pesoKgFromTracked({ peso_kg: 1.85, variant_map: [] })).toBe(1.85)
    expect(
      pesoKgFromTracked({
        peso_kg: null,
        variant_map: variantMapWithPesoKg(
          [{ supplierVariantId: '1', option: 'A', notmidVariantId: '2', sku: null }],
          0.6,
        ),
      }),
    ).toBe(0.6)
    expect(pesoKgFromTracked({ peso_kg: null, variant_map: [] })).toBeNull()
  })

  it('prices SuperGlide sizes with per-variant kg', () => {
    const product = {
      peso_kg: null as number | null,
      variant_map: [
        { supplierVariantId: 's1', option: 'L', notmidVariantId: 'n1', sku: null, peso_kg: 2.7 },
        { supplierVariantId: 's2', option: 'XXL', notmidVariantId: 'n2', sku: null, peso_kg: 5.36 },
      ],
    }
    expect(pesoKgForNotmidVariant(product, 'n1')).toBe(2.7)
    expect(pesoKgForNotmidVariant(product, 'n2')).toBe(5.36)
    expect(pesoKgForNotmidVariant({ ...product, peso_kg: 5.36 }, 'n1')).toBe(2.7)
  })
})
