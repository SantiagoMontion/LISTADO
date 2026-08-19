/** Calculadora de nacionalización / importados (USD → ARS). Lote prorrateado + 3% estadística. */

export interface ImportadosInputs {
  /** Costo FOB del producto (USD) — siempre unitario */
  costoProductoUsd: number
  /** Peso del paquete (kg). En modo cantidad = peso total del envío. */
  pesoKg: number
  /** Tarifa aérea Aerobox (USD por kg) */
  aeroboxUsdPorKg: number
  /** Flete interno en EE. UU. (USD). En modo cantidad = total del pedido. */
  fleteInternoUsd: number
  /** Envío nacional a domicilio (USD). En modo cantidad = una guía, se prorratea. */
  envioDomicilioUsd: number
  /** Cotización dólar MEP (ARS) */
  dolarArs: number
  /** Cotizar varias unidades del mismo producto en un solo envío */
  cotizarEnCantidad: boolean
  /** Unidades del lote (solo si cotizarEnCantidad). Mínimo 2. */
  cantidad: number
  /**
   * @deprecated Ya no se usa: cuotas usan coeficiente MP 6 cuotas.
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
  cantidad: number
  cotizarEnCantidad: boolean
  /** Flete courier del lote (Aerobox + flete interno EE. UU.) */
  fleteAeroboxUsd: number
  /** Flete courier prorrateado por unidad */
  fleteUnitarioUsd: number
  handlingAeroboxUsd: number
  handlingAeroboxUnitUsd: number
  /** Base CIF unitaria = FOB + flete unitario */
  baseCifUsd: number
  /** Alias lote: CIF unitario × cantidad */
  baseImponibleUsd: number
  /** Tasa de estadística 3% sobre CIF (lote) */
  gastosNoRecuperablesUsd: number
  gastosNoRecuperablesUnitUsd: number
  envioDomicilioUsd: number
  envioDomicilioUnitUsd: number
  /** Landed unitario (sin envío nacional) */
  costoLandedUsd: number
  costoLandedUnitUsd: number
  costoRealOperativoUsd: number
  impuestosTransaccionalesUsd: number
  costoConFriccionUsd: number
  bufferFinancieroUsd: number
  margin: ImportadosMarginBand
  /** Subtotal con margen unitario (ARS) = landed ARS / (1 − margen) */
  subtotalConMargenArs: number
  subtotalConMargenUsd: number
  precioContadoUsd: number
  precioContadoLoteUsd: number
  gananciaNetaUsd: number
  gananciaNetaUnitUsd: number
  /** MEP usado para convertir (sin buffer) */
  dolarMepConvertido: number
  precioContadoArs: number
  precioContadoLoteArs: number
  precioCuotasArs: number
  precioCuotasLoteArs: number
  gananciaNetaArs: number
  gananciaNetaUnitArs: number
  costoProductoArs: number
  fleteInternoArs: number
  fleteAeroboxArs: number
  handlingAeroboxArs: number
  baseImponibleArs: number
  baseCifArs: number
  gastosNoRecuperablesArs: number
  bufferFinancieroArs: number
  envioDomicilioArs: number
  envioNacionalUnitArs: number
  costoLandedArs: number
  costoLandedUnitArs: number
  costoRealOperativoArs: number
  impuestosTransaccionalesArs: number
  costoConFriccionArs: number
}

export interface ImportadosInvalidResults {
  valid: false
  errors: string[]
}

export type ImportadosCalcOutput = ImportadosResults | ImportadosInvalidResults

