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
 * Lethal en /es/ responde en español («solo se añadieron N artículos…»).
 */
const AVAILABILITY_PATTERNS: RegExp[] = [
  /Only\s+(\d+)\s+items?\s+(?:was|were)\s+added/i,
  /All\s+(\d+)\s+.+?\s+are\s+in\s+your\s+cart/i,
  /You\s+can\s+only\s+add\s+(\d+)\s+/i,
  /only\s+have\s+(\d+)\s+(?:left|in\s+stock)/i,
  /there\s+(?:is|are)\s+only\s+(\d+)\s+/i,
  // ES: "Debido a la disponibilidad, solo se añadieron 2 artículos al carrito."
  /solo\s+se\s+añadi(?:ó|eron)\s+(\d+)\s+art[ií]culos?/i,
  /solo\s+se\s+agreg(?:ó|aron)\s+(\d+)\s+art[ií]culos?/i,
  /s[oó]lo\s+(\d+)\s+art[ií]culos?\s+(?:fue(?:ron)?\s+)?añad/i,
  /disponible[s]?\s*[:=]?\s*(\d+)/i,
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
  // Siempre carrito en el origen raíz (sin /es): mismos variant ids, mensajes EN.
  let base = origin.replace(/\/$/, '')
  try {
    base = new URL(origin.includes('://') ? origin : `https://${origin}`).origin
  } catch {
    base = origin.replace(/\/$/, '').replace(/\/[a-z]{2}$/i, '')
  }
  const id = Number(variantId)
  if (!Number.isFinite(id) || id <= 0) {
    return { added: 0, ok: false, detail: 'invalid_variant_id' }
  }

  const cartHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
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
      if (added <= 0) {
        return { added: 0, ok: false, detail: 'ok_zero_qty' }
      }
    } else if (addResp.ok) {
      return { added: 0, ok: false, detail: 'empty_ok_response' }
    } else {
      const msg = `${json?.message || ''} ${json?.description || ''}`
      const partial = parseLethalAvailability(msg)
      if (partial !== null) {
        added = partial
      } else if (
        // Solo mensajes inequívocos de OOS. NUNCA "cannot add" / genéricos:
        // Cloudflare y errores de bot los matcheaban y apagaban stock real.
        /sold\s*out|agotado|out\s+of\s+stock|sin\s+stock|not\s+enough\s+(?:inventory|stock|items?)|insufficient\s+(?:inventory|stock)|no\s+(?:hay|queda(?:n)?)\s+stock/i.test(
          msg,
        )
      ) {
        added = 0
      } else if (addResp.status >= 500) {
        return { added: 0, ok: false, detail: `server_${addResp.status}` }
      } else {
        // 422/otro sin mensaje reconocible: NO asumir 0 (antes apagaba stock real).
        return {
          added: 0,
          ok: false,
          detail: `unparsed_${addResp.status}:${msg.trim().slice(0, 120)}`,
        }
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
 * Stock “seguro” para NotMid desde Lethal: lo que acepta el carrito menos 1
 * (nos reservamos 1 unidad para no sobrevender).
 * Si deja agregar 3 → 2; si deja agregar 2 → 1; si solo deja 1 → 1
 * (antes daba 0 y apagaba productos que Lethal seguía mostrando en stock).
 *
 * Importante: si el probe es dudoso (rate-limit / .js dice OOS sin confirmar),
 * `reliable: false` → el sync NO debe pisar NotMid a 0.
 */
export type LethalSafeQtyResult = {
  qty: number
  reliable: boolean
  detail?: string
}

export async function lethalSafeNotmidQtyDetailed(
  origin: string,
  variantId: string,
  availableFlag: boolean,
  opts?: {
    /** Relee .js antes de confiar un 0 (el flag a veces miente tras 429/CF). */
    recheckStorefrontAvailable?: () => Promise<boolean>
  },
): Promise<LethalSafeQtyResult> {
  // Aunque .js diga unavailable, sondeamos el carrito: el flag a veces miente
  // y antes dejábamos NotMid en 0 hasta el próximo sync “bueno”.
  let available = availableFlag
  let probe = await probeLethalCartAvailableQty(origin, variantId)
  for (const wait of [1500, 4000]) {
    if (probe.ok) break
    await sleep(wait)
    probe = await probeLethalCartAvailableQty(origin, variantId)
  }

  if (!probe.ok) {
    // Dudoso: no apagar. Si .js decía en stock, dejar 1; si decía OOS, qty 0 pero unreliable.
    return {
      qty: available ? 1 : 0,
      reliable: false,
      detail: probe.detail || 'probe_failed',
    }
  }

  if (probe.added <= 0) {
    // .js dice available pero el carrito “0” → casi seguro falso.
    if (available) {
      return { qty: 1, reliable: false, detail: 'cart_zero_but_js_available' }
    }

    // OOS “hard”: obligamos a re-leer .js. Sin recheck → NO confiable (evita ceros fantasmas).
    if (!opts?.recheckStorefrontAvailable) {
      return { qty: 0, reliable: false, detail: 'oos_needs_js_recheck' }
    }

    let freshAvailable = false
    try {
      freshAvailable = await opts.recheckStorefrontAvailable()
    } catch {
      return { qty: 0, reliable: false, detail: 'js_recheck_failed' }
    }

    if (freshAvailable) {
      available = true
      await sleep(700)
      const again = await probeLethalCartAvailableQty(origin, variantId)
      if (!again.ok) {
        return { qty: 1, reliable: false, detail: `js_available_probe_fail:${again.detail || ''}` }
      }
      if (again.added <= 0) {
        return { qty: 1, reliable: false, detail: 'js_available_cart_zero' }
      }
      if (again.added === 1) return { qty: 1, reliable: true, detail: 'js_recheck_available_1' }
      return { qty: again.added - 1, reliable: true, detail: 'js_recheck_available' }
    }

    // .js fresco sigue OOS: segundo probe de carrito obligatorio.
    await sleep(900)
    const confirm = await probeLethalCartAvailableQty(origin, variantId)
    if (!confirm.ok) {
      return { qty: 0, reliable: false, detail: `oos_unconfirmed:${confirm.detail || ''}` }
    }
    if (confirm.added > 0) {
      if (confirm.added === 1) return { qty: 1, reliable: true, detail: 'oos_recheck_has_1' }
      return { qty: confirm.added - 1, reliable: true, detail: 'oos_recheck_has_stock' }
    }
    // Hard OOS: .js unavailable (reconfirmado) + carrito rechaza 2 veces.
    return { qty: 0, reliable: true, detail: 'hard_oos_js_and_cart' }
  }
  if (probe.added === 1) return { qty: 1, reliable: true }
  return { qty: probe.added - 1, reliable: true }
}

export async function lethalSafeNotmidQty(
  origin: string,
  variantId: string,
  availableFlag: boolean,
): Promise<number> {
  const result = await lethalSafeNotmidQtyDetailed(origin, variantId, availableFlag)
  // Compat: si era dudoso y .js OOS, preferimos 1 para no apagar en callers legacy.
  if (!result.reliable && result.qty <= 0) return availableFlag ? 1 : result.qty
  return result.qty
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

export async function lethalSafeNotmidQtyThrottledDetailed(
  origin: string,
  variantId: string,
  availableFlag: boolean,
  delayMs = 900,
  opts?: {
    recheckStorefrontAvailable?: () => Promise<boolean>
  },
): Promise<LethalSafeQtyResult> {
  const result = await lethalSafeNotmidQtyDetailed(origin, variantId, availableFlag, opts)
  await sleep(delayMs)
  return result
}
