import { describe, expect, it } from 'vitest'
import {
  applySalePriceRounding,
  bedTimeToTotalMinutes,
  computePrinting3D,
  coercePrinting3DPrinterConfig,
  DEFAULT_PRINTING_3D_INPUTS,
  DEFAULT_PRINTING_3D_PRINTER_CONFIG,
  DEFAULT_PRINTING_3D_QUOTE_INPUTS,
  formatBedPrintTimeLabel,
  mergePrinting3DInputs,
  roundSalePrice,
  totalMinutesToBedTime,
} from './printing3dCalc'

describe('printing3dCalc', () => {
  it('calcula costos unitarios y totales con valores por defecto', () => {
    const result = computePrinting3D(DEFAULT_PRINTING_3D_INPUTS)
    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.costoGramo).toBe(15)
    expect(result.gramosPorPieza).toBe(30)
    expect(result.costoMaterialPieza).toBe(450)
    expect(result.horasPieza).toBe(3.5)
    expect(result.costoDepreciacionPieza).toBeCloseTo(350, 5)
    expect(result.costoLuzPieza).toBeCloseTo(57.75, 5)
    expect(result.costoManoObraPieza).toBeCloseTo(833.333, 2)
    expect(result.subtotalPieza).toBeCloseTo(1691.083, 2)
    expect(result.costoUnitarioFinal).toBeCloseTo(1775.637, 2)
    expect(result.precioVentaUnitario).toBeCloseTo(2536.624, 2)
    expect(result.gananciaNetaTotal).toBeCloseTo(760.987, 2)
    expect(result.camasTotales).toBe(1)
    expect(result.filamentoTotalGramos).toBe(30)
    expect(result.rollosRequeridos).toBeCloseTo(0.03, 5)
  })

  it('reparte purga y tiempo entre piezas por cama', () => {
    const result = computePrinting3D({
      ...DEFAULT_PRINTING_3D_INPUTS,
      piezasPorCama: 4,
      cantidadTotalUnidades: 10,
      pesoPurgaCama: 8,
      horasCama: 2,
      minutosCama: 0,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.gramosPorPieza).toBe(27)
    expect(result.horasPieza).toBe(0.5)
    expect(result.camasTotales).toBe(3)
    expect(result.filamentoTotalGramos).toBe(270)
  })

  it('rechaza división por cero y ganancia del 100%', () => {
    const zeroRoll = computePrinting3D({
      ...DEFAULT_PRINTING_3D_INPUTS,
      pesoRolloGramos: 0,
    })
    expect(zeroRoll.valid).toBe(false)

    const fullMargin = computePrinting3D({
      ...DEFAULT_PRINTING_3D_INPUTS,
      porcentajeGanancia: 100,
    })
    expect(fullMargin.valid).toBe(false)

    const zeroPieces = computePrinting3D({
      ...DEFAULT_PRINTING_3D_INPUTS,
      piezasPorCama: 0,
    })
    expect(zeroPieces.valid).toBe(false)
  })

  it('incluye reserva de fallos en el desglose', () => {
    const result = computePrinting3D({
      ...DEFAULT_PRINTING_3D_INPUTS,
      porcentajeFallos: 10,
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.breakdown.reservaFallos).toBeCloseTo(result.subtotalPieza * 0.1, 5)
    expect(result.costoUnitarioFinal).toBeCloseTo(result.subtotalPieza * 1.1, 5)
  })

  it('combina config fija y cotización', () => {
    const merged = mergePrinting3DInputs(
      { ...DEFAULT_PRINTING_3D_PRINTER_CONFIG, precioRollo: 20000 },
      { ...DEFAULT_PRINTING_3D_QUOTE_INPUTS, pesoPieza: 40 },
    )
    const result = computePrinting3D(merged)
    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.costoGramo).toBe(20)
    expect(result.gramosPorPieza).toBe(45)
  })

  it('formatea y convierte tiempo de cama', () => {
    expect(bedTimeToTotalMinutes(6, 30)).toBe(390)
    expect(totalMinutesToBedTime(390)).toEqual({ horasCama: 6, minutosCama: 30 })
    expect(formatBedPrintTimeLabel(6, 30)).toBe('6 h 30 min')
    expect(formatBedPrintTimeLabel(2, 0)).toBe('2 h')
    expect(formatBedPrintTimeLabel(0, 45)).toBe('45 min')
  })

  it('normaliza config parcial desde json', () => {
    expect(coercePrinting3DPrinterConfig({ precioRollo: 22000, consumoWatts: 'bad' })).toEqual({
      ...DEFAULT_PRINTING_3D_PRINTER_CONFIG,
      precioRollo: 22000,
    })
  })

  it('redondea precio de venta al paso elegido', () => {
    const result = computePrinting3D(DEFAULT_PRINTING_3D_INPUTS)
    expect(result.valid).toBe(true)
    if (!result.valid) return

    const rounded500 = applySalePriceRounding(result, 5, 500)
    expect(rounded500.precioVentaUnitario % 500).toBe(0)
    expect(rounded500.precioVentaTotal).toBe(rounded500.precioVentaUnitario * 5)

    const rounded1000 = applySalePriceRounding(result, 1, 1000)
    expect(rounded1000.precioVentaUnitario % 1000).toBe(0)
    expect(roundSalePrice(12783.75, 500)).toBe(13000)
    expect(roundSalePrice(12783.75, 1000)).toBe(13000)
  })
})
