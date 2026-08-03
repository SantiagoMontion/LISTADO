import { describe, expect, it } from 'vitest'
import {
  AEROBOX_USD_PER_KG,
  computeImportados,
  DEFAULT_IMPORTADOS_INPUTS,
  IMPUESTOS_SA_RATE,
  resolveImportadosMargin,
} from './importadosCalc'

describe('importadosCalc', () => {
  it('resolveImportadosMargin picks bands', () => {
    expect(resolveImportadosMargin(20)).toEqual({
      label: '≤ $30 · 40% + $10',
      marginRate: 0.4,
      fixedUsd: 10,
    })
    expect(resolveImportadosMargin(30).marginRate).toBe(0.4)
    expect(resolveImportadosMargin(31).marginRate).toBe(0.3)
    expect(resolveImportadosMargin(100).marginRate).toBe(0.3)
    expect(resolveImportadosMargin(101).marginRate).toBe(0.22)
    expect(resolveImportadosMargin(250).marginRate).toBe(0.22)
    expect(resolveImportadosMargin(251).marginRate).toBe(0.18)
  })

  it('computes landed, margin and ARS prices for a mid-range product', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      fleteInternoUsd: 0,
      dolarArs: 1350,
      recargoCuotasPct: 20,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const aerobox = 0.3 * AEROBOX_USD_PER_KG
    const impuestos = (50 + 0 + aerobox) * IMPUESTOS_SA_RATE
    const landed = 50 + 0 + aerobox + impuestos
    const precioUsd = landed * 1.3
    expect(result.fleteAeroboxUsd).toBeCloseTo(aerobox, 6)
    expect(result.impuestosSaUsd).toBeCloseTo(impuestos, 6)
    expect(result.costoLandedUsd).toBeCloseTo(landed, 6)
    expect(result.margin.marginRate).toBe(0.3)
    expect(result.margin.fixedUsd).toBe(0)
    expect(result.precioContadoUsd).toBeCloseTo(precioUsd, 6)
    expect(result.gananciaNetaUsd).toBeCloseTo(precioUsd - landed, 6)
    expect(result.precioContadoArs).toBeCloseTo(precioUsd * 1350, 4)
    expect(result.precioCuotasArs).toBeCloseTo(precioUsd * 1350 * 1.2, 4)
  })

  it('adds $10 fixed margin for products <= $30', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 25,
      pesoKg: 0.3,
      dolarArs: 1000,
      recargoCuotasPct: 20,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const aerobox = 0.3 * AEROBOX_USD_PER_KG
    const impuestos = (25 + aerobox) * IMPUESTOS_SA_RATE
    const landed = 25 + aerobox + impuestos
    expect(result.precioContadoUsd).toBeCloseTo(landed * 1.4 + 10, 6)
    expect(result.margin.fixedUsd).toBe(10)
  })

  it('rejects missing product cost', () => {
    const result = computeImportados(DEFAULT_IMPORTADOS_INPUTS)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors[0]).toMatch(/costo del producto/i)
  })

  it('uses editable Aerobox USD/kg and ignores volume (weight only)', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 40,
      pesoKg: 2,
      aeroboxUsdPorKg: 20,
      dolarArs: 1000,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.fleteAeroboxUsd).toBe(40)
  })
})