export const AEROBOX_USD_PER_KG = 20
/** Handling consolidado Aerobox por guía / consolidación (USD), no por unidad. */
export const HANDLING_AEROBOX_USD = 1.5
/** Envío nacional a domicilio (ARS), mismo monto para todos los importados. */
export const ENVIO_NACIONAL_ARS = 10_500
/** @deprecated Usar ENVIO_NACIONAL_ARS; se mantiene para prefs legacy. */
export const DEFAULT_ENVIO_DOMICILIO_USD = 15
/** Tasa de estadística: único gasto aduanero no recuperable (sobre CIF). */
export const TASA_ESTADISTICA_RATE = 0.03
/**
 * @deprecated El 6% SAS ya no entra al costo: IVA/percepciones son crédito fiscal.
 * Se mantiene el nombre para no romper imports; el cálculo usa TASA_ESTADISTICA_RATE.
 */
export const GASTOS_NO_RECUPERABLES_RATE = TASA_ESTADISTICA_RATE
/** @deprecated Ya no se aplica fricción transaccional en la calculadora. */
export const IMPUESTOS_TRANSACCIONALES_RATE = 0
/** @deprecated Percepciones son crédito fiscal; no se bufferizan. */
export const BUFFER_FINANCIERO_RATE = 0
/** @deprecated La conversión usa MEP de mercado, sin +2%. */
export const DOLAR_MEP_BUFFER_RATE = 0
/**
 * Divisor Mercado Pago 6 cuotas (comisión sobre el subtotal, no sobre el envío):
 * 100% − (3.34% base + 18.69% cuotas) = 77.97%.
 */
export const CUOTAS_MP_NET_FACTOR = 0.7797
/** Coeficiente MP 6 cuotas = 1 − 0.7797 = 22.03%. */
export const CUOTAS_MP_COEFFICIENT = 1 - CUOTAS_MP_NET_FACTOR

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

