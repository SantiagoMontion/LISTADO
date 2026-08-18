import { describe, expect, it } from 'vitest'
import {
  envioDomicilioOlaUsd,
  handlingOlaUsd,
  OLA_AEROBOX_USD_KG,
  OLA_REF_UNITS,
  resolveImportadosKind,
  shopifyArsFromSupplierUsd,
  syncImportadosQuoteInputs,
} from '../../api/_lib/importados-sync/importadosPricing'

describe('importadosPricing ola', () => {
  it('prorratea handling y guía AR entre OLA_REF_UNITS', () => {
    expect(handlingOlaUsd()).toBeCloseTo(1.5 / OLA_REF_UNITS, 6)
    expect(envioDomicilioOlaUsd('mouse')).toBeCloseTo(15 / OLA_REF_UNITS + 4, 6)
    expect(envioDomicilioOlaUsd('teclado')).toBeCloseTo(15 / OLA_REF_UNITS + 7, 6)
  })

  it('usa Aerobox 19 USD/kg en sync defaults', () => {
    const inputs = syncImportadosQuoteInputs({
      costoProductoUsd: 24.99,
      pesoKg: 0.4,
      dolarArs: 1521.6,
      kind: 'mouse',
    })
    expect(inputs.aeroboxUsdPorKg).toBe(OLA_AEROBOX_USD_KG)
    expect(inputs.envioDomicilioUsd).toBe(envioDomicilioOlaUsd('mouse'))
  })

  it('clasifica kind por handle/título', () => {
    expect(resolveImportadosKind('beast-g-wireless-gaming-mouse', 'BEAST G')).toBe('mouse')
    expect(resolveImportadosKind('luminkey75-v2-he-aurora', 'Luminkey75 HE')).toBe('teclado')
    expect(resolveImportadosKind('superglide-glass-mousepad-1', 'Superglide')).toBe('mousepad')
  })

  it('precio ola Dragonfly baja vs unitario legacy', () => {
    const dolarArs = 1521.6
    const ola = shopifyArsFromSupplierUsd({
      costoProductoUsd: 24.99,
      pesoKg: 0.4,
      dolarArs,
      kind: 'mouse',
    })
    expect(ola).toBeGreaterThan(90000)
    expect(ola).toBeLessThan(110000)
  })
})
