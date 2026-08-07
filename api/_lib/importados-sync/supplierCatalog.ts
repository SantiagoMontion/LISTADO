import * as cheerio from 'cheerio'
import type { Provider } from './env.js'
import { lethalSafeNotmidQtyThrottled } from './lethalCartStock.js'
import { BROWSER_HEADERS, fetchWithRetries, fetchWithTimeout, parsePrice } from './providers/types.js'

export type SupplierVariant = {
  id: string
  title: string
  option1: string | null
  option2: string | null
  option3: string | null
  sku: string | null
  priceUsd: number
  available: boolean
  inventoryQuantity: number
  featuredImageUrl: string | null
}

export type SupplierCatalogProduct = {
  provider: Provider
  sourceUrl: string
  title: string
  bodyHtml: string
  vendor: string
  handle: string | null
  options: Array<{ name: string; values: string[] }>
  variants: SupplierVariant[]
  /** Todas las URLs de imagen del producto (absolutas https). */
  imageUrls: string[]
  /**
   * Foto principal real de cada variante (option1 → URL featured del proveedor).
   * Solo esta debe asociarse a la variante en Shopify.
   */
  variantFeaturedImageByOption: Record<string, string>
  /** @deprecated preferir variantFeaturedImageByOption */
  imageOptionByUrl: Record<string, string>
  /** Precio base USD (primera variante / min). */
  price: number
  /** true si alguna variante tiene stock. */
  inStock: boolean
  shopifyHandle: string | null
}

function absUrl(raw: string | null | undefined, base?: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('//')) return `https:${trimmed}`
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (base) return new URL(trimmed, base).toString()
    return null
  } catch {
    return null
  }
}

function extractHandleFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/products\/([^/?#]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function centsToUsd(cents: unknown): number | null {
  if (typeof cents === 'number' && Number.isFinite(cents)) return cents / 100
  if (typeof cents === 'string' && /^\d+$/.test(cents.trim())) {
    return Number(cents.trim()) / 100
  }
  return parsePrice(cents)
}

type ShopifyStorefrontProduct = {
  id?: number | string
  title?: string
  handle?: string
  body_html?: string
  description?: string
  vendor?: string
  available?: boolean
  options?: Array<{ name?: string; values?: string[] }>
  variants?: Array<{
    id?: number | string
    title?: string
    option1?: string | null
    option2?: string | null
    option3?: string | null
    sku?: string | null
    price?: number | string
    available?: boolean
    featured_image?: { src?: string; variant_ids?: number[] } | null
  }>
  images?: Array<string | { src?: string }>
  media?: Array<{ src?: string; alt?: string | null; media_type?: string }>
}

async function fetchShopifyProductJs(productUrl: string): Promise<{
  json: ShopifyStorefrontProduct
  handle: string
  origin: string
}> {
  const handle = extractHandleFromUrl(productUrl)
  if (!handle) throw new Error('No pude leer el handle del producto desde el link')
  const origin = new URL(productUrl).origin
  const candidates = [
    `${origin}/products/${encodeURIComponent(handle)}.js`,
    `${origin}/products/${encodeURIComponent(handle)}.json`,
  ]

  let lastStatus = 0
  let lastUrl = candidates[0]
  for (const url of candidates) {
    lastUrl = url
    const resp = await fetchWithRetries(
      url,
      {
        method: 'GET',
        headers: { ...BROWSER_HEADERS, Accept: 'application/json' },
      },
      { attempts: 4, waitsMs: [2500, 6000, 12000], timeoutMs: 15_000 },
    )
    lastStatus = resp.status
    if (!resp.ok) continue

    const text = await resp.text()
    if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
      // Cloudflare challenge HTML / bot wall
      if (/just a moment|cf-browser-verification|verifying your connection/i.test(text)) {
        lastStatus = 429
        continue
      }
      continue
    }

    try {
      const parsed = JSON.parse(text) as ShopifyStorefrontProduct & {
        product?: ShopifyStorefrontProduct
      }
      // .json envuelve el producto en { product: {...} }
      const json = parsed.product ?? parsed
      if (!json.title && !json.variants?.length) continue
      return { json, handle, origin }
    } catch {
      continue
    }
  }

  if (lastStatus === 429) {
    throw new Error(
      `Lethal/MK está limitando las consultas (429). Esperá ~1 minuto y volvé a intentar: ${lastUrl}`,
    )
  }
  throw new Error(`No pude leer ${lastUrl} (${lastStatus || 'sin respuesta'})`)
}

async function scrapeVariantInventoryQty(
  origin: string,
  handle: string,
  variantId: string,
): Promise<number> {
  const url = `${origin}/products/${encodeURIComponent(handle)}?variant=${encodeURIComponent(variantId)}`
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    })
    if (!resp.ok) return 0
    const html = await resp.text()
    const $ = cheerio.load(html)
    const info = $('#inventory_info').text().replace(/\s+/g, ' ').trim()
    const qtyMatch = info.match(/(\d+)\s+in\s+stock/i)
    if (qtyMatch) return Number(qtyMatch[1])
    if (/out\s+of\s+stock|sold\s*out/i.test(info)) return 0
    // Fallback: available flag from page buttons is unreliable; keep 0 if unknown OOS text
    if (/out\s+of\s+stock|sold\s*out/i.test(html.slice(0, 50000))) {
      // don't use global page sold-out footer
    }
    return 0
  } catch {
    return 0
  }
}

function collectImageUrls(json: ShopifyStorefrontProduct, origin: string): string[] {
  const urls: string[] = []
  for (const img of json.images ?? []) {
    const raw = typeof img === 'string' ? img : img?.src
    const abs = absUrl(raw, origin)
    if (abs) urls.push(abs)
  }
  for (const media of json.media ?? []) {
    if (media.media_type && media.media_type !== 'image') continue
    const abs = absUrl(media.src, origin)
    if (abs) urls.push(abs)
  }
  return [...new Set(urls)]
}

