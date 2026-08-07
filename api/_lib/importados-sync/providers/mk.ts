import {
  BROWSER_HEADERS,
  fail,
  fetchWithTimeout,
  parsePrice,
  type ProviderResult,
} from './types.js'
import type { TrackedProduct } from '../supabase.js'

function extractHandle(product: TrackedProduct): string {
  const fromColumn = (product.shopify_handle ?? '').trim()
  if (fromColumn) return fromColumn
  try {
    const match = new URL(product.product_url).pathname.match(/\/products\/([^/?#]+)/i)
    if (match?.[1]) return decodeURIComponent(match[1])
  } catch {
    // fall through
  }
  throw new Error('MK product missing handle')
}

/**
 * MK es Shopify: /products/{handle}.js trae available por variante.
 * inStock = alguna variante available.
 */
export async function fetchMkSnapshot(product: TrackedProduct): Promise<ProviderResult> {
  try {
    const handle = extractHandle(product)
    const origin = new URL(product.product_url).origin
    const url = `${origin}/products/${encodeURIComponent(handle)}.js`
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { ...BROWSER_HEADERS, Accept: 'application/json' },
    })
    if (!resp.ok) return fail(`MK fetch failed (${resp.status}) for ${url}`)

    const json = (await resp.json()) as {
      variants?: Array<{ price?: number | string; available?: boolean }>
      available?: boolean
    }

    const variants = json.variants ?? []
    if (!variants.length) return fail('MK product has no variants')

    const prices = variants
      .map((v) => {
        if (typeof v.price === 'number') return v.price / 100
        return parsePrice(v.price)
      })
      .filter((p): p is number => p !== null && p > 0)

    const price = prices.length ? Math.min(...prices) : null
    if (price === null) return fail('MK could not parse price')

    const inStock = variants.some((v) => v.available === true) || json.available === true

    return { ok: true, data: { price, inStock } }
  } catch (error) {
    return fail(error)
  }
}
