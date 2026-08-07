import { describe, expect, it } from 'vitest'
import {
  AEROBOX_USD_PER_KG,
  BUFFER_FINANCIERO_RATE,
  computeImportados,
  CUOTAS_MP_NET_FACTOR,
  DEFAULT_ENVIO_DOMICILIO_USD,
  DEFAULT_IMPORTADOS_INPUTS,
  DOLAR_MEP_BUFFER_RATE,
  GASTOS_NO_RECUPERABLES_RATE,
  HANDLING_AEROBOX_USD,
  IMPUESTOS_TRANSACCIONALES_RATE,
  normalizeStorePriceArs,
  precioCuotasFromContadoArs,
  resolveImportadosMargin,
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

  it('converts ARS with MEP+2% and blinds cuotas with MP factor', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      fleteInternoUsd: 0,
      envioDomicilioUsd: 12,
      dolarArs: 1350,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const aerobox = 0.3 * AEROBOX_USD_PER_KG
    const base = 50 + aerobox
    const noRecup = base * GASTOS_NO_RECUPERABLES_RATE
    const bufferFinanciero = base * BUFFER_FINANCIERO_RATE
    const envioDom = 12
    const landed = base + HANDLING_AEROBOX_USD + noRecup + envioDom
    const friccion = landed * (1 + IMPUESTOS_TRANSACCIONALES_RATE)
    const subtotal = friccion * 1.14
    const precioUsd = subtotal + bufferFinanciero
    const dolarConv = 1350 * (1 + DOLAR_MEP_BUFFER_RATE)
    const contadoArs = normalizeStorePriceArs(precioUsd * dolarConv)
    const cuotasArs = Math.round(contadoArs / CUOTAS_MP_NET_FACTOR)

    expect(result.dolarMepConvertido).toBeCloseTo(dolarConv, 6)
    expect(result.precioContadoUsd).toBeCloseTo(precioUsd, 6)
    expect(result.precioContadoArs).toBe(contadoArs)
    expect(result.precioCuotasArs).toBe(cuotasArs)
    expect(result.precioCuotasArs).toBe(precioCuotasFromContadoArs(result.precioContadoArs))
    expect(result.bufferFinancieroUsd).toBeCloseTo(bufferFinanciero, 6)
    expect(result.margin.marginRate).toBe(0.14)
  })

  it('precioCuotasFromContadoArs uses 0.7797 divisor', () => {
    expect(precioCuotasFromContadoArs(100000)).toBe(Math.round(100000 / 0.7797))
    expect(precioCuotasFromContadoArs(453500)).toBe(Math.round(453500 / 0.7797))
  })

  it('normalizes store ARS prices to nearest 500', () => {
    expect(normalizeStorePriceArs(453374.12)).toBe(453500)
    expect(normalizeStorePriceArs(454000)).toBe(454000)
    expect(normalizeStorePriceArs(453750)).toBe(454000)
    expect(normalizeStorePriceArs(999)).toBe(1000)
  })

  it('uses 18% margin and 7.5% liquidity buffer under $50', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 25,
      pesoKg: 0.3,
      envioDomicilioUsd: 12,
      dolarArs: 1000,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const base = 25 + 0.3 * AEROBOX_USD_PER_KG
    const landed = base + HANDLING_AEROBOX_USD + base * GASTOS_NO_RECUPERABLES_RATE + 12
    const friccion = landed * (1 + IMPUESTOS_TRANSACCIONALES_RATE)
    const subtotal = friccion * 1.18
    const precio = subtotal + base * BUFFER_FINANCIERO_RATE
    expect(result.subtotalConMargenUsd).toBeCloseTo(subtotal, 6)
    expect(result.precioContadoUsd).toBeCloseTo(precio, 6)
    expect(result.margin.fixedUsd).toBe(0)
    expect(result.margin.marginRate).toBe(0.18)
  })

  it('uses editable fixed domestic shipping USD', () => {
    const base = {
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      dolarArs: 1000,
    }
    const low = computeImportados({ ...base, envioDomicilioUsd: 8 })
    const high = computeImportados({ ...base, envioDomicilioUsd: 23 })
    expect(low.valid && high.valid).toBe(true)
    if (!low.valid || !high.valid) return
    expect(low.envioDomicilioUsd).toBe(8)
    expect(high.envioDomicilioUsd).toBe(23)
    expect(high.costoLandedUsd - low.costoLandedUsd).toBeCloseTo(15, 6)
  })

  it('defaults envio domicilio to 15 USD and handling to 1.50', () => {
    expect(DEFAULT_ENVIO_DOMICILIO_USD).toBe(15)
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
  })
})
