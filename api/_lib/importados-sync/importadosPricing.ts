/**
 * Pricing for sync → Shopify (mirrors src/lib/importadosCalc.ts).
 * Fixed sync defaults: Aerobox 20, envío AR 15, flete 0, dólar MEP 1530.
 * MEP +2% buffer; cuotas = contado / 0.7797 (peor caso MP 6 cuotas).
 */

export const GASTOS_NO_RECUPERABLES_RATE = 0.06
export const BUFFER_FINANCIERO_RATE = 0.075
export const HANDLING_AEROBOX_USD = 1.5
export const IMPUESTOS_TRANSACCIONALES_RATE = 0.065
export const DOLAR_MEP_BUFFER_RATE = 0.02
export const CUOTAS_MP_NET_FACTOR = 0.7797

/** Defaults fijos para creación desde Sync Importados. */
export const SYNC_IMPORTADOS_DEFAULTS = {
  aeroboxUsdPorKg: 20,
  fleteInternoUsd: 0,
  envioDomicilioUsd: 15,
  dolarArs: 1530,
}

export type SyncImportadosInputs = {
  costoProductoUsd: number
  pesoKg: number
  aeroboxUsdPorKg?: number
  fleteInternoUsd?: number
  envioDomicilioUsd?: number
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
    baseImponibleUsd + HANDLING_AEROBOX_USD + gastosNoRecuperablesUsd + envioDomicilioUsd
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
  }
}

/** Precio Shopify: cuotas / tarjeta (ARS), blindado MP 6 cuotas. */
export function shopifyPriceFromQuote(quote: SyncImportadosQuote): number {
  return normalizeStorePriceArs(quote.precioCuotasArs)
}
