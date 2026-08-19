import { describe, expect, it } from 'vitest'
import {
  AEROBOX_USD_PER_KG,
  computeImportados,
  CUOTAS_MP_COEFFICIENT,
  CUOTAS_MP_NET_FACTOR,
  DEFAULT_ENVIO_DOMICILIO_USD,
  DEFAULT_IMPORTADOS_INPUTS,
  ENVIO_NACIONAL_ARS,
  HANDLING_AEROBOX_USD,
  normalizeStorePriceArs,
  precioCuotasFromContadoArs,
  resolveImportadosCantidad,
  resolveImportadosMargin,
  TASA_ESTADISTICA_RATE,
} from './importadosCalc'

describe('importadosCalc', () => {
  it('resolveImportadosMargin picks volume bands', () => {
    expect(resolveImportadosMargin(20)).toEqual({
      label: '< $50 · 18%',
      marginRate: 0.18,
      fixedUsd: 0,
    })
    expect(resolveImportadosMargin(49.99).marginRate).toBe(0.18)
    expect(resolveImportadosMargin(50).marginRate).toBe(0.14)
    expect(resolveImportadosMargin(120).marginRate).toBe(0.14)
    expect(resolveImportadosMargin(120.01).marginRate).toBe(0.12)
    expect(resolveImportadosMargin(250).marginRate).toBe(0.12)
  })

  it('resolveImportadosCantidad keeps 1 unless quantity mode', () => {
    expect(resolveImportadosCantidad(false, 10)).toBe(1)
    expect(resolveImportadosCantidad(true, 10)).toBe(10)
    expect(resolveImportadosCantidad(true, 2.9)).toBe(2)
    expect(resolveImportadosCantidad(true, 1)).toBe(2)
  })

  it('prorratea flete/handling, aplica 3% CIF y forma precios en ARS', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      fleteInternoUsd: 0,
      dolarArs: 1350,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const fleteUnit = 0.3 * AEROBOX_USD_PER_KG
    const cif = 50 + fleteUnit
    const estadistica = cif * TASA_ESTADISTICA_RATE
    const landedUsd = 50 + fleteUnit + HANDLING_AEROBOX_USD + estadistica
    const landedArs = landedUsd * 1350
    const subtotalArs = landedArs / (1 - 0.14)
    const envioArs = ENVIO_NACIONAL_ARS
    const contadoArs = normalizeStorePriceArs(subtotalArs + envioArs)
    const cuotasArs = normalizeStorePriceArs(subtotalArs / (1 - CUOTAS_MP_COEFFICIENT) + envioArs)

    expect(result.cantidad).toBe(1)
    expect(result.dolarMepConvertido).toBe(1350)
    expect(result.fleteUnitarioUsd).toBeCloseTo(fleteUnit, 6)
    expect(result.baseCifUsd).toBeCloseTo(cif, 6)
    expect(result.gastosNoRecuperablesUsd).toBeCloseTo(estadistica, 6)
    expect(result.costoLandedUsd).toBeCloseTo(landedUsd, 6)
    expect(result.impuestosTransaccionalesUsd).toBe(0)
    expect(result.bufferFinancieroUsd).toBe(0)
    expect(result.precioContadoArs).toBe(contadoArs)
    expect(result.precioCuotasArs).toBe(cuotasArs)
    expect(result.margin.marginRate).toBe(0.14)
  })

  it('amortizes courier freight and handling across quantity; national shipping is after margin', () => {
    const qty = 10
    const unitCost = 12
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: unitCost,
      pesoKg: 3,
      fleteInternoUsd: 8,
      dolarArs: 1000,
      cotizarEnCantidad: true,
      cantidad: qty,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const fleteLote = 3 * AEROBOX_USD_PER_KG + 8
    const fleteUnit = fleteLote / qty
    const handlingUnit = HANDLING_AEROBOX_USD / qty
    const cif = unitCost + fleteUnit
    const estadistica = cif * TASA_ESTADISTICA_RATE
    const landedUnitUsd = unitCost + fleteUnit + handlingUnit + estadistica
    const landedUnitArs = landedUnitUsd * 1000
    const subtotalUnitArs = landedUnitArs / (1 - 0.18)
    const envioUnitArs = ENVIO_NACIONAL_ARS / qty
    const contadoArs = normalizeStorePriceArs(subtotalUnitArs + envioUnitArs)

    expect(result.cantidad).toBe(10)
    expect(result.handlingAeroboxUsd).toBe(HANDLING_AEROBOX_USD)
    expect(result.handlingAeroboxUnitUsd).toBeCloseTo(handlingUnit, 6)
    expect(result.fleteUnitarioUsd).toBeCloseTo(fleteUnit, 6)
    expect(result.envioNacionalUnitArs).toBeCloseTo(envioUnitArs, 6)
    expect(result.margin.marginRate).toBe(0.18)
    expect(result.precioContadoArs).toBe(contadoArs)
    expect(result.precioContadoLoteArs).toBe(result.precioContadoArs * qty)
    expect(result.costoLandedUsd).toBeCloseTo(landedUnitUsd * qty, 6)
  })

  it('rejects quantity mode with less than 2 units', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 12,
      cotizarEnCantidad: true,
      cantidad: 1,
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors[0]).toMatch(/cantidad/i)
  })

  it('precioCuotasFromContadoArs uses (1 − 0.2203) divisor', () => {
    expect(CUOTAS_MP_NET_FACTOR).toBeCloseTo(0.7797, 6)
    expect(precioCuotasFromContadoArs(100000)).toBe(Math.round(100000 / (1 - CUOTAS_MP_COEFFICIENT)))
    expect(precioCuotasFromContadoArs(453500)).toBe(Math.round(453500 / (1 - CUOTAS_MP_COEFFICIENT)))
  })

  it('normalizes store ARS prices to nearest 500', () => {
    expect(normalizeStorePriceArs(453374.12)).toBe(453500)
    expect(normalizeStorePriceArs(454000)).toBe(454000)
    expect(normalizeStorePriceArs(453750)).toBe(454000)
    expect(normalizeStorePriceArs(999)).toBe(1000)
  })

  it('uses 18% margin on landed ARS (sell-side) under $50 FOB', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 25,
      pesoKg: 0.3,
      dolarArs: 1000,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const flete = 0.3 * AEROBOX_USD_PER_KG
    const cif = 25 + flete
    const landedUsd = 25 + flete + HANDLING_AEROBOX_USD + cif * TASA_ESTADISTICA_RATE
    const landedArs = landedUsd * 1000
    const subtotalArs = landedArs / (1 - 0.18)
    expect(result.costoLandedUnitArs).toBeCloseTo(landedArs, 6)
    expect(result.subtotalConMargenArs).toBeCloseTo(subtotalArs, 6)
    expect(result.margin.fixedUsd).toBe(0)
    expect(result.margin.marginRate).toBe(0.18)
  })

  it('adds fixed national shipping after margin, not inside landed cost', () => {
    const base = {
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      dolarArs: 1000,
    }
    const single = computeImportados(base)
    const batch = computeImportados({ ...base, cotizarEnCantidad: true, cantidad: 5 })
    expect(single.valid && batch.valid).toBe(true)
    if (!single.valid || !batch.valid) return
    expect(single.envioNacionalUnitArs).toBe(ENVIO_NACIONAL_ARS)
    expect(batch.envioNacionalUnitArs).toBeCloseTo(ENVIO_NACIONAL_ARS / 5, 6)
    expect(single.costoLandedUsd).toBeLessThan(batch.costoLandedUsd)
    expect(single.precioContadoArs).toBeGreaterThan(batch.precioContadoArs)
  })

  it('defaults envio nacional to 10500 ARS and handling to 1.50', () => {
    expect(ENVIO_NACIONAL_ARS).toBe(10_500)
    expect(DEFAULT_IMPORTADOS_INPUTS.envioDomicilioUsd).toBe(15)
    expect(HANDLING_AEROBOX_USD).toBe(1.5)
    expect(DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg).toBe(20)
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
    expect(result.fleteUnitarioUsd).toBe(40)
  })
})
