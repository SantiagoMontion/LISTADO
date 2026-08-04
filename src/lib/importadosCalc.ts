/** Calculadora de nacionalización / importados (USD → ARS). */

/** Envío a domicilio en Argentina (por guía, USD). */
export type ImportadosDestinoEnvio = 'caba' | 'provincia' | 'interior'

export const DESTINO_ENVIO_OPTIONS: {
  id: ImportadosDestinoEnvio
  label: string
  usd: number
}[] = [
  { id: 'caba', label: 'CABA', usd: 8 },
  { id: 'provincia', label: 'Provincia', usd: 12 },
  { id: 'interior', label: 'Interior', usd: 23 },
]

export function envioDomicilioUsdForDestino(destino: ImportadosDestinoEnvio): number {
  return DESTINO_ENVIO_OPTIONS.find((o) => o.id === destino)?.usd ?? 12
}

export interface ImportadosInputs {
  /** Costo del producto en EE. UU. (USD) */
  costoProductoUsd: number
  /** Peso del paquete (kg) — Aerobox cobra solo por peso real, no por volumen */
  pesoKg: number
  /** Tarifa aérea Aerobox (USD por kg) */
  aeroboxUsdPorKg: number
  /** Flete interno en EE. UU. (USD) */
  fleteInternoUsd: number
  /** Destino del envío a domicilio en Argentina */
  destinoEnvio: ImportadosDestinoEnvio
  /** Cotización dólar financiero / MEP / CCL (ARS) */
  dolarArs: number
  /** Recargo por cuotas / financiación (0–100) */
  recargoCuotasPct: number
}

export interface ImportadosMarginBand {
  label: string
  /** Fracción 0–1 (ej. 0.4 = 40%) */
  marginRate: number
  /** USD fijos extra (solo banda ≤ $30) */
  fixedUsd: number
}

export interface ImportadosResults {
  valid: true
  fleteAeroboxUsd: number
  impuestosSaUsd: number
  envioDomicilioUsd: number
  destinoEnvio: ImportadosDestinoEnvio
  costoLandedUsd: number
  margin: ImportadosMarginBand
  precioContadoUsd: number
  gananciaNetaUsd: number
  precioContadoArs: number
  precioCuotasArs: number
  gananciaNetaArs: number
  costoProductoArs: number
  fleteAeroboxArs: number
  impuestosSaArs: number
  envioDomicilioArs: number
  costoLandedArs: number
}

export interface ImportadosInvalidResults {
  valid: false
  errors: string[]
}

export type ImportadosCalcOutput = ImportadosResults | ImportadosInvalidResults

export const AEROBOX_USD_PER_KG = 17
export const IMPUESTOS_SA_RATE = 0.32