/** Subtotal ARS → precio 6 cuotas (sin envío nacional). */
export function precioCuotasFromContadoArs(subtotalConMargenArs: number): number {
  if (!Number.isFinite(subtotalConMargenArs) || subtotalConMargenArs <= 0) return 0
  return Math.round(subtotalConMargenArs / (1 - CUOTAS_MP_COEFFICIENT))
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

/** Margen neto variable por volumen (según costo FOB unitario). */
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
  const costoFobUsd = nonNegative(inputs.costoProductoUsd, 'Costo del producto', errors)
  const pesoKg = nonNegative(inputs.pesoKg, 'Peso', errors)
  const aeroboxUsdPorKg = nonNegative(inputs.aeroboxUsdPorKg, 'Tarifa Aerobox', errors)
  const fleteInternoUsd = nonNegative(inputs.fleteInternoUsd, 'Flete interno', errors)
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
  if (costoFobUsd <= 0) {
    return { valid: false, errors: ['Ingresá el costo del producto en USD.'] }
  }
  if (cantidad <= 0) {
    return { valid: false, errors: ['La cantidad debe ser mayor a 0.'] }
  }

  const fleteAeroboxUsd = pesoKg * aeroboxUsdPorKg
  const fleteCourierLoteUsd = fleteAeroboxUsd + fleteInternoUsd
  const fleteUnitarioUsd = fleteCourierLoteUsd / cantidad
  const handlingAeroboxUsd = HANDLING_AEROBOX_USD
  const handlingAeroboxUnitUsd = handlingAeroboxUsd / cantidad

  const baseCifUsd = costoFobUsd + fleteUnitarioUsd
  const gastosNoRecuperablesUnitUsd = baseCifUsd * TASA_ESTADISTICA_RATE
  const gastosNoRecuperablesUsd = gastosNoRecuperablesUnitUsd * cantidad

  const costoLandedUnitUsd =
    costoFobUsd + fleteUnitarioUsd + handlingAeroboxUnitUsd + gastosNoRecuperablesUnitUsd
  const costoLandedUsd = costoLandedUnitUsd * cantidad
  const costoLandedUnitArs = costoLandedUnitUsd * dolarArs
  const costoLandedArs = costoLandedUsd * dolarArs

  const margin = resolveImportadosMargin(costoFobUsd)
  const denom = 1 - margin.marginRate
  const subtotalConMargenUnitArs = denom > 0 ? costoLandedUnitArs / denom : costoLandedUnitArs
  const subtotalConMargenArs = subtotalConMargenUnitArs * cantidad
  const subtotalConMargenUsd = subtotalConMargenArs / dolarArs

  const envioDomicilioArs = ENVIO_NACIONAL_ARS
  const envioNacionalUnitArs = ENVIO_NACIONAL_ARS / cantidad
  const envioDomicilioUsd = dolarArs > 0 ? envioDomicilioArs / dolarArs : 0
  const envioDomicilioUnitUsd = envioDomicilioUsd / cantidad

  const precioContadoUnitArsRaw = subtotalConMargenUnitArs + envioNacionalUnitArs
  const precioCuotasUnitArsRaw =
    subtotalConMargenUnitArs / (1 - CUOTAS_MP_COEFFICIENT) + envioNacionalUnitArs

  const precioContadoArs = normalizeStorePriceArs(precioContadoUnitArsRaw)
  const precioCuotasArs = normalizeStorePriceArs(precioCuotasUnitArsRaw)
  const precioContadoLoteArs = precioContadoArs * cantidad
  const precioCuotasLoteArs = precioCuotasArs * cantidad
  const precioContadoUsd = precioContadoArs / dolarArs
  const precioContadoLoteUsd = precioContadoUsd * cantidad

  const gananciaNetaUnitArs = subtotalConMargenUnitArs - costoLandedUnitArs
  const gananciaNetaArs = gananciaNetaUnitArs * cantidad
  const gananciaNetaUnitUsd = gananciaNetaUnitArs / dolarArs
  const gananciaNetaUsd = gananciaNetaArs / dolarArs

  const costoProductoLoteUsd = costoFobUsd * cantidad
  const baseImponibleUsd = baseCifUsd * cantidad

  return {
    valid: true,
    cantidad,
    cotizarEnCantidad: cantidad > 1,
    fleteAeroboxUsd,
    fleteUnitarioUsd,
    handlingAeroboxUsd,
    handlingAeroboxUnitUsd,
    baseCifUsd,
    baseImponibleUsd,
    gastosNoRecuperablesUsd,
    gastosNoRecuperablesUnitUsd,
    envioDomicilioUsd,
    envioDomicilioUnitUsd,
    costoLandedUsd,
    costoLandedUnitUsd,
    costoRealOperativoUsd: costoLandedUsd,
    impuestosTransaccionalesUsd: 0,
    costoConFriccionUsd: costoLandedUsd,
    bufferFinancieroUsd: 0,
    margin,
    subtotalConMargenArs,
    subtotalConMargenUsd,
    precioContadoUsd,
    precioContadoLoteUsd,
    gananciaNetaUsd,
    gananciaNetaUnitUsd,
    dolarMepConvertido: dolarArs,
    precioContadoArs,
    precioContadoLoteArs,
    precioCuotasArs,
    precioCuotasLoteArs,
    gananciaNetaArs,
    gananciaNetaUnitArs,
    costoProductoArs: costoProductoLoteUsd * dolarArs,
    fleteInternoArs: fleteInternoUsd * dolarArs,
    fleteAeroboxArs: fleteAeroboxUsd * dolarArs,
    handlingAeroboxArs: handlingAeroboxUsd * dolarArs,
    baseImponibleArs: baseImponibleUsd * dolarArs,
    baseCifArs: baseCifUsd * dolarArs,
    gastosNoRecuperablesArs: gastosNoRecuperablesUsd * dolarArs,
    bufferFinancieroArs: 0,
    envioDomicilioArs,
    envioNacionalUnitArs,
    costoLandedArs,
    costoLandedUnitArs,
    costoRealOperativoArs: costoLandedArs,
    impuestosTransaccionalesArs: 0,
    costoConFriccionArs: costoLandedArs,
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
