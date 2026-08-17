import * as cheerio from 'cheerio'
import type { Provider } from './env.js'
import { lethalSafeNotmidQtyThrottledDetailed } from './lethalCartStock.js'
import { BROWSER_HEADERS, fetchWithRetries, fetchWithTimeout, parsePrice } from './providers/types.js'

export type SupplierVariant = {
  id: string
  title: string
  option1: string | null
  option2: string | null
  option3: string | null
  sku: string | null
  priceUsd: number
  /** Peso del ítem en kg si el proveedor lo publica (grams/1000). */
  weightKg: number | null
  /** Flag `available` del .js del proveedor (antes de sondear). */
  storefrontAvailable: boolean
  available: boolean
  inventoryQuantity: number
  /**
   * false = la qty es dudosa (timeout/rate-limit/no probeado).
   * El sync no debe pisar NotMid si no es confiable.
   */
  inventoryReliable: boolean
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
    grams?: number
    featured_image?: { src?: string; variant_ids?: number[] } | null
  }>
  images?: Array<string | { src?: string }>
  media?: Array<{ src?: string; alt?: string | null; media_type?: string }>
}

/** Lethal sin www suele pegar Cloudflare 429; el storefront estable es www. */
function resolveStorefrontOrigin(productUrl: string): string {
  try {
    const u = new URL(productUrl.includes('://') ? productUrl : `https://${productUrl}`)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'lethal.gg') return 'https://www.lethal.gg'
    return u.origin
  } catch {
    return new URL(productUrl).origin
  }
}

