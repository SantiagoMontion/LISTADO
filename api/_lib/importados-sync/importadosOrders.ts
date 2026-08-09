import { getShopifyEnv } from './env.js'
import {
  fetchActiveTrackedProducts,
  type TrackedProduct,
  type VariantMapEntry,
} from './supabase.js'

type ShopifyJson = Record<string, unknown>

type ShopifyLineItem = {
  id?: number | string
  product_id?: number | string | null
  variant_id?: number | string | null
  title?: string
  name?: string
  variant_title?: string | null
  quantity?: number
  sku?: string | null
  fulfillable_quantity?: number
  fulfillment_status?: string | null
}

type ShopifyOrder = {
  id?: number | string
  name?: string
  created_at?: string
  financial_status?: string
  fulfillment_status?: string | null
  line_items?: ShopifyLineItem[]
}

export type ImportadosOrderLine = {
  lineItemId: string
  title: string
  variantTitle: string | null
  quantity: number
  /** Una URL por unidad a pedir (mismo link repetido si qty > 1). */
  supplierUrls: string[]
  provider: 'lethal' | 'mk'
  trackedProductId: string
  notmidVariantId: string | null
  supplierVariantId: string | null
}

export type ImportadosOrderRow = {
  orderId: string
  orderName: string
  createdAt: string
  financialStatus: string
  fulfillmentStatus: string | null
  adminUrl: string
  lines: ImportadosOrderLine[]
  /** Todas las URLs a abrir con «Hacer pedido» (ya expandido por cantidad). */
  allSupplierUrls: string[]
}

function extractNumericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const gidMatch = trimmed.match(/\/(\d+)\s*$/)
  if (gidMatch) return gidMatch[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

async function shopifyFetch(
  path: string,
): Promise<{ ok: boolean; status: number; json: ShopifyJson | null; text: string }> {
  const { domain, apiVersion, token } = getShopifyEnv()
  const url = `https://${domain}/admin/api/${apiVersion}/${path.replace(/^\//, '')}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Shopify-Access-Token': token,
      },
    })
    const text = await resp.text()
    let json: ShopifyJson | null = null
    try {
      json = text ? (JSON.parse(text) as ShopifyJson) : null
    } catch {
      json = null
    }
    return { ok: resp.ok, status: resp.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

function shopifyAdminOrderUrl(orderId: string): string {
  const { domain } = getShopifyEnv()
  const storeHandle = domain.replace(/\.myshopify\.com$/i, '')
  return `https://admin.shopify.com/store/${storeHandle}/orders/${orderId}`
}

/** Limpia tracking params del proveedor y fija la variante exacta. */
export function buildSupplierVariantUrl(
  productUrl: string,
  supplierVariantId: string | null,
): string {
  try {
    const u = new URL(productUrl)
    u.hash = ''
    // Tiramos params de búsqueda/listado del proveedor
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase() !== 'variant') u.searchParams.delete(key)
    }
    if (supplierVariantId) u.searchParams.set('variant', supplierVariantId)
    else u.searchParams.delete('variant')
    return u.toString()
  } catch {
    return productUrl
  }
}

