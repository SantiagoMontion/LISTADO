/** Calculadora de nacionalización / importados (USD → ARS). Modelo volumen/escala. */

export interface ImportadosInputs {
  /** Costo del producto en EE. UU. (USD) — siempre unitario */
  costoProductoUsd: number
  /** Peso del paquete (kg). En modo cantidad = peso total del envío. */
  pesoKg: number
  /** Tarifa aérea Aerobox (USD por kg) */
  aeroboxUsdPorKg: number
  /** Flete interno en EE. UU. (USD). En modo cantidad = total del pedido. */
  fleteInternoUsd: number
  /** Envío a domicilio en Argentina (USD). En modo cantidad = una guía, se prorratea. */
  envioDomicilioUsd: number
  /** Cotización dólar financiero / MEP / CCL (ARS) — se aplica buffer +2% al convertir */
  dolarArs: number
  /** Cotizar varias unidades del mismo producto en un solo envío */
  cotizarEnCantidad: boolean
  /** Unidades del lote (solo si cotizarEnCantidad). Mínimo 2. */
  cantidad: number
  /**
   * @deprecated Ya no se usa: cuotas se blindan con divisor MP 0.7797.
   * Se mantiene opcional por prefs legacy en localStorage.
   */
  recargoCuotasPct?: number
}

export interface ImportadosMarginBand {
  label: string
  /** Fracción 0–1 (ej. 0.20 = 20%) */
  marginRate: number
  /** Reserva de compat (siempre 0 en el modelo actual) */
  fixedUsd: number
}

export interface ImportadosResults {
  valid: true
  /** Unidades efectivas usadas en el cálculo (1 si no hay modo cantidad) */
  cantidad: number
  cotizarEnCantidad: boolean
  /** Totales del lote (igual a unitarios si cantidad = 1) */
  baseImponibleUsd: number
  fleteAeroboxUsd: number
  /** Handling Aerobox del lote (fijo $1.50 por consolidación, no × cantidad) */
  handlingAeroboxUsd: number
  /** Handling prorrateado por unidad */
  handlingAeroboxUnitUsd: number
  /** Gastos aduaneros no recuperables (~6% de la base del lote) */
  gastosNoRecuperablesUsd: number
  /** Buffer financiero por percepciones: 7.5% de la base imponible del lote */
  bufferFinancieroUsd: number
  /** Envío AR del lote (una guía) */
  envioDomicilioUsd: number
  /** Envío AR prorrateado por unidad */
  envioDomicilioUnitUsd: number
  /** Base + handling + no recuperables + envío AR (lote) */
  costoLandedUsd: number
  /** Alias de costoLanded (compat UI) */
  costoRealOperativoUsd: number
  /** Impuestos transaccionales 6.5% sobre landed (IIBB, cheque, pasarela) */
  impuestosTransaccionalesUsd: number
  /** Landed × (1 + 6.5%) */
  costoConFriccionUsd: number
  /** Costo con fricción × (1 + margen) */
  subtotalConMargenUsd: number
  margin: ImportadosMarginBand
  /** Precio contado por unidad (USD) */
  precioContadoUsd: number
  /** Precio contado del lote (USD) */
  precioContadoLoteUsd: number
  /** Solo el bloque de margen del lote (subtotal − costo con fricción) */
  gananciaNetaUsd: number
  /** Ganancia neta por unidad */
  gananciaNetaUnitUsd: number
  /** MEP × 1.02 usado para convertir a ARS */
  dolarMepConvertido: number
  /** Contado / transferencia por unidad (ARS), redondeo góndola */
  precioContadoArs: number
  /** Contado del lote (ARS) = unitario góndola × cantidad */
  precioContadoLoteArs: number
  /** Tarjeta / cuotas por unidad (ARS), blindado peor caso MP 6 cuotas */
  precioCuotasArs: number
  /** Cuotas del lote (ARS) */
  precioCuotasLoteArs: number
  gananciaNetaArs: number
  gananciaNetaUnitArs: number
  /** Desglose ARS del lote */
  costoProductoArs: number
  fleteInternoArs: number
  fleteAeroboxArs: number
  handlingAeroboxArs: number
  baseImponibleArs: number
  gastosNoRecuperablesArs: number
  bufferFinancieroArs: number
  envioDomicilioArs: number
  costoLandedArs: number
  costoRealOperativoArs: number
  impuestosTransaccionalesArs: number
  costoConFriccionArs: number
  subtotalConMargenArs: number
}