async function fetchShopifyProductJs(productUrl: string): Promise<{
  json: ShopifyStorefrontProduct
  handle: string
  origin: string
}> {
  const handle = extractHandleFromUrl(productUrl)
  if (!handle) throw new Error('No pude leer el handle del producto desde el link')
  const origin = resolveStorefrontOrigin(productUrl)
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
): Promise<{ qty: number; reliable: boolean }> {
  const url = `${origin}/products/${encodeURIComponent(handle)}?variant=${encodeURIComponent(variantId)}`
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    })
    if (!resp.ok) return { qty: 0, reliable: false }
    const html = await resp.text()
    const $ = cheerio.load(html)
    const info = $('#inventory_info').text().replace(/\s+/g, ' ').trim()
    const qtyMatch = info.match(/(\d+)\s+in\s+stock/i)
    if (qtyMatch) return { qty: Number(qtyMatch[1]), reliable: true }
    if (/out\s+of\s+stock|sold\s*out/i.test(info)) return { qty: 0, reliable: true }
    // Sin texto claro de stock: no asumir 0.
    return { qty: 0, reliable: false }
  } catch {
    return { qty: 0, reliable: false }
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

/** Alta: sondear carrito si hay pocas variantes (RCC-1 = 1). Beast G ×21 se deja al cron. */
export const CREATE_CART_PROBE_MAX_VARIANTS = 8

export type FetchCatalogOptions = {
  /**
   * `full` (default): crea producto — imágenes + stock de todas las variantes.
   * `inventory`: solo stock; salta imágenes y puede limitar probes a ciertos ids.
   */
  mode?: 'full' | 'inventory'
  /** Si se setea, Lethal/MK solo miden stock de estos variant ids (+ los unavailable → 0). */
  probeVariantIds?: string[]
  /**
   * Alta de producto: no sondear carrito (21 variantes × ~1.5s = timeout Vercel).
   * Usa el flag `available` del .js (1 o 0); el cron de sync ajusta qty real después.
   */
  skipStockProbe?: boolean
}

async function catalogFromShopifyJs(
  provider: Provider,
  productUrl: string,
  options: FetchCatalogOptions = {},
): Promise<SupplierCatalogProduct> {
  const mode = options.mode ?? 'full'
  const probeSet =
    options.probeVariantIds && options.probeVariantIds.length
      ? new Set(options.probeVariantIds.map(String))
      : null

  const { json, handle, origin } = await fetchShopifyProductJs(productUrl)
  if (!json.title) throw new Error('El proveedor no devolvió título de producto')

  const productOptions = (json.options ?? [])
    .filter((o) => o.name && Array.isArray(o.values) && o.values.length)
    .map((o) => ({ name: String(o.name), values: (o.values ?? []).map(String) }))

  const baseVariants = (json.variants ?? []).map((v) => {
    const id = String(v.id ?? '')
    const priceUsd = centsToUsd(v.price)
    const grams = typeof v.grams === 'number' && Number.isFinite(v.grams) ? v.grams : null
    return {
      id,
      title: (v.title || v.option1 || 'Default').trim(),
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      sku: v.sku?.trim() || null,
      priceUsd: priceUsd ?? 0,
      weightKg: grams && grams > 0 ? grams / 1000 : null,
      storefrontAvailable: Boolean(v.available),
      available: Boolean(v.available),
      inventoryQuantity: 0,
      inventoryReliable: true,
      featuredImageUrl: absUrl(v.featured_image?.src, origin),
    } satisfies SupplierVariant
  }).filter((v) => v.id && v.priceUsd > 0)

  if (!baseVariants.length) throw new Error('El producto no tiene variantes usable')

  // Stock por variante:
  // - MK: número real desde #inventory_info (si no hay número pero available → 1)
  // - Lethal: sin unidades públicas → sondear el carrito y usar (lo que acepta − 1)
  // - skipStockProbe (alta): solo flag available → 1/0 (el cron ajusta después)
  const variants: SupplierVariant[] = []
  for (const base of baseVariants) {
    let variant = base
    let qty = 0
    let reliable = true

    if (options.skipStockProbe) {
      qty = variant.storefrontAvailable ? 1 : 0
      reliable = true
      variants.push({
        ...variant,
        inventoryQuantity: qty,
        inventoryReliable: reliable,
        available: qty > 0,
      })
      continue
    }

    const shouldProbe = !probeSet || probeSet.has(variant.id) || variant.storefrontAvailable
    if (!shouldProbe) {
      // No sondeada y OOS en storefront: no inventar qty.
      variants.push({
        ...variant,
        inventoryQuantity: 0,
        inventoryReliable: false,
        available: false,
      })
      continue
    }
    if (provider === 'lethal') {
      const delayMs = mode === 'inventory' ? 1100 : 1600
      const probed = await lethalSafeNotmidQtyThrottledDetailed(
        origin,
        variant.id,
        variant.storefrontAvailable,
        delayMs,
        {
          recheckStorefrontAvailable: async () => {
            const fresh = await fetchShopifyProductJs(productUrl)
            const hit = (fresh.json.variants ?? []).find((v) => String(v.id) === variant.id)
            return Boolean(hit?.available)
          },
        },
      )
      qty = probed.qty
      reliable = probed.reliable
      // Si el recheck descubrió stock, el flag original mentía.
      if (probed.reliable && probed.qty > 0 && !variant.storefrontAvailable) {
        variant = { ...variant, storefrontAvailable: true }
      }
    } else if (variant.storefrontAvailable) {
      const scraped = await scrapeVariantInventoryQty(origin, handle, variant.id)
      if (scraped.reliable) {
        qty = scraped.qty
        reliable = true
      } else {
        // .js available pero scrape dudoso → no confiar (ni un 0 ni inventar 1 reliable).
        qty = scraped.qty > 0 ? scraped.qty : 1
        reliable = false
      }
      if (qty <= 0 && variant.storefrontAvailable) {
        qty = 1
        reliable = false
      }
    } else {
      // MK .js unavailable: OOS a nivel flag.
      qty = 0
      reliable = true
    }
    variants.push({
      ...variant,
      inventoryQuantity: qty,
      inventoryReliable: reliable,
      // available operativo; storefrontAvailable se conserva en el spread.
      available: qty > 0,
    })
  }

  let imageUrls: string[] = []
  let variantFeaturedImageByOption: Record<string, string> = {}
  let imageOptionByUrl: Record<string, string> = {}

  if (mode === 'full') {
    imageUrls = collectImageUrls(json, origin)
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
    variantFeaturedImageByOption = { ...fromJsFeatured, ...fromJsonFeatured }
    for (const [option, url] of Object.entries(variantFeaturedImageByOption)) {
      imageOptionByUrl[url] = option
    }
  }

  const bodyHtml =
    mode === 'full' ? (json.body_html || json.description || '').trim() : ''
  const price = Math.min(...variants.map((v) => v.priceUsd))
  const inStock = variants.some((v) => v.available && v.inventoryQuantity > 0)

  return {
    provider,
    sourceUrl: productUrl,
    title: json.title.trim(),
    bodyHtml,
    vendor: (json.vendor || (provider === 'mk' ? 'MechanicalKeyboards' : 'Lethal')).trim(),
    handle,
    options: productOptions.length
      ? productOptions
      : [{ name: 'Title', values: variants.map((v) => v.title) }],
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
  options?: FetchCatalogOptions,
): Promise<SupplierCatalogProduct> {
  if (provider !== 'lethal' && provider !== 'mk') {
    throw new Error(`Proveedor desconocido: ${provider}`)
  }
  return catalogFromShopifyJs(provider, productUrl, options)
}
