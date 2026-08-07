/** Calculadora de nacionalización / importados (USD → ARS). Modelo volumen/escala. */

export interface ImportadosInputs {
  /** Costo del producto en EE. UU. (USD) */
  costoProductoUsd: number
  /** Peso del paquete (kg) — Aerobox cobra solo por peso real, no por volumen */
  pesoKg: number
  /** Tarifa aérea Aerobox (USD por kg) */
  aeroboxUsdPorKg: number
  /** Flete interno en EE. UU. (USD) */
  fleteInternoUsd: number
  /** Envío a domicilio en Argentina (USD, editable) */
  envioDomicilioUsd: number
  /** Cotización dólar financiero / MEP / CCL (ARS) — se aplica buffer +2% al convertir */
  dolarArs: number
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
  baseImponibleUsd: number
  fleteAeroboxUsd: number
  /** Handling consolidado Aerobox fijo por unidad */
  handlingAeroboxUsd: number
  /** Gastos aduaneros no recuperables (~6% de la base) */
  gastosNoRecuperablesUsd: number
  /** Buffer financiero por percepciones: 7.5% de la base imponible */
  bufferFinancieroUsd: number
  envioDomicilioUsd: number
  /** Base + handling + no recuperables + envío AR */
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
  /** Subtotal con margen + buffer financiero 7.5% */
  precioContadoUsd: number
  /** Solo el bloque de margen (subtotal − costo con fricción) */
  gananciaNetaUsd: number
  /** MEP × 1.02 usado para convertir a ARS */
  dolarMepConvertido: number
  /** Contado / transferencia (ARS), redondeo góndola */
  precioContadoArs: number
  /** Tarjeta / cuotas (ARS), blindado peor caso MP 6 cuotas */
  precioCuotasArs: number
  gananciaNetaArs: number
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
/** Handling consolidado Aerobox por unidad (USD). */
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

/** Margen neto variable por volumen (según costo de producto USD). */
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

  // 1) Base imponible: producto + flete EE.UU. + Aerobox (peso real).
  const fleteAeroboxUsd = pesoKg * aeroboxUsdPorKg
  const baseImponibleUsd = costoProductoUsd + fleteInternoUsd + fleteAeroboxUsd
  const handlingAeroboxUsd = HANDLING_AEROBOX_USD

  // 2) Costo landed: (base + handling) + gastos no recuperables (~6%) + envío AR.
  const gastosNoRecuperablesUsd = baseImponibleUsd * GASTOS_NO_RECUPERABLES_RATE
  const costoLandedUsd =
    baseImponibleUsd + handlingAeroboxUsd + gastosNoRecuperablesUsd + envioDomicilioUsd
  const costoRealOperativoUsd = costoLandedUsd

  // 3) Fricción transaccional 6.5% sobre landed.
  const impuestosTransaccionalesUsd = costoLandedUsd * IMPUESTOS_TRANSACCIONALES_RATE
  const costoConFriccionUsd = costoLandedUsd * (1 + IMPUESTOS_TRANSACCIONALES_RATE)

  // 4) Margen neto variable sobre costo con fricción.
  const margin = resolveImportadosMargin(costoProductoUsd)
  const subtotalConMargenUsd =
    costoConFriccionUsd * (1 + margin.marginRate) + margin.fixedUsd

  // 5) Modelo híbrido: solo 7.5% por costo de liquidez de las percepciones.
  const bufferFinancieroUsd = baseImponibleUsd * BUFFER_FINANCIERO_RATE

  // 6) Precio final USD → ARS con MEP + 2% buffer.
  const precioContadoUsd = subtotalConMargenUsd + bufferFinancieroUsd
  const gananciaNetaUsd = subtotalConMargenUsd - costoConFriccionUsd
  const dolarMepConvertido = dolarArs * (1 + DOLAR_MEP_BUFFER_RATE)

  const rawContadoArs = precioContadoUsd * dolarMepConvertido
  const precioContadoArs = normalizeStorePriceArs(rawContadoArs)
  const precioCuotasArs = precioCuotasFromContadoArs(precioContadoArs)
  const gananciaNetaArs = gananciaNetaUsd * dolarMepConvertido

  return {
    valid: true,
    baseImponibleUsd,
    fleteAeroboxUsd,
    handlingAeroboxUsd,
    gastosNoRecuperablesUsd,
    bufferFinancieroUsd,
    envioDomicilioUsd,
    costoLandedUsd,
    costoRealOperativoUsd,
    impuestosTransaccionalesUsd,
    costoConFriccionUsd,
    subtotalConMargenUsd,
    margin,
    precioContadoUsd,
    gananciaNetaUsd,
    dolarMepConvertido,
    precioContadoArs,
    precioCuotasArs,
    gananciaNetaArs,
    costoProductoArs: costoProductoUsd * dolarMepConvertido,
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
  'pesoKg' | 'aeroboxUsdPorKg' | 'fleteInternoUsd' | 'envioDomicilioUsd' | 'dolarArs'
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
  const num = (key: keyof ImportadosPrefs, fallback: number): number => {
    const value = Number(obj[key])
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }

  let envioFallback = DEFAULT_IMPORTADOS_INPUTS.envioDomicilioUsd
  if (obj.envioDomicilioUsd === undefined || obj.envioDomicilioUsd === null || obj.envioDomicilioUsd === '') {
    const legacy = legacyDestinoToUsd(String(obj.destinoEnvio ?? ''))
    if (legacy !== null) envioFallback = legacy
  }

  return {
    pesoKg: num('pesoKg', DEFAULT_IMPORTADOS_INPUTS.pesoKg),
    aeroboxUsdPorKg: num('aeroboxUsdPorKg', DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg),
    fleteInternoUsd: num('fleteInternoUsd', DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd),
    envioDomicilioUsd: num('envioDomicilioUsd', envioFallback),
    dolarArs: num('dolarArs', DEFAULT_IMPORTADOS_INPUTS.dolarArs),
  }
}

function defaultPrefs(): ImportadosPrefs {
  return {
    pesoKg: DEFAULT_IMPORTADOS_INPUTS.pesoKg,
    aeroboxUsdPorKg: DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg,
    fleteInternoUsd: DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd,
    envioDomicilioUsd: DEFAULT_IMPORTADOS_INPUTS.envioDomicilioUsd,
    dolarArs: DEFAULT_IMPORTADOS_INPUTS.dolarArs,
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
