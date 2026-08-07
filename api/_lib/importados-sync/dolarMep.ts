const DOLAR_API_MEP_URL = 'https://dolarapi.com/v1/dolares/bolsa'
export const DEFAULT_DOLAR_MEP_FALLBACK_ARS = 1530

export type DolarMepQuote = {
  venta: number
  source: 'dolarapi' | 'fallback'
  updatedAt: string | null
}

function fallbackValue(): number {
  const configured = Number(process.env.DOLAR_MEP_FALLBACK_ARS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_DOLAR_MEP_FALLBACK_ARS
}

export async function fetchDolarMepQuote(): Promise<DolarMepQuote> {
  try {
    const resp = await fetch(DOLAR_API_MEP_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!resp.ok) throw new Error(`DólarAPI respondió ${resp.status}`)

    const json = (await resp.json()) as {
      venta?: number
      fechaActualizacion?: string
    }
    const venta = Number(json.venta)
    if (!Number.isFinite(venta) || venta <= 0) {
      throw new Error('DólarAPI devolvió una cotización inválida')
    }

    return {
      venta,
      source: 'dolarapi',
      updatedAt: json.fechaActualizacion || null,
    }
  } catch {
    return {
      venta: fallbackValue(),
      source: 'fallback',
      updatedAt: null,
    }
  }
}
