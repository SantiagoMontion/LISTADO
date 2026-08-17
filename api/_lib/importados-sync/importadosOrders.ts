import { getShopifyEnv } from './env.js'
import {
  fetchActiveTrackedProducts,
  type TrackedProduct,
  type VariantMapEntry,
} from './supabase.js'

type ShopifyJson = Record<string, unknown>

export type ShopifyLineItem = {
  id?: number | string
  product_id?: number | string | null
  variant_id?: number | string | null
  title?: string
  name?: string
  variant_title?: string | null
  quantity?: number
  sku?: string | null
  price?: string | number | null
  total_discount?: string | number | null
  fulfillable_quantity?: number
  fulfillment_status?: string | null
}

export type ShopifyOrder = {
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
  /** Una URL por unidad a pedir (vacío si no hay variante de proveedor exacta). */
  supplierUrls: string[]
  provider: 'lethal' | 'mk' | null
  trackedProductId: string | null
  notmidVariantId: string | null
  supplierVariantId: string | null
  /** Producto trackeado pero sin match exacto de variante. */
  unmatchedVariant: boolean
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

export type TrackedLineMatch = {
  product: TrackedProduct
  entry: VariantMapEntry | null
  unmatchedVariant: boolean
}

export type TrackedIndex = {
  byVariantId: Map<string, { product: TrackedProduct; entry: VariantMapEntry | null }>
  byProductId: Map<string, TrackedProduct[]>
  bySku: Map<string, { product: TrackedProduct; entry: VariantMapEntry | null }[]>
}

export function extractNumericId(value: unknown): string | null {
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

function parseShopifyMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const n = Number.parseFloat(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Precio cobrado en la línea (precio unitario × qty − descuento). */
export function lineRevenueArs(line: ShopifyLineItem): number {
  const qty = Math.max(0, Math.trunc(line.quantity ?? 0))
  const unit = parseShopifyMoney(line.price)
  const discount = parseShopifyMoney(line.total_discount)
  return Math.max(0, unit * qty - discount)
}

export function argentinaMonthKey(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date()
  const valid = Number.isNaN(d.getTime()) ? new Date() : d
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(valid)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${year}-${month}`
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

const SHOPIFY_ORDER_FIELDS =
  'id,name,created_at,financial_status,fulfillment_status,line_items'

/** Limpia tracking params del proveedor y fija la variante exacta. */
export function buildSupplierVariantUrl(
  productUrl: string,
  supplierVariantId: string | null,
): string {
  try {
    const u = new URL(productUrl)
    u.hash = ''
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

export function expandSupplierUrls(url: string | null, quantity: number): string[] {
  const qty = Math.max(0, Math.trunc(quantity))
  if (!url || qty <= 0) return []
  return Array.from({ length: qty }, () => url)
}

export function normalizeOption(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeSku(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function buildTrackedIndex(products: TrackedProduct[]): TrackedIndex {
  const byVariantId = new Map<
    string,
    { product: TrackedProduct; entry: VariantMapEntry | null }
  >()
  const byProductId = new Map<string, TrackedProduct[]>()
  const bySku = new Map<string, { product: TrackedProduct; entry: VariantMapEntry | null }[]>()

  const pushSku = (
    sku: string | null | undefined,
    hit: { product: TrackedProduct; entry: VariantMapEntry | null },
  ) => {
    const key = normalizeSku(sku)
    if (!key) return
    const bucket = bySku.get(key) ?? []
    bucket.push(hit)
    bySku.set(key, bucket)
  }

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
        pushSku(entry.sku, { product, entry })
      }
    }

    const legacyVariant = extractNumericId(product.notmid_shopify_variant_id)
    if (legacyVariant && !byVariantId.has(legacyVariant)) {
      byVariantId.set(legacyVariant, { product, entry: null })
    }
  }

  return { byVariantId, byProductId, bySku }
}

export function resolveTrackedForLine(
  line: ShopifyLineItem,
  index: TrackedIndex,
): TrackedLineMatch | null {
  const variantId = extractNumericId(line.variant_id)
  if (variantId) {
    const hit = index.byVariantId.get(variantId)
    if (hit) return { ...hit, unmatchedVariant: false }
  }

  const productId = extractNumericId(line.product_id)
  const sku = normalizeSku(line.sku)
  const variantTitle = normalizeOption(line.variant_title)
  const candidates = productId ? (index.byProductId.get(productId) ?? []) : []

  if (sku) {
    const scopedSkuHits: { product: TrackedProduct; entry: VariantMapEntry | null }[] = []
    for (const product of candidates) {
      for (const entry of product.variant_map ?? []) {
        if (normalizeSku(entry.sku) === sku) scopedSkuHits.push({ product, entry })
      }
    }
    if (scopedSkuHits.length === 1) {
      return { ...scopedSkuHits[0], unmatchedVariant: false }
    }

    const globalSku = index.bySku.get(sku) ?? []
    if (globalSku.length === 1) {
      const hit = globalSku[0]
      const hitProductId = extractNumericId(hit.product.notmid_shopify_product_id)
      if (!productId || hitProductId === productId) {
        return { ...hit, unmatchedVariant: false }
      }
    }
  }

  if (variantTitle && candidates.length) {
    const optionHits: { product: TrackedProduct; entry: VariantMapEntry }[] = []
    for (const product of candidates) {
      for (const entry of product.variant_map ?? []) {
        if (normalizeOption(entry.option) === variantTitle) {
          optionHits.push({ product, entry })
        }
      }
    }
    if (optionHits.length === 1) {
      return { ...optionHits[0], unmatchedVariant: false }
    }
  }

  if (candidates.length === 1) {
    const product = candidates[0]
    const map = product.variant_map ?? []
    if (map.length <= 1) {
      return { product, entry: map[0] ?? null, unmatchedVariant: false }
    }
    return { product, entry: null, unmatchedVariant: true }
  }

  return null
}

export function supplierUrlForMatch(match: TrackedLineMatch): string | null {
  if (match.unmatchedVariant) return null
  const supplierVariantId = match.entry?.supplierVariantId?.trim() || null
  const mapCount = match.product.variant_map?.length ?? 0
  if (!supplierVariantId && mapCount > 1) return null
  return buildSupplierVariantUrl(match.product.product_url, supplierVariantId)
}

export function lineStillNeedsFulfillment(line: ShopifyLineItem): number {
  if (typeof line.fulfillable_quantity === 'number') {
    return Math.max(0, Math.trunc(line.fulfillable_quantity))
  }
  if (line.fulfillment_status === 'fulfilled') return 0
  return Math.max(0, Math.trunc(line.quantity ?? 0))
}

export function mapShopifyLineToOrderLine(
  orderId: string,
  line: ShopifyLineItem,
  index: TrackedIndex,
  quantity: number,
): ImportadosOrderLine {
  const matched = resolveTrackedForLine(line, index)
  const title = (line.title || line.name || 'Producto').trim()
  const variantTitle = line.variant_title?.trim() || null
  const lineItemId =
    extractNumericId(line.id) || `${orderId}-${line.variant_id || line.title || 'line'}`

  if (!matched) {
    return {
      lineItemId,
      title,
      variantTitle,
      quantity,
      supplierUrls: [],
      provider: null,
      trackedProductId: null,
      notmidVariantId: extractNumericId(line.variant_id),
      supplierVariantId: null,
      unmatchedVariant: false,
    }
  }

  const supplierUrl = supplierUrlForMatch(matched)
  return {
    lineItemId,
    title,
    variantTitle,
    quantity,
    supplierUrls: expandSupplierUrls(supplierUrl, quantity),
    provider: matched.product.provider,
    trackedProductId: matched.product.id,
    notmidVariantId:
      matched.entry?.notmidVariantId ||
      extractNumericId(line.variant_id) ||
      matched.product.notmid_shopify_variant_id,
    supplierVariantId: matched.entry?.supplierVariantId || null,
    unmatchedVariant: matched.unmatchedVariant || !supplierUrl,
  }
}

function throwIfShopifyDenied(status: number, text: string): void {
  if (status === 403 || status === 401) {
    throw new Error(
      `Shopify no autorizó leer pedidos (${status}). El token Admin necesita el scope read_orders.`,
    )
  }
  throw new Error(`Shopify orders failed (${status}): ${text.slice(0, 240)}`)
}

async function fetchPaidUnfulfilledOrders(): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = []
  for (const fulfillment of ['unfulfilled', 'partial']) {
    const { ok, status, json, text } = await shopifyFetch(
      `orders.json?status=open&financial_status=paid&fulfillment_status=${fulfillment}&limit=100&order=created_at+desc&fields=${SHOPIFY_ORDER_FIELDS}`,
    )
    if (!ok) throwIfShopifyDenied(status, text)
    const batch = (json?.orders as ShopifyOrder[] | undefined) ?? []
    orders.push(...batch)
  }

  const seen = new Set<string>()
  return orders.filter((o) => {
    const id = extractNumericId(o.id)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export async function fetchPaidOrdersSince(isoSince: string): Promise<ShopifyOrder[]> {
  const { ok, status, json, text } = await shopifyFetch(
    `orders.json?status=any&financial_status=paid&limit=250&order=created_at+desc&created_at_min=${encodeURIComponent(isoSince)}&fields=${SHOPIFY_ORDER_FIELDS}`,
  )
  if (!ok) throwIfShopifyDenied(status, text)
  return (json?.orders as ShopifyOrder[] | undefined) ?? []
}

export function mapShopifyOrdersToImportados(
  orders: ShopifyOrder[],
  tracked: TrackedProduct[],
): ImportadosOrderRow[] {
  const index = buildTrackedIndex(tracked)
  const rows: ImportadosOrderRow[] = []

  for (const order of orders) {
    const orderId = extractNumericId(order.id)
    if (!orderId) continue

    const lines: ImportadosOrderLine[] = []
    let hasTracked = false
    for (const line of order.line_items ?? []) {
      const qty = lineStillNeedsFulfillment(line)
      if (qty <= 0) continue

      const mapped = mapShopifyLineToOrderLine(orderId, line, index, qty)
      if (mapped.trackedProductId) hasTracked = true
      lines.push(mapped)
    }

    if (!hasTracked) continue
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

export async function listImportadosOrders(): Promise<ImportadosOrderRow[]> {
  const [orders, tracked] = await Promise.all([
    fetchPaidUnfulfilledOrders(),
    fetchActiveTrackedProducts(),
  ])
  return mapShopifyOrdersToImportados(orders, tracked)
}

export async function loadImportadosPedidosPage(): Promise<{
  orders: ImportadosOrderRow[]
  boardOrders: ShopifyOrder[]
  paidWindow: ShopifyOrder[]
  tracked: TrackedProduct[]
}> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 90)

  const [boardOrders, paidWindow, tracked] = await Promise.all([
    fetchPaidUnfulfilledOrders(),
    fetchPaidOrdersSince(since.toISOString()),
    fetchActiveTrackedProducts(),
  ])

  return {
    orders: mapShopifyOrdersToImportados(boardOrders, tracked),
    boardOrders,
    paidWindow,
    tracked,
  }
}
