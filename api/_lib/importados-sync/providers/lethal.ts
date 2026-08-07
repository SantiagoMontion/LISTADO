import type { TrackedProduct } from '../supabase.js'
import {
  BROWSER_HEADERS,
  fail,
  fetchWithTimeout,
  parsePrice,
  type ProviderResult,
} from './types.js'

function resolveHandle(product: TrackedProduct): string {
  const fromColumn = (product.shopify_handle ?? '').trim()
  if (fromColumn) return fromColumn

  try {
    const url = new URL(product.product_url)
    const match = url.pathname.match(/\/products\/([^/?#]+)/i)
    if (match?.[1]) return decodeURIComponent(match[1])
  } catch {
    // fall through
  }

  throw new Error(
    'Lethal product missing shopify_handle and could not parse handle from product_url',
  )
}

function centsOrDollars(price: unknown): number | null {
  if (typeof price === 'number' && Number.isFinite(price)) {
    // .js suele venir en centavos (3995 → 39.95); .json a veces en string "39.95"
    if (Number.isInteger(price) && price >= 100) return price / 100
    return price
  }
  if (typeof price === 'string' && /^\d+$/.test(price.trim())) {
    const n = Number(price.trim())
    if (n >= 100) return n / 100
    return n
  }
  return parsePrice(price)
}

/**
 * Lethal: solo available true/false por variante (sin unidades públicas).
 * inStock = alguna variante available.
 * Precio = mínimo entre variantes.
 */
export async function fetchLethalSnapshot(product: TrackedProduct): Promise<ProviderResult> {
  try {
    const handle = resolveHandle(product)
    const url = `https://lethal.gg/products/${encodeURIComponent(handle)}.js`

    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        ...BROWSER_HEADERS,
        Accept: 'application/json',
      },
    })

    if (!resp.ok) return fail(`Lethal fetch failed (${resp.status}) for ${url}`)

    const json = (await resp.json()) as {
      variants?: Array<{
        price?: string | number
        available?: boolean
      }>
      available?: boolean
    }

    const variants = json.variants ?? []
    if (!variants.length) return fail(`Lethal product has no variants: ${handle}`)

    const prices = variants
      .map((v) => centsOrDollars(v.price))
      .filter((p): p is number => p !== null && p > 0)

    const price = prices.length ? Math.min(...prices) : null
    if (price === null) {
      return fail(`Lethal could not parse price for ${handle}`)
    }

    const inStock =
      variants.some((v) => v.available === true) || json.available === true

    return {
      ok: true,
      data: { price, inStock },
    }
  } catch (error) {
    return fail(error)
  }
}
