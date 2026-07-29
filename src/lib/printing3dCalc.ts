export interface Printing3DInputs {
  precioRollo: number
  pesoRolloGramos: number
  pesoPieza: number
  pesoPurgaCama: number
  valorImpresora: number
  vidaUtilHoras: number
  consumoWatts: number
  costoKwh: number
  horasCama: number
  minutosCama: number
  piezasPorCama: number
  cantidadTotalUnidades: number
  costoHoraTrabajo: number
  minutosPostproceso: number
  insumosExtraPieza: number
  porcentajeFallos: number
  porcentajeGanancia: number
}

export interface Printing3DUnitBreakdown {
  costoFilamento: number
  costoElectricidad: number
  costoDepreciacion: number
  costoManoObra: number
  insumosExtra: number
  reservaFallos: number
}

export interface Printing3DResults {
  valid: true
  costoGramo: number
  gramosPorPieza: number
  horasPieza: number
  costoMaterialPieza: number
  costoDepreciacionPieza: number
  costoLuzPieza: number
  costoManoObraPieza: number
  subtotalPieza: number
  costoUnitarioFinal: number
  precioVentaUnitario: number
  costoTotalProduccion: number
  precioVentaTotal: number
  gananciaNetaTotal: number
  margenRealPorcentaje: number
  horasTotalesMaquinado: number
  camasTotales: number
  filamentoTotalGramos: number
  rollosRequeridos: number
  breakdown: Printing3DUnitBreakdown
}

export interface Printing3DInvalidResults {
  valid: false
  errors: string[]
}

export type Printing3DCalcOutput = Printing3DResults | Printing3DInvalidResults

export const DEFAULT_PRINTING_3D_INPUTS: Printing3DInputs = {
  precioRollo: 15000,
  pesoRolloGramos: 1000,
  pesoPieza: 25,
  pesoPurgaCama: 5,
  valorImpresora: 500000,
  vidaUtilHoras: 5000,
  consumoWatts: 110,
  costoKwh: 150,
  horasCama: 3,
  minutosCama: 30,
  piezasPorCama: 1,
  cantidadTotalUnidades: 1,
  costoHoraTrabajo: 5000,
  minutosPostproceso: 10,
  insumosExtraPieza: 0,
  porcentajeFallos: 5,
  porcentajeGanancia: 30,
}

export type Printing3DPrinterConfig = Pick<
  Printing3DInputs,
  | 'precioRollo'
  | 'pesoRolloGramos'
  | 'pesoPurgaCama'
  | 'valorImpresora'
  | 'vidaUtilHoras'
  | 'consumoWatts'
  | 'costoKwh'
  | 'costoHoraTrabajo'
  | 'minutosPostproceso'
  | 'insumosExtraPieza'
  | 'porcentajeFallos'
>

export type Printing3DQuoteInputs = Pick<
  Printing3DInputs,
  | 'pesoPieza'
  | 'horasCama'
  | 'minutosCama'
  | 'piezasPorCama'
  | 'cantidadTotalUnidades'
  | 'porcentajeGanancia'
>

export const DEFAULT_PRINTING_3D_PRINTER_CONFIG: Printing3DPrinterConfig = {
  precioRollo: DEFAULT_PRINTING_3D_INPUTS.precioRollo,
  pesoRolloGramos: DEFAULT_PRINTING_3D_INPUTS.pesoRolloGramos,
  pesoPurgaCama: DEFAULT_PRINTING_3D_INPUTS.pesoPurgaCama,
  valorImpresora: DEFAULT_PRINTING_3D_INPUTS.valorImpresora,
  vidaUtilHoras: DEFAULT_PRINTING_3D_INPUTS.vidaUtilHoras,
  consumoWatts: DEFAULT_PRINTING_3D_INPUTS.consumoWatts,
  costoKwh: DEFAULT_PRINTING_3D_INPUTS.costoKwh,
  costoHoraTrabajo: DEFAULT_PRINTING_3D_INPUTS.costoHoraTrabajo,
  minutosPostproceso: DEFAULT_PRINTING_3D_INPUTS.minutosPostproceso,
  insumosExtraPieza: DEFAULT_PRINTING_3D_INPUTS.insumosExtraPieza,
  porcentajeFallos: DEFAULT_PRINTING_3D_INPUTS.porcentajeFallos,
}