function buildVariantFeaturedImageByOption(
  json: ShopifyStorefrontProduct,
  origin: string,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const variant of json.variants ?? []) {
    const option = (variant.option1 || variant.title || '').trim()
    const featured = absUrl(variant.featured_image?.src, origin)
    if (option && featured && !map[option]) {
      map[option] = featured
    }
  }
  return map
}

/**
 * Fuente más fiable: /products/{handle}.json → images[].variant_ids
 * (la misma asociación que usa el admin de Shopify del proveedor).
 */
async function fetchVariantFeaturedFromProductJson(
  origin: string,
  handle: string,
  variantIdToOption: Record<string, string>,
): Promise<Record<string, string>> {
  try {
    const resp = await fetchWithRetries(
      `${origin}/products/${encodeURIComponent(handle)}.json`,
      {
        method: 'GET',
        headers: { ...BROWSER_HEADERS, Accept: 'application/json' },
      },
      { attempts: 3, waitsMs: [2000, 5000] },
    )
    if (!resp.ok) return {}
    const data = (await resp.json()) as {
      product?: {
        images?: Array<{ src?: string; position?: number; variant_ids?: Array<number | string> }>
      }
    }
    const images = [...(data.product?.images ?? [])].sort(
      (a, b) => (a.position ?? 999) - (b.position ?? 999),
    )
    const map: Record<string, string> = {}
    for (const img of images) {
      const src = absUrl(img.src, origin)
      if (!src) continue
      for (const vid of img.variant_ids ?? []) {
        const option = variantIdToOption[String(vid)]?.trim()
        if (option && !map[option]) map[option] = src
      }
    }
    return map
  } catch {
    return {}
  }
}

async function catalogFromShopifyJs(
  provider: Provider,
  productUrl: string,
): Promise<SupplierCatalogProduct> {
  const { json, handle, origin } = await fetchShopifyProductJs(productUrl)
  if (!json.title) throw new Error('El proveedor no devolvió título de producto')

  const options = (json.options ?? [])
    .filter((o) => o.name && Array.isArray(o.values) && o.values.length)
    .map((o) => ({ name: String(o.name), values: (o.values ?? []).map(String) }))

  const baseVariants = (json.variants ?? []).map((v) => {
    const id = String(v.id ?? '')
    const priceUsd = centsToUsd(v.price)
    return {
      id,
      title: (v.title || v.option1 || 'Default').trim(),
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      sku: v.sku?.trim() || null,
      priceUsd: priceUsd ?? 0,
      available: Boolean(v.available),
      inventoryQuantity: 0,
      featuredImageUrl: absUrl(v.featured_image?.src, origin),
    } satisfies SupplierVariant
  }).filter((v) => v.id && v.priceUsd > 0)

  if (!baseVariants.length) throw new Error('El producto no tiene variantes usable')

  // Stock por variante:
  // - MK: número real desde #inventory_info (si no hay número pero available → 1)
  // - Lethal: sin unidades públicas → sondear el carrito y usar (lo que acepta − 1)
  const variants: SupplierVariant[] = []
  for (const variant of baseVariants) {
    let qty = 0
    if (provider === 'lethal') {
      qty = await lethalSafeNotmidQtyThrottled(origin, variant.id, variant.available)
    } else if (variant.available) {
      qty = await scrapeVariantInventoryQty(origin, handle, variant.id)
      if (qty <= 0 && variant.available) {
        qty = 1
      }
    }
    variants.push({
      ...variant,
      inventoryQuantity: qty,
      available: qty > 0,
    })
  }

  const imageUrls = collectImageUrls(json, origin)
  const fromJsFeatured = buildVariantFeaturedImageByOption(json, origin)
  const variantIdToOption: Record<string, string> = {}
  for (const v of baseVariants) {
    const option = (v.option1 || v.title || '').trim()
    if (v.id && option) variantIdToOption[v.id] = option
  }
  const fromJsonFeatured = await fetchVariantFeaturedFromProductJson(
    origin,
    handle,
    variantIdToOption,
  )
  // .json variant_ids gana si existe; si no, featured_image del .js
  const variantFeaturedImageByOption = { ...fromJsFeatured, ...fromJsonFeatured }
  // Compat: URL → option (solo featured reales)
  const imageOptionByUrl: Record<string, string> = {}
  for (const [option, url] of Object.entries(variantFeaturedImageByOption)) {
    imageOptionByUrl[url] = option
  }
  const bodyHtml = (json.body_html || json.description || '').trim()
  const price = Math.min(...variants.map((v) => v.priceUsd))
  const inStock = variants.some((v) => v.available && v.inventoryQuantity > 0)

  return {
    provider,
    sourceUrl: productUrl,
    title: json.title.trim(),
    bodyHtml,
    vendor: (json.vendor || (provider === 'mk' ? 'MechanicalKeyboards' : 'Lethal')).trim(),
    handle,
    options: options.length ? options : [{ name: 'Title', values: variants.map((v) => v.title) }],
    variants,
    imageUrls,
    variantFeaturedImageByOption,
    imageOptionByUrl,
    price,
    inStock,
    shopifyHandle: handle,
  }
}

/** Lethal y MK son Shopify: usar /products/{handle}.js */
export async function fetchSupplierCatalog(
  provider: Provider,
  productUrl: string,
): Promise<SupplierCatalogProduct> {
  if (provider !== 'lethal' && provider !== 'mk') {
    throw new Error(`Proveedor desconocido: ${provider}`)
  }
  return catalogFromShopifyJs(provider, productUrl)
}