export interface ImportadosInvalidResults {
  valid: false
  errors: string[]
}

export type ImportadosCalcOutput = ImportadosResults | ImportadosInvalidResults

export const AEROBOX_USD_PER_KG = 20
/** Handling consolidado Aerobox por guía / consolidación (USD), no por unidad. */
export const HANDLING_AEROBOX_USD = 1.5
/** Envío AR por defecto. */
export const DEFAULT_ENVIO_DOMICILIO_USD = 15
/** Gastos aduaneros / S.A.S. no recuperables (sobre base imponible). */
export const GASTOS_NO_RECUPERABLES_RATE = 0.06
/** IIBB + impuesto al cheque + pasarela (sobre costo landed). */
export const IMPUESTOS_TRANSACCIONALES_RATE = 0.065
/** Costo de liquidez por percepciones hasta descontar el crédito fiscal. */
export const BUFFER_FINANCIERO_RATE = 0.075
/** Buffer de protección cambiaria sobre dólar MEP. */
export const DOLAR_MEP_BUFFER_RATE = 0.02
/**
 * Divisor Mercado Pago peor caso 6 cuotas:
 * 100% − (3.34% base + 18.69% cuotas) = 77.97% → 1/0.7797 ≈ +28.25% sobre contado.
 */
export const CUOTAS_MP_NET_FACTOR = 0.7797

/**
 * Precio de góndola ARS: redondeo al múltiplo de 500 más cercano
 * (ej. 453374 → 453500; puede caer en miles). Montos chicos usan escalones más finos.
 */
export function normalizeStorePriceArs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (raw < 100) return Math.ceil(raw)
  if (raw < 500) return Math.ceil(raw / 100) * 100
  return Math.round(raw / 500) * 500
}

/** Contado ARS → precio tarjeta blindado (peor caso MP 6 cuotas). */
export function precioCuotasFromContadoArs(precioContadoArs: number): number {
  if (!Number.isFinite(precioContadoArs) || precioContadoArs <= 0) return 0
  return Math.round(precioContadoArs / CUOTAS_MP_NET_FACTOR)
}

export const DEFAULT_IMPORTADOS_INPUTS: ImportadosInputs = {
  costoProductoUsd: 0,
  pesoKg: 0.3,
  aeroboxUsdPorKg: AEROBOX_USD_PER_KG,
  fleteInternoUsd: 0,
  envioDomicilioUsd: DEFAULT_ENVIO_DOMICILIO_USD,
  dolarArs: 1350,
  cotizarEnCantidad: false,
  cantidad: 10,
}

export const IMPORTADOS_PREFS_STORAGE_KEY = 'nm-hub-importados-prefs'

function nonNegative(value: number, label: string, errors: string[]): number {
  if (!Number.isFinite(value)) {
    errors.push(`${label} no es un número válido.`)
    return 0
  }
  if (value < 0) {
    errors.push(`${label} no puede ser negativo.`)
    return 0
  }
  return value
}

/** Unidades efectivas: 1 (unitario) o ≥2 en modo cantidad. */
export function resolveImportadosCantidad(
  cotizarEnCantidad: boolean,
  cantidad: number,
): number {
  if (!cotizarEnCantidad) return 1
  if (!Number.isFinite(cantidad)) return 2
  return Math.max(2, Math.floor(cantidad))
}

/** Margen neto variable por volumen (según costo unitario del producto USD). */
export function resolveImportadosMargin(costoProductoUsd: number): ImportadosMarginBand {
  if (costoProductoUsd < 50) {
    return { label: '< $50 · 18%', marginRate: 0.18, fixedUsd: 0 }
  }
  if (costoProductoUsd <= 120) {
    return { label: '$50–$120 · 14%', marginRate: 0.14, fixedUsd: 0 }
  }
  return { label: '> $120 · 12%', marginRate: 0.12, fixedUsd: 0 }
}

