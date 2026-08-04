import { describe, expect, it } from 'vitest'
import {
  AEROBOX_USD_PER_KG,
  computeImportados,
  DEFAULT_IMPORTADOS_INPUTS,
  GASTOS_NO_RECUPERABLES_RATE,
  PERCEPCIONES_RECUPERABLES_RATE,
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

  it('applies margin only on operating cost, not on recoverable perceptions', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      fleteInternoUsd: 0,
      dolarArs: 1350,
      recargoCuotasPct: 20,
      destinoEnvio: 'provincia',
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const aerobox = 0.3 * AEROBOX_USD_PER_KG
    const base = 50 + aerobox
    const noRecup = base * GASTOS_NO_RECUPERABLES_RATE
    const percep = base * PERCEPCIONES_RECUPERABLES_RATE
    const envioDom = 12
    const operativo = base + noRecup + envioDom
    const subtotal = operativo * 1.3
    const precio = subtotal + percep

    expect(result.baseImponibleUsd).toBeCloseTo(base, 6)
    expect(result.gastosNoRecuperablesUsd).toBeCloseTo(noRecup, 6)
    expect(result.percepcionesRecuperablesUsd).toBeCloseTo(percep, 6)
    expect(result.costoRealOperativoUsd).toBeCloseTo(operativo, 6)
    expect(result.subtotalConMargenUsd).toBeCloseTo(subtotal, 6)
    expect(result.precioContadoUsd).toBeCloseTo(precio, 6)
    expect(result.gananciaNetaUsd).toBeCloseTo(subtotal - operativo, 6)
    expect(result.precioContadoArs).toBeCloseTo(precio * 1350, 4)
    expect(result.precioCuotasArs).toBeCloseTo(precio * 1350 * 1.2, 4)
  })

  it('adds $10 fixed margin for products <= $30 on operating cost only', () => {
    const result = computeImportados({
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 25,
      pesoKg: 0.3,
      dolarArs: 1000,
      recargoCuotasPct: 20,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const base = 25 + 0.3 * AEROBOX_USD_PER_KG
    const operativo = base + base * GASTOS_NO_RECUPERABLES_RATE + 12
    const subtotal = operativo * 1.4 + 10
    const precio = subtotal + base * PERCEPCIONES_RECUPERABLES_RATE
    expect(result.subtotalConMargenUsd).toBeCloseTo(subtotal, 6)
    expect(result.precioContadoUsd).toBeCloseTo(precio, 6)
    expect(result.margin.fixedUsd).toBe(10)
  })

  it('applies domestic Argentina shipping by destination on operating cost', () => {
    const base = {
      ...DEFAULT_IMPORTADOS_INPUTS,
      costoProductoUsd: 50,
      pesoKg: 0.3,
      dolarArs: 1000,
    }
    const caba = computeImportados({ ...base, destinoEnvio: 'caba' })
    const interior = computeImportados({ ...base, destinoEnvio: 'interior' })
    expect(caba.valid && interior.valid).toBe(true)
    if (!caba.valid || !interior.valid) return
    expect(caba.envioDomicilioUsd).toBe(8)
    expect(interior.envioDomicilioUsd).toBe(23)
    expect(interior.costoRealOperativoUsd - caba.costoRealOperativoUsd).toBeCloseTo(15, 6)
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
