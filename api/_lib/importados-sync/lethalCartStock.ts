import { BROWSER_HEADERS, fetchWithTimeout } from './providers/types.js'

type CookieJar = Map<string, string>

function storeCookies(jar: CookieJar, resp: Response): void {
  const raw =
    typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : []
  for (const c of raw) {
    const [pair] = c.split(';')
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Shopify avisa el tope real en el mensaje de error. Ojo con el singular:
 * con 1 unidad dice «Only 1 item **was** added», no «were».
 */
const AVAILABILITY_PATTERNS: RegExp[] = [
  /Only\s+(\d+)\s+items?\s+(?:was|were)\s+added/i,
  /All\s+(\d+)\s+.+?\s+are\s+in\s+your\s+cart/i,
  /You\s+can\s+only\s+add\s+(\d+)\s+/i,
  /only\s+have\s+(\d+)\s+(?:left|in\s+stock)/i,
  /there\s+(?:is|are)\s+only\s+(\d+)\s+/i,
]

export function parseLethalAvailability(message: string): number | null {
  const text = message || ''
  for (const pattern of AVAILABILITY_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const n = Number(match[1])
    if (Number.isFinite(n)) return n
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type LethalCartProbeResult = {
  /** Unidades que el carrito aceptó al pedir `requestQty`. */
  added: number
  /** true si la prueba fue confiable (no rate-limit / challenge). */
  ok: boolean
  detail?: string
}

type LethalCartResponse = {
  items?: Array<{ quantity?: number; variant_id?: number }>
  message?: string
  description?: string
}

/**
 * Cuánto pedimos al carrito para que Shopify nos revele el stock real en el
 * mensaje de error. Si acepta todo, no podemos ver más allá de este número.
 */
export const LETHAL_PROBE_QTY = 100

/**
 * Prueba cuántas unidades acepta el carrito de Lethal para una variante.
 * Pedimos una cantidad alta: si el proveedor tiene menos, responde 422 con
 * «Only N items were added…», que es el stock exacto.
 */
export async function probeLethalCartAvailableQty(
  origin: string,
  variantId: string,
  requestQty = LETHAL_PROBE_QTY,
): Promise<LethalCartProbeResult> {
  const jar: CookieJar = new Map()
  const base = origin.replace(/\/$/, '')
  const id = Number(variantId)
  if (!Number.isFinite(id) || id <= 0) {
    return { added: 0, ok: false, detail: 'invalid_variant_id' }
  }

  const cartHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: base,
    Referer: `${base}/`,
    'X-Requested-With': 'XMLHttpRequest',
  }

  try {
    const addResp = await fetchWithTimeout(
      `${base}/cart/add.js`,
      {
        method: 'POST',
        headers: {
          ...cartHeaders,
          Cookie: cookieHeader(jar),
        },
        body: JSON.stringify({ items: [{ id, quantity: requestQty }] }),
      },
      12_000,
    )
    storeCookies(jar, addResp)
    const text = await addResp.text()

    // Cloudflare / bot wall
    if (
      addResp.status === 429 ||
      addResp.status === 403 ||
      /verifying your connection|cf-browser-verification|just a moment/i.test(text)
    ) {
      return { added: 0, ok: false, detail: `blocked_${addResp.status}` }
    }

    let json: LethalCartResponse | null = null
    try {
      json = text ? (JSON.parse(text) as LethalCartResponse) : null
    } catch {
      return { added: 0, ok: false, detail: 'non_json_response' }
    }

    let added = 0
    if (addResp.ok && json?.items?.length) {
      const line =
        json.items.find((it) => String(it.variant_id) === String(id)) ?? json.items[0]
      added = Number(line?.quantity ?? 0) || 0
    } else {
      const msg = `${json?.message || ''} ${json?.description || ''}`
      const partial = parseLethalAvailability(msg)
      if (partial !== null) added = partial
      else if (/sold\s*out|not\s+enough|insufficient|cannot.*add/i.test(msg)) added = 0
      else if (addResp.status >= 500) {
        return { added: 0, ok: false, detail: `server_${addResp.status}` }
      }
    }

    try {
      await fetchWithTimeout(
        `${base}/cart/clear.js`,
        {
          method: 'POST',
          headers: {
            ...cartHeaders,
            Cookie: cookieHeader(jar),
          },
          body: '{}',
        },
        8_000,
      )
    } catch {
      // ignore clear failures
    }

    return { added: Math.max(0, added), ok: true }
  } catch (err) {
    return {
      added: 0,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Stock “seguro” para NotMid desde Lethal: lo que acepta el carrito menos 1.
 * Si deja agregar 3 → 2; si deja agregar 8 → 7; si solo deja 1 → 0.
 * Si el probe falla (rate limit de Cloudflare) → 1, para no apagar el catálogo
 * entero por un bloqueo puntual.
 */
export async function lethalSafeNotmidQty(
  origin: string,
  variantId: string,
  availableFlag: boolean,
): Promise<number> {
  if (!availableFlag) return 0

  let probe = await probeLethalCartAvailableQty(origin, variantId)
  // Cloudflare nos corta seguido: reintentos con espera creciente.
  for (const wait of [1500, 4000]) {
    if (probe.ok) break
    await sleep(wait)
    probe = await probeLethalCartAvailableQty(origin, variantId)
  }

  if (!probe.ok) return 1
  return Math.max(0, probe.added - 1)
}

/** Espacio entre probes de variantes para no gatillar rate-limit. */
export async function lethalSafeNotmidQtyThrottled(
  origin: string,
  variantId: string,
  availableFlag: boolean,
  delayMs = 900,
): Promise<number> {
  const qty = await lethalSafeNotmidQty(origin, variantId, availableFlag)
  await sleep(delayMs)
  return qty
}