export const DEFAULT_IMPORTADOS_INPUTS: ImportadosInputs = {
  costoProductoUsd: 0,
  pesoKg: 0.3,
  aeroboxUsdPorKg: AEROBOX_USD_PER_KG,
  fleteInternoUsd: 0,
  destinoEnvio: 'provincia',
  dolarArs: 1350,
  recargoCuotasPct: 20,
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

/** Margen escalable según costo de producto USD. */
export function resolveImportadosMargin(costoProductoUsd: number): ImportadosMarginBand {
  if (costoProductoUsd <= 30) {
    return { label: '≤ $30 · 40% + $10', marginRate: 0.4, fixedUsd: 10 }
  }
  if (costoProductoUsd <= 100) {
    return { label: '$30–$100 · 30%', marginRate: 0.3, fixedUsd: 0 }
  }
  if (costoProductoUsd <= 250) {
    return { label: '$100–$250 · 22%', marginRate: 0.22, fixedUsd: 0 }
  }
  return { label: '> $250 · 18%', marginRate: 0.18, fixedUsd: 0 }
}

export function computeImportados(inputs: ImportadosInputs): ImportadosCalcOutput {
  const errors: string[] = []
  const costoProductoUsd = nonNegative(inputs.costoProductoUsd, 'Costo del producto', errors)
  const pesoKg = nonNegative(inputs.pesoKg, 'Peso', errors)
  const aeroboxUsdPorKg = nonNegative(inputs.aeroboxUsdPorKg, 'Tarifa Aerobox', errors)
  const fleteInternoUsd = nonNegative(inputs.fleteInternoUsd, 'Flete interno', errors)
  const dolarArs = nonNegative(inputs.dolarArs, 'Cotización dólar', errors)
  let recargoCuotasPct = inputs.recargoCuotasPct
  if (!Number.isFinite(recargoCuotasPct)) {
    errors.push('Recargo por cuotas no es un número válido.')
    recargoCuotasPct = 0
  } else if (recargoCuotasPct < 0) {
    errors.push('Recargo por cuotas no puede ser negativo.')
    recargoCuotasPct = 0
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

  // Solo peso real (kg). Aerobox no cobra volumen / dimensional weight.
  const fleteAeroboxUsd = pesoKg * aeroboxUsdPorKg
  const baseImponibleUsd = costoProductoUsd + fleteInternoUsd + fleteAeroboxUsd
  const impuestosSaUsd = baseImponibleUsd * IMPUESTOS_SA_RATE
  const destinoEnvio = DESTINO_ENVIO_OPTIONS.some((o) => o.id === inputs.destinoEnvio)
    ? inputs.destinoEnvio
    : DEFAULT_IMPORTADOS_INPUTS.destinoEnvio
  const envioDomicilioUsd = envioDomicilioUsdForDestino(destinoEnvio)
  // Impuestos S.A. no incluyen el envío local AR; se suma después al landed.
  const costoLandedUsd = baseImponibleUsd + impuestosSaUsd + envioDomicilioUsd

  const margin = resolveImportadosMargin(costoProductoUsd)
  const precioContadoUsd = costoLandedUsd * (1 + margin.marginRate) + margin.fixedUsd
  const gananciaNetaUsd = precioContadoUsd - costoLandedUsd

  const precioContadoArs = precioContadoUsd * dolarArs
  const precioCuotasArs = precioContadoArs * (1 + recargoCuotasPct / 100)
  const gananciaNetaArs = gananciaNetaUsd * dolarArs

  return {
    valid: true,
    fleteAeroboxUsd,
    impuestosSaUsd,
    envioDomicilioUsd,
    destinoEnvio,
    costoLandedUsd,
    margin,
    precioContadoUsd,
    gananciaNetaUsd,
    precioContadoArs,
    precioCuotasArs,
    gananciaNetaArs,
    costoProductoArs: costoProductoUsd * dolarArs,
    fleteAeroboxArs: fleteAeroboxUsd * dolarArs,
    impuestosSaArs: impuestosSaUsd * dolarArs,
    envioDomicilioArs: envioDomicilioUsd * dolarArs,
    costoLandedArs: costoLandedUsd * dolarArs,
  }
}

export type ImportadosPrefs = Pick<
  ImportadosInputs,
  'pesoKg' | 'aeroboxUsdPorKg' | 'fleteInternoUsd' | 'destinoEnvio' | 'dolarArs' | 'recargoCuotasPct'
>

export function coerceImportadosPrefs(raw: unknown): ImportadosPrefs {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const num = (key: Exclude<keyof ImportadosPrefs, 'destinoEnvio'>, fallback: number): number => {
    const value = Number(obj[key])
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }
  const destinoRaw = String(obj.destinoEnvio ?? '')
  const destinoEnvio = DESTINO_ENVIO_OPTIONS.some((o) => o.id === destinoRaw)
    ? (destinoRaw as ImportadosDestinoEnvio)
    : DEFAULT_IMPORTADOS_INPUTS.destinoEnvio
  return {
    pesoKg: num('pesoKg', DEFAULT_IMPORTADOS_INPUTS.pesoKg),
    aeroboxUsdPorKg: num('aeroboxUsdPorKg', DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg),
    fleteInternoUsd: num('fleteInternoUsd', DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd),
    destinoEnvio,
    dolarArs: num('dolarArs', DEFAULT_IMPORTADOS_INPUTS.dolarArs),
    recargoCuotasPct: num('recargoCuotasPct', DEFAULT_IMPORTADOS_INPUTS.recargoCuotasPct),
  }
}

function defaultPrefs(): ImportadosPrefs {
  return {
    pesoKg: DEFAULT_IMPORTADOS_INPUTS.pesoKg,
    aeroboxUsdPorKg: DEFAULT_IMPORTADOS_INPUTS.aeroboxUsdPorKg,
    fleteInternoUsd: DEFAULT_IMPORTADOS_INPUTS.fleteInternoUsd,
    destinoEnvio: DEFAULT_IMPORTADOS_INPUTS.destinoEnvio,
    dolarArs: DEFAULT_IMPORTADOS_INPUTS.dolarArs,
    recargoCuotasPct: DEFAULT_IMPORTADOS_INPUTS.recargoCuotasPct,
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