export const DEFAULT_PRINTING_3D_QUOTE_INPUTS: Printing3DQuoteInputs = {
  pesoPieza: DEFAULT_PRINTING_3D_INPUTS.pesoPieza,
  horasCama: DEFAULT_PRINTING_3D_INPUTS.horasCama,
  minutosCama: DEFAULT_PRINTING_3D_INPUTS.minutosCama,
  piezasPorCama: DEFAULT_PRINTING_3D_INPUTS.piezasPorCama,
  cantidadTotalUnidades: DEFAULT_PRINTING_3D_INPUTS.cantidadTotalUnidades,
  porcentajeGanancia: DEFAULT_PRINTING_3D_INPUTS.porcentajeGanancia,
}

export const PRINTING_3D_CONFIG_STORAGE_KEY = 'nm-hub-printing3d-printer-config'

export function mergePrinting3DInputs(
  config: Printing3DPrinterConfig,
  quote: Printing3DQuoteInputs,
): Printing3DInputs {
  return { ...config, ...quote }
}

export function loadPrinting3DPrinterConfig(): Printing3DPrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_PRINTING_3D_PRINTER_CONFIG
  try {
    const raw = window.localStorage.getItem(PRINTING_3D_CONFIG_STORAGE_KEY)
    if (!raw) return DEFAULT_PRINTING_3D_PRINTER_CONFIG
    const parsed = JSON.parse(raw) as Partial<Printing3DPrinterConfig>
    return { ...DEFAULT_PRINTING_3D_PRINTER_CONFIG, ...parsed }
  } catch {
    return DEFAULT_PRINTING_3D_PRINTER_CONFIG
  }
}

export function savePrinting3DPrinterConfig(config: Printing3DPrinterConfig): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PRINTING_3D_CONFIG_STORAGE_KEY, JSON.stringify(config))
}

export function bedTimeToTotalMinutes(horasCama: number, minutosCama: number): number {
  return Math.max(0, Math.round(horasCama) * 60 + Math.round(minutosCama))
}

export function totalMinutesToBedTime(
  totalMinutes: number,
): Pick<Printing3DQuoteInputs, 'horasCama' | 'minutosCama'> {
  const mins = Math.max(0, Math.round(totalMinutes))
  return { horasCama: Math.floor(mins / 60), minutosCama: mins % 60 }
}

export function formatBedPrintTimeLabel(horasCama: number, minutosCama: number): string {
  const hours = Math.floor(horasCama)
  const minutes = Math.round(minutosCama) % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

export interface BedPrintTimeOption {
  totalMinutes: number
  label: string
}

export function buildBedPrintTimeOptions(
  maxHours = 72,
  stepMinutes = 15,
): BedPrintTimeOption[] {
  const options: BedPrintTimeOption[] = []
  const maxMinutes = maxHours * 60
  for (let mins = stepMinutes; mins <= maxMinutes; mins += stepMinutes) {
    const { horasCama, minutosCama } = totalMinutesToBedTime(mins)
    options.push({
      totalMinutes: mins,
      label: formatBedPrintTimeLabel(horasCama, minutosCama),
    })
  }
  return options
}

export function bedPrintTimeOptionsIncluding(
  horasCama: number,
  minutosCama: number,
  options: BedPrintTimeOption[],
): BedPrintTimeOption[] {
  const current = bedTimeToTotalMinutes(horasCama, minutosCama)
  if (current === 0 || options.some((option) => option.totalMinutes === current)) {
    return options
  }
  const { horasCama: h, minutosCama: m } = totalMinutesToBedTime(current)
  return [
    ...options,
    { totalMinutes: current, label: formatBedPrintTimeLabel(h, m) },
  ].sort((a, b) => a.totalMinutes - b.totalMinutes)
}

function nonNegative(value: number, label: string, errors: string[]): number {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} no puede ser negativo.`)
    return 0
  }
  return value
}

function positive(value: number, label: string, errors: string[]): number {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label} debe ser mayor a cero.`)
    return 0
  }
  return value
}