export function computeImportados(inputs: ImportadosInputs): ImportadosCalcOutput {
  const errors: string[] = []
  const costoProductoUsd = nonNegative(inputs.costoProductoUsd, 'Costo del producto', errors)
  const pesoKg = nonNegative(inputs.pesoKg, 'Peso', errors)
  const aeroboxUsdPorKg = nonNegative(inputs.aeroboxUsdPorKg, 'Tarifa Aerobox', errors)
  const fleteInternoUsd = nonNegative(inputs.fleteInternoUsd, 'Flete interno', errors)
  const envioDomicilioUsd = nonNegative(inputs.envioDomicilioUsd, 'Envío a domicilio', errors)
  const dolarArs = nonNegative(inputs.dolarArs, 'Cotización dólar', errors)
  const cotizarEnCantidad = Boolean(inputs.cotizarEnCantidad)
  const cantidad = resolveImportadosCantidad(cotizarEnCantidad, inputs.cantidad)

  if (cotizarEnCantidad && Number.isFinite(inputs.cantidad) && inputs.cantidad < 2) {
    errors.push('La cantidad debe ser al menos 2.')
  }

  if (errors.length > 0) return { valid: false, errors }
  if (dolarArs <= 0) {
    return { valid: false, errors: ['La cotización del dólar debe ser mayor a 0.'] }
  }
  if (aeroboxUsdPorKg <= 0) {
    return { valid: false, errors: ['La tarifa Aerobox debe ser mayor a 0.'] }
  }
  if (costoProductoUsd <= 0) {
    return { valid: false, errors: ['Ingresá el costo del producto en USD.'] }
  }

  // Lote: producto unitario × N. Peso / flete EE.UU. / envío AR son del envío completo.
  const costoProductoLoteUsd = costoProductoUsd * cantidad
  const fleteAeroboxUsd = pesoKg * aeroboxUsdPorKg
  const baseImponibleUsd = costoProductoLoteUsd + fleteInternoUsd + fleteAeroboxUsd

  // Handling y envío AR: una sola vez por consolidación / guía → se prorratean al mostrar c/u.
  const handlingAeroboxUsd = HANDLING_AEROBOX_USD
  const handlingAeroboxUnitUsd = handlingAeroboxUsd / cantidad
  const envioDomicilioUnitUsd = envioDomicilioUsd / cantidad

  const gastosNoRecuperablesUsd = baseImponibleUsd * GASTOS_NO_RECUPERABLES_RATE
  const costoLandedUsd =
    baseImponibleUsd + handlingAeroboxUsd + gastosNoRecuperablesUsd + envioDomicilioUsd
  const costoRealOperativoUsd = costoLandedUsd

  const impuestosTransaccionalesUsd = costoLandedUsd * IMPUESTOS_TRANSACCIONALES_RATE
  const costoConFriccionUsd = costoLandedUsd * (1 + IMPUESTOS_TRANSACCIONALES_RATE)

  // Margen según costo UNITARIO (no el total del lote).
  const margin = resolveImportadosMargin(costoProductoUsd)
  const subtotalConMargenUsd =
    costoConFriccionUsd * (1 + margin.marginRate) + margin.fixedUsd

  const bufferFinancieroUsd = baseImponibleUsd * BUFFER_FINANCIERO_RATE

  const precioContadoLoteUsd = subtotalConMargenUsd + bufferFinancieroUsd
  const precioContadoUsd = precioContadoLoteUsd / cantidad
  const gananciaNetaUsd = subtotalConMargenUsd - costoConFriccionUsd
  const gananciaNetaUnitUsd = gananciaNetaUsd / cantidad
  const dolarMepConvertido = dolarArs * (1 + DOLAR_MEP_BUFFER_RATE)

  const precioContadoArs = normalizeStorePriceArs(precioContadoUsd * dolarMepConvertido)
  const precioContadoLoteArs = precioContadoArs * cantidad
  const precioCuotasArs = precioCuotasFromContadoArs(precioContadoArs)
  const precioCuotasLoteArs = precioCuotasArs * cantidad
  const gananciaNetaArs = gananciaNetaUsd * dolarMepConvertido
  const gananciaNetaUnitArs = gananciaNetaUnitUsd * dolarMepConvertido

  return {
    valid: true,
    cantidad,
    cotizarEnCantidad: cantidad > 1,
    baseImponibleUsd,
    fleteAeroboxUsd,
    handlingAeroboxUsd,
    handlingAeroboxUnitUsd,
    gastosNoRecuperablesUsd,
    bufferFinancieroUsd,
    envioDomicilioUsd,
    envioDomicilioUnitUsd,
    costoLandedUsd,
    costoRealOperativoUsd,
    impuestosTransaccionalesUsd,
    costoConFriccionUsd,
    subtotalConMargenUsd,
    margin,
    precioContadoUsd,
    precioContadoLoteUsd,
    gananciaNetaUsd,
    gananciaNetaUnitUsd,
    dolarMepConvertido,
    precioContadoArs,
    precioContadoLoteArs,
    precioCuotasArs,
    precioCuotasLoteArs,
    gananciaNetaArs,
    gananciaNetaUnitArs,
    costoProductoArs: costoProductoLoteUsd * dolarMepConvertido,
    fleteInternoArs: fleteInternoUsd * dolarMepConvertido,
    fleteAeroboxArs: fleteAeroboxUsd * dolarMepConvertido,
    handlingAeroboxArs: handlingAeroboxUsd * dolarMepConvertido,
    baseImponibleArs: baseImponibleUsd * dolarMepConvertido,
    gastosNoRecuperablesArs: gastosNoRecuperablesUsd * dolarMepConvertido,
    bufferFinancieroArs: bufferFinancieroUsd * dolarMepConvertido,
    envioDomicilioArs: envioDomicilioUsd * dolarMepConvertido,
    costoLandedArs: costoLandedUsd * dolarMepConvertido,
    costoRealOperativoArs: costoRealOperativoUsd * dolarMepConvertido,
    impuestosTransaccionalesArs: impuestosTransaccionalesUsd * dolarMepConvertido,
    costoConFriccionArs: costoConFriccionUsd * dolarMepConvertido,
    subtotalConMargenArs: subtotalConMargenUsd * dolarMepConvertido,
  }
}