function normalizeOption(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

type TrackedIndex = {
  byVariantId: Map<string, { product: TrackedProduct; entry: VariantMapEntry | null }>
  byProductId: Map<string, TrackedProduct[]>
}

function buildTrackedIndex(products: TrackedProduct[]): TrackedIndex {
  const byVariantId = new Map<
    string,
    { product: TrackedProduct; entry: VariantMapEntry | null }
  >()
  const byProductId = new Map<string, TrackedProduct[]>()

  for (const product of products) {
    const productId = extractNumericId(product.notmid_shopify_product_id)
    if (productId) {
      const bucket = byProductId.get(productId) ?? []
      bucket.push(product)
      byProductId.set(productId, bucket)
    }

    if (product.variant_map?.length) {
      for (const entry of product.variant_map) {
        const vid = extractNumericId(entry.notmidVariantId)
        if (vid) byVariantId.set(vid, { product, entry })
      }
    }

    const legacyVariant = extractNumericId(product.notmid_shopify_variant_id)
    if (legacyVariant && !byVariantId.has(legacyVariant)) {
      byVariantId.set(legacyVariant, { product, entry: null })
    }
  }

  return { byVariantId, byProductId }
}

function resolveTrackedForLine(
  line: ShopifyLineItem,
  index: TrackedIndex,
): { product: TrackedProduct; entry: VariantMapEntry | null } | null {
  const variantId = extractNumericId(line.variant_id)
  if (variantId) {
    const hit = index.byVariantId.get(variantId)
    if (hit) return hit
  }

  const productId = extractNumericId(line.product_id)
  if (!productId) return null
  const candidates = index.byProductId.get(productId) ?? []
  if (!candidates.length) return null

  const variantTitle = normalizeOption(line.variant_title)
  if (variantTitle) {
    for (const product of candidates) {
      const entry =
        product.variant_map?.find((e) => {
          const option = normalizeOption(e.option)
          return (
            option === variantTitle ||
            option.includes(variantTitle) ||
            variantTitle.includes(option)
          )
        }) ?? null
      if (entry) return { product, entry }
    }
  }

  return { product: candidates[0], entry: null }
}

function lineStillNeedsFulfillment(line: ShopifyLineItem): number {
  if (typeof line.fulfillable_quantity === 'number') {
    return Math.max(0, Math.trunc(line.fulfillable_quantity))
  }
  if (line.fulfillment_status === 'fulfilled') return 0
  return Math.max(0, Math.trunc(line.quantity ?? 0))
}

async function fetchPaidUnfulfilledOrders(): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = []
  // Shopify paginación por page_info es más compleja; con limit 100 alcanza para ops diarias.
  // Pedidos pagados abiertos: unfulfilled + null (Shopify usa null cuando no hay fulfillment).
  for (const fulfillment of ['unfulfilled', 'partial']) {
    const { ok, status, json, text } = await shopifyFetch(
      `orders.json?status=open&financial_status=paid&fulfillment_status=${fulfillment}&limit=100&order=created_at+desc&fields=id,name,created_at,financial_status,fulfillment_status,line_items`,
    )
    if (!ok) {
      if (status === 403 || status === 401) {
        throw new Error(
          `Shopify no autorizó leer pedidos (${status}). El token Admin necesita el scope read_orders.`,
        )
      }
      throw new Error(`Shopify orders failed (${status}): ${text.slice(0, 240)}`)
    }
    const batch = (json?.orders as ShopifyOrder[] | undefined) ?? []
    orders.push(...batch)
  }

  // Dedup por id (por si un pedido aparece en más de un filtro)
  const seen = new Set<string>()
  return orders.filter((o) => {
    const id = extractNumericId(o.id)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export async function listImportadosOrders(): Promise<ImportadosOrderRow[]> {
  const [orders, tracked] = await Promise.all([
    fetchPaidUnfulfilledOrders(),
    fetchActiveTrackedProducts(),
  ])
  const index = buildTrackedIndex(tracked)
  const rows: ImportadosOrderRow[] = []

  for (const order of orders) {
    const orderId = extractNumericId(order.id)
    if (!orderId) continue

    const lines: ImportadosOrderLine[] = []
    for (const line of order.line_items ?? []) {
      const qty = lineStillNeedsFulfillment(line)
      if (qty <= 0) continue

      const matched = resolveTrackedForLine(line, index)
      if (!matched) continue

      const supplierVariantId =
        matched.entry?.supplierVariantId ||
        // Si no hay map, igual abrimos el PDP del proveedor
        null
      const supplierUrl = buildSupplierVariantUrl(
        matched.product.product_url,
        supplierVariantId,
      )
      const supplierUrls = Array.from({ length: qty }, () => supplierUrl)

      lines.push({
        lineItemId: extractNumericId(line.id) || `${orderId}-${line.variant_id}`,
        title: (line.title || line.name || 'Producto').trim(),
        variantTitle: line.variant_title?.trim() || null,
        quantity: qty,
        supplierUrls,
        provider: matched.product.provider,
        trackedProductId: matched.product.id,
        notmidVariantId:
          matched.entry?.notmidVariantId ||
          extractNumericId(line.variant_id) ||
          matched.product.notmid_shopify_variant_id,
        supplierVariantId,
      })
    }

    if (!lines.length) continue

    const allSupplierUrls = lines.flatMap((l) => l.supplierUrls)
    rows.push({
      orderId,
      orderName: (order.name || `#${orderId}`).trim(),
      createdAt: order.created_at || '',
      financialStatus: order.financial_status || 'paid',
      fulfillmentStatus: order.fulfillment_status ?? null,
      adminUrl: shopifyAdminOrderUrl(orderId),
      lines,
      allSupplierUrls,
    })
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return rows
}
