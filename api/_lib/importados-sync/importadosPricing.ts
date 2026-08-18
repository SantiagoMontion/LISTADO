/**
 * Pricing for sync → Shopify (mirrors src/lib/importadosCalc.ts).
 * Modo ola: Aerobox 19 USD/kg (20 kg ref), handling + guía AR prorrateados entre 15 u.
 * MEP +2% buffer; cuotas = contado / 0.7797 (peor caso MP 6 cuotas).
 */

export const GASTOS_NO_RECUPERABLES_RATE = 0.06
export const BUFFER_FINANCIERO_RATE = 0.075
export const HANDLING_AEROBOX_USD = 1.5
export const IMPUESTOS_TRANSACCIONALES_RATE = 0.065
export const DOLAR_MEP_BUFFER_RATE = 0.02
export const CUOTAS_MP_NET_FACTOR = 0.7797

/** Ola de referencia: ~20 kg @ 19 USD/kg, ~15 unidades compartiendo fijos. */
export const OLA_REF_UNITS = 15
export const OLA_GUIA_AR_USD = 15
export const OLA_AEROBOX_USD_KG = 19

export type ImportadosProductKind =
  | 'teclado'
  | 'mouse'
  | 'keycap'
  | 'mousepad'
  | 'sleeve'
  | 'cable'
  | 'otro'

/** Defaults fijos para creación / sync Importados (precio ola). */
export const SYNC_IMPORTADOS_DEFAULTS = {
  aeroboxUsdPorKg: OLA_AEROBOX_USD_KG,
  fleteInternoUsd: 0,
  envioDomicilioUsd: OLA_GUIA_AR_USD / OLA_REF_UNITS + 5,
  handlingAeroboxUsd: HANDLING_AEROBOX_USD / OLA_REF_UNITS,
  dolarArs: 1530,
}

export type SyncImportadosInputs = {
  costoProductoUsd: number
  pesoKg: number
  aeroboxUsdPorKg?: number
  fleteInternoUsd?: number
  envioDomicilioUsd?: number
  handlingAeroboxUsd?: number
  dolarArs?: number
}

export type SyncImportadosQuote = {
  /** Contado / transferencia (ARS) — precio Shopify */
  precioContadoArs: number
  precioContadoUsd: number
  /** Tarjeta / cuotas (ARS), blindado MP 6 cuotas */
  precioCuotasArs: number
  dolarMepConvertido: number
  fleteAeroboxUsd: number
  envioDomicilioUsd: number
  marginLabel: string
  /** Costo operativo unitario con fricción (USD), sin margen de venta */
  costoConFriccionUsd: number
  /** Mismo costo convertido con MEP +2% */
  costoConFriccionArs: number
}

export function resolveImportadosKind(handle: string, title: string): ImportadosProductKind {
  const s = `${handle} ${title}`.toLowerCase()
  if (/keycap|keycaps/.test(s)) return 'keycap'
  if (/sleeve/.test(s)) return 'sleeve'
  if (/cable/.test(s) && !/keyboard/.test(s)) return 'cable'
  if (/mousepad|pad/.test(s) && !/key/.test(s)) return 'mousepad'
  if (/\bmouse\b|gaming-mouse/.test(s)) return 'mouse'
  if (/keyboard|teclado|hall-effect|he-/.test(s)) return 'teclado'
  return 'otro'
}

/** Correo local AR prorrateado por unidad (Andreani / similar). */
export function localCorreoUsd(kind: ImportadosProductKind): number {
  switch (kind) {
    case 'mouse':
    case 'keycap':
    case 'sleeve':
    case 'cable':
      return 4
    case 'mousepad':
      return 8
    case 'teclado':
      return 7
    default:
      return 5
  }
}

/** Guía AR + correo local en modo ola (USD por unidad). */
export function envioDomicilioOlaUsd(kind: ImportadosProductKind): number {
  return OLA_GUIA_AR_USD / OLA_REF_UNITS + localCorreoUsd(kind)
}

export function handlingOlaUsd(): number {
  return HANDLING_AEROBOX_USD / OLA_REF_UNITS
}

export function syncImportadosQuoteInputs(opts: {
  costoProductoUsd: number
  pesoKg: number
  dolarArs: number
  kind?: ImportadosProductKind
  handle?: string
  title?: string
}): SyncImportadosInputs {
  const kind = opts.kind ?? resolveImportadosKind(opts.handle ?? '', opts.title ?? '')
  return {
    aeroboxUsdPorKg: OLA_AEROBOX_USD_KG,
    fleteInternoUsd: 0,
    envioDomicilioUsd: envioDomicilioOlaUsd(kind),
    handlingAeroboxUsd: handlingOlaUsd(),
    dolarArs: opts.dolarArs,
    costoProductoUsd: opts.costoProductoUsd,
    pesoKg: opts.pesoKg,
  }
}

function resolveMargin(costoProductoUsd: number): { label: string; marginRate: number; fixedUsd: number } {
  if (costoProductoUsd < 50) {
    return { label: '< $50 · 18%', marginRate: 0.18, fixedUsd: 0 }
  }
  if (costoProductoUsd <= 120) {
    return { label: '$50–$120 · 14%', marginRate: 0.14, fixedUsd: 0 }
  }
  return { label: '> $120 · 12%', marginRate: 0.12, fixedUsd: 0 }
}

export function normalizeStorePriceArs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (raw < 100) return Math.ceil(raw)
  if (raw < 500) return Math.ceil(raw / 100) * 100
  return Math.round(raw / 500) * 500
}