export type ImportadosPrefs = Pick<
  ImportadosInputs,
  | 'pesoKg'
  | 'aeroboxUsdPorKg'
  | 'fleteInternoUsd'
  | 'envioDomicilioUsd'
  | 'dolarArs'
  | 'cotizarEnCantidad'
  | 'cantidad'
>

/** Legacy: map old destination pills → USD if still in localStorage. */
function legacyDestinoToUsd(destinoRaw: string): number | null {
  if (destinoRaw === 'caba') return 8
  if (destinoRaw === 'provincia') return 12
  if (destinoRaw === 'interior') return 23
  return null
}

export function coerceImportadosPrefs(raw: unknown): ImportadosPrefs {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const num = (key: Exclude<keyof ImportadosPrefs, 'cotizarEnCantidad'>, fallback: number): number => {
    const value = Number(obj[key])
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }

  let envioFallback = DEFAULT_IMPORTADOS_INPUTS.envioDomicilioUsd
  if (obj.envioDomicilioUsd === undefined || obj.envioDomicilioUsd === null || obj.envioDomicilioUsd === '') {
    const legacy = legacyDestinoToUsd(String(obj.destinoEnvio ?? ''))
    if (legacy !== null) envioFallback = legacy
  }

  const cantidadRaw = Number(obj.cantidad)
  const cantidad =
    Number.isFinite(cantidadRaw) && cantidadRaw >= 2
      ? Math.floor(cantidadRaw)
      : DEFAULT_IMPORTADOS_INPUTS.cantidad

  return {
    pesoKg: num('pesoKg', DEFAULT_IMPORTADOS_INPUTS.pesoKg),
    aeroboxUsdPorKg: num('aeroboxUsdPorKg', DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg),
    fleteInternoUsd: num('fleteInternoUsd', DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd),
    envioDomicilioUsd: num('envioDomicilioUsd', envioFallback),
    dolarArs: num('dolarArs', DEFAULT_IMPORTADOS_INPUTS.dolarArs),
    cotizarEnCantidad: Boolean(obj.cotizarEnCantidad),
    cantidad,
  }
}

function defaultPrefs(): ImportadosPrefs {
  return {
    pesoKg: DEFAULT_IMPORTADOS_INPUTS.pesoKg,
    aeroboxUsdPorKg: DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg,
    fleteInternoUsd: DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd,
    envioDomicilioUsd: DEFAULT_IMPORTADOS_INPUTS.envioDomicilioUsd,
    dolarArs: DEFAULT_IMPORTADOS_INPUTS.dolarArs,
    cotizarEnCantidad: DEFAULT_IMPORTADOS_INPUTS.cotizarEnCantidad,
    cantidad: DEFAULT_IMPORTADOS_INPUTS.cantidad,
  }
}

export function loadImportadosPrefsLocal(): ImportadosPrefs {
  if (typeof window === 'undefined') return defaultPrefs()
  try {
    const raw = window.localStorage.getItem(IMPORTADOS_PREFS_STORAGE_KEY)
    if (!raw) return defaultPrefs()
    return coerceImportadosPrefs(JSON.parse(raw))
  } catch {
    return defaultPrefs()
  }
}

export function saveImportadosPrefsLocal(prefs: ImportadosPrefs): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(IMPORTADOS_PREFS_STORAGE_KEY, JSON.stringify(prefs))
}