export function computePrinting3D(inputs: Printing3DInputs): Printing3DCalcOutput {
  const errors: string[] = []

  const precioRollo = nonNegative(inputs.precioRollo, 'Precio del rollo', errors)
  const pesoRolloGramos = positive(inputs.pesoRolloGramos, 'Peso del rollo', errors)
  const pesoPieza = nonNegative(inputs.pesoPieza, 'Peso de la pieza', errors)
  const pesoPurgaCama = nonNegative(inputs.pesoPurgaCama, 'Peso de purga por cama', errors)
  const valorImpresora = nonNegative(inputs.valorImpresora, 'Valor de la impresora', errors)
  const vidaUtilHoras = positive(inputs.vidaUtilHoras, 'Vida útil de la impresora', errors)
  const consumoWatts = nonNegative(inputs.consumoWatts, 'Consumo eléctrico', errors)
  const costoKwh = nonNegative(inputs.costoKwh, 'Costo del kWh', errors)
  const horasCama = nonNegative(inputs.horasCama, 'Horas de cama', errors)
  const minutosCama = nonNegative(inputs.minutosCama, 'Minutos de cama', errors)

  let piezasPorCama = Math.floor(inputs.piezasPorCama)
  if (!Number.isFinite(piezasPorCama) || piezasPorCama < 1) {
    errors.push('Piezas por cama debe ser al menos 1.')
    piezasPorCama = 1
  }

  const cantidadTotalUnidades = Math.max(
    1,
    Math.floor(nonNegative(inputs.cantidadTotalUnidades, 'Cantidad total', errors)),
  )
  const costoHoraTrabajo = nonNegative(inputs.costoHoraTrabajo, 'Costo hora de trabajo', errors)
  const minutosPostproceso = nonNegative(
    inputs.minutosPostproceso,
    'Minutos de post-procesado',
    errors,
  )
  const insumosExtraPieza = nonNegative(inputs.insumosExtraPieza, 'Insumos extra', errors)
  const porcentajeFallos = nonNegative(inputs.porcentajeFallos, 'Porcentaje de fallos', errors)
  const porcentajeGanancia = nonNegative(
    inputs.porcentajeGanancia,
    'Porcentaje de ganancia',
    errors,
  )

  if (porcentajeGanancia >= 100) {
    errors.push('El porcentaje de ganancia debe ser menor a 100%.')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const costoGramo = precioRollo / pesoRolloGramos
  const gramosPorPieza = pesoPieza + pesoPurgaCama / piezasPorCama
  const costoMaterialPieza = gramosPorPieza * costoGramo

  const horasCamaTotal = horasCama + minutosCama / 60
  const horasPieza = horasCamaTotal / piezasPorCama

  const costoDepreciacionPieza = horasPieza * (valorImpresora / vidaUtilHoras)
  const costoLuzPieza = horasPieza * (consumoWatts / 1000) * costoKwh
  const costoManoObraPieza = (minutosPostproceso / 60) * costoHoraTrabajo

  const subtotalPieza =
    costoMaterialPieza +
    costoDepreciacionPieza +
    costoLuzPieza +
    costoManoObraPieza +
    insumosExtraPieza

  const costoUnitarioFinal = subtotalPieza * (1 + porcentajeFallos / 100)
  const precioVentaUnitario = costoUnitarioFinal / (1 - porcentajeGanancia / 100)

  const costoTotalProduccion = costoUnitarioFinal * cantidadTotalUnidades
  const precioVentaTotal = precioVentaUnitario * cantidadTotalUnidades
  const gananciaNetaTotal = precioVentaTotal - costoTotalProduccion
  const margenRealPorcentaje =
    precioVentaTotal > 0 ? (gananciaNetaTotal / precioVentaTotal) * 100 : 0

  const horasTotalesMaquinado = horasPieza * cantidadTotalUnidades
  const camasTotales = Math.ceil(cantidadTotalUnidades / piezasPorCama)
  const filamentoTotalGramos = gramosPorPieza * cantidadTotalUnidades
  const rollosRequeridos = filamentoTotalGramos / pesoRolloGramos

  const reservaFallos = subtotalPieza * (porcentajeFallos / 100)

  return {
    valid: true,
    costoGramo,
    gramosPorPieza,
    horasPieza,
    costoMaterialPieza,
    costoDepreciacionPieza,
    costoLuzPieza,
    costoManoObraPieza,
    subtotalPieza,
    costoUnitarioFinal,
    precioVentaUnitario,
    costoTotalProduccion,
    precioVentaTotal,
    gananciaNetaTotal,
    margenRealPorcentaje,
    horasTotalesMaquinado,
    camasTotales,
    filamentoTotalGramos,
    rollosRequeridos,
    breakdown: {
      costoFilamento: costoMaterialPieza,
      costoElectricidad: costoLuzPieza,
      costoDepreciacion: costoDepreciacionPieza,
      costoManoObra: costoManoObraPieza,
      insumosExtra: insumosExtraPieza,
      reservaFallos,
    },
  }
}