export function precioCuotasFromContadoArs(precioContadoArs: number): number {
  if (!Number.isFinite(precioContadoArs) || precioContadoArs <= 0) return 0
  return Math.round(precioContadoArs / CUOTAS_MP_NET_FACTOR)
}

export function quoteImportadosForSync(inputs: SyncImportadosInputs): SyncImportadosQuote {
  const costoProductoUsd = Number(inputs.costoProductoUsd)
  const pesoKg = Number(inputs.pesoKg)
  const aeroboxUsdPorKg = Number(inputs.aeroboxUsdPorKg ?? SYNC_IMPORTADOS_DEFAULTS.aeroboxUsdPorKg)
  const fleteInternoUsd = Number(inputs.fleteInternoUsd ?? SYNC_IMPORTADOS_DEFAULTS.fleteInternoUsd)
  const envioDomicilioUsd = Number(
    inputs.envioDomicilioUsd ?? SYNC_IMPORTADOS_DEFAULTS.envioDomicilioUsd,
  )
  const handlingAeroboxUsd = Number(
    inputs.handlingAeroboxUsd ?? SYNC_IMPORTADOS_DEFAULTS.handlingAeroboxUsd,
  )
  const dolarArs = Number(inputs.dolarArs ?? SYNC_IMPORTADOS_DEFAULTS.dolarArs)

  if (!Number.isFinite(costoProductoUsd) || costoProductoUsd <= 0) {
    throw new Error('Costo del producto USD inválido')
  }
  if (!Number.isFinite(pesoKg) || pesoKg <= 0) {
    throw new Error('Ingresá el peso del paquete en kg (mayor a 0)')
  }
  if (!Number.isFinite(dolarArs) || dolarArs <= 0) {
    throw new Error('Cotización dólar inválida')
  }
  if (!Number.isFinite(envioDomicilioUsd) || envioDomicilioUsd < 0) {
    throw new Error('Envío a domicilio inválido')
  }

  const fleteAeroboxUsd = pesoKg * aeroboxUsdPorKg
  const baseImponibleUsd = costoProductoUsd + fleteInternoUsd + fleteAeroboxUsd
  const gastosNoRecuperablesUsd = baseImponibleUsd * GASTOS_NO_RECUPERABLES_RATE
  const costoLandedUsd =
    baseImponibleUsd + handlingAeroboxUsd + gastosNoRecuperablesUsd + envioDomicilioUsd
  const costoConFriccionUsd = costoLandedUsd * (1 + IMPUESTOS_TRANSACCIONALES_RATE)
  const margin = resolveMargin(costoProductoUsd)
  const subtotalConMargenUsd =
    costoConFriccionUsd * (1 + margin.marginRate) + margin.fixedUsd
  const bufferFinancieroUsd = baseImponibleUsd * BUFFER_FINANCIERO_RATE
  const precioContadoUsd = subtotalConMargenUsd + bufferFinancieroUsd
  const dolarMepConvertido = dolarArs * (1 + DOLAR_MEP_BUFFER_RATE)
  const precioContadoArs = normalizeStorePriceArs(precioContadoUsd * dolarMepConvertido)
  const precioCuotasArs = precioCuotasFromContadoArs(precioContadoArs)

  return {
    precioContadoArs,
    precioContadoUsd,
    precioCuotasArs,
    dolarMepConvertido,
    fleteAeroboxUsd,
    envioDomicilioUsd,
    marginLabel: margin.label,
    costoConFriccionUsd,
    costoConFriccionArs: costoConFriccionUsd * dolarMepConvertido,
  }
}

/** Costo unitario ARS (Aerobox + handling + SAS + fricción + MEP). Null si falta input. */
export function unitCostWithFrictionArs(inputs: {
  costoProductoUsd: number | null | undefined
  pesoKg: number | null | undefined
  dolarArs: number | null | undefined
  kind?: ImportadosProductKind
  handle?: string
  title?: string
}): number | null {
  const costoProductoUsd = Number(inputs.costoProductoUsd)
  const pesoKg = Number(inputs.pesoKg)
  const dolarArs = Number(inputs.dolarArs)
  if (!Number.isFinite(costoProductoUsd) || costoProductoUsd <= 0) return null
  if (!Number.isFinite(pesoKg) || pesoKg <= 0) return null
  if (!Number.isFinite(dolarArs) || dolarArs <= 0) return null
  try {
    return quoteImportadosForSync(
      syncImportadosQuoteInputs({
        costoProductoUsd,
        pesoKg,
        dolarArs,
        kind: inputs.kind,
        handle: inputs.handle,
        title: inputs.title,
      }),
    ).costoConFriccionArs
  } catch {
    return null
  }
}

/** Precio Shopify: cuotas / tarjeta (ARS), blindado MP 6 cuotas. */
export function shopifyPriceFromQuote(quote: SyncImportadosQuote): number {
  return normalizeStorePriceArs(quote.precioCuotasArs)
}

/** ARS de venta NotMid a partir de costo USD proveedor + peso + MEP (precio ola). */
export function shopifyArsFromSupplierUsd(opts: {
  costoProductoUsd: number
  pesoKg: number
  dolarArs: number
  kind?: ImportadosProductKind
  handle?: string
  title?: string
}): number {
  const quote = quoteImportadosForSync(syncImportadosQuoteInputs(opts))
  return shopifyPriceFromQuote(quote)
}

export function pricesArsEqual(a: number | null | undefined, b: number): boolean {
  if (a === null || a === undefined || !Number.isFinite(a)) return false
  return Math.abs(Number(a) - b) < 0.5
}
