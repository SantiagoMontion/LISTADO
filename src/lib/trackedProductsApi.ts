import { supabase } from './supabase'
import { formatHttpApiError, formatSupabaseOrError } from './errors'

export type TrackedProvider = 'lethal' | 'mk'

export type TrackedProduct = {
  id: string
  provider: TrackedProvider
  product_url: string
  shopify_handle: string | null
  product_title?: string | null
  notmid_shopify_variant_id: string | null
  notmid_shopify_product_id?: string | null
  current_price: number | null
  in_stock: boolean | null
  /** Min qty del último sync; <5 = rechequeo frecuente. */
  last_known_qty?: number | null
  last_checked: string | null
  is_active: boolean
}

export type TrackedProductInput = {
  provider: TrackedProvider
  product_url: string
  shopify_handle?: string | null
  notmid_shopify_variant_id?: string | null
  is_active?: boolean
}

export type CreatedShopifyInfo = {
  productId: string
  variantId: string
  adminUrl: string
  title: string
  price?: number
  imagesAttached?: number
  imageWarnings?: string[]
  variantMap?: Array<{
    supplierVariantId: string
    option: string
    notmidVariantId: string
    sku: string | null
  }>
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(formatSupabaseOrError(error))
  const session = data.session
  if (!session?.access_token) throw new Error('Tenés que iniciar sesión')

  const expiresAt = session.expires_at ?? 0
  const nowSec = Math.floor(Date.now() / 1000)
  if (expiresAt - nowSec < 300) {
    const refreshed = await supabase.auth.refreshSession()
    if (refreshed.error) throw new Error(formatSupabaseOrError(refreshed.error))
    const next = refreshed.data.session?.access_token
    if (!next) throw new Error('Tenés que iniciar sesión')
    return next
  }

  return session.access_token
}

async function apiFetch<T>(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  query?: string,
): Promise<T> {
  const token = await accessToken()
  const url = `${path}${query ? `?${query}` : ''}`
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean
    error?: unknown
    detail?: unknown
    message?: unknown
    products?: TrackedProduct[]
    product?: TrackedProduct
    shopify?: CreatedShopifyInfo
    quote?: { precio_contado_ars?: number; precio_cuotas_ars?: number }
  }
  if (!resp.ok || json.ok === false) {
    const errPayload = json.error ?? json.detail ?? json.message
    throw new Error(formatHttpApiError(errPayload, resp.status))
  }
  return json as T
}

export function extractLethalHandle(url: string): string | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/\/products\/([^/?#]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** Texto del link en la lista: título real, o handle legible, o URL. */
export function productLinkLabel(product: {
  product_title?: string | null
  shopify_handle?: string | null
  product_url: string
}): string {
  const title = (product.product_title ?? '').trim()
  if (title) return title

  const handle =
    (product.shopify_handle ?? '').trim() || extractLethalHandle(product.product_url) || ''
  if (handle) {
    return handle
      .split('-')
      .filter(Boolean)
      .map((part) => {
        if (/^[a-z0-9]{1,4}$/i.test(part) && /\d/.test(part)) return part.toUpperCase()
        if (part.length <= 2) return part.toUpperCase()
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(' ')
  }

  return product.product_url
}

/** Timeout/red caída — conviene reintentar en lotes grandes. */
export function isImportadosTransientError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('se agotó el tiempo') ||
    m.includes('error http 504') ||
    m.includes('error http 408') ||
    m.includes('error http 502') ||
    m.includes('error http 503') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed')
  )
}

/** Error de API cuando el link o producto ya está en seguimiento (409). */
export function isImportadosAlreadyTrackedError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('ya está en seguimiento') ||
    m.includes('ya está en la lista de seguimiento') ||
    m.includes('ya existe un producto con esa url')
  )
}

/** Extrae URLs de producto (una o varias) desde texto pegado. */
export function parseImportadosProductUrls(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const normalized = raw
    .replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ')
    .replace(/\r\n?/g, '\n')

  const urlRe =
    /https?:\/\/(?:[a-z0-9-]+\.)?(?:lethal\.gg|mechanicalkeyboards\.com)\/[^\s<>"')\]]+/gi

  for (const match of normalized.matchAll(urlRe)) {
    let url = match[0].replace(/[)\].,;]+$/, '')
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }

  return out
}

/** Detecta proveedor desde el link pegado. */
export function detectProviderFromUrl(url: string): TrackedProvider | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'lethal.gg' || host.endsWith('.lethal.gg')) return 'lethal'
    if (
      host === 'mechanicalkeyboards.com' ||
      host.endsWith('.mechanicalkeyboards.com')
    ) {
      return 'mk'
    }
    return null
  } catch {
    return null
  }
}

import { shopifyProductAdminUrl } from './shopifyOrderUrl'

export async function listTrackedProducts(): Promise<TrackedProduct[]> {
  const json = await apiFetch<{ products: TrackedProduct[] }>(
    '/api/importados-sync/products',
    'GET',
  )
  return (json.products ?? []).map((row) => ({
    ...row,
    current_price:
      row.current_price === null || row.current_price === undefined
        ? null
        : Number(row.current_price),
  }))
}

/** URL del producto en el admin de Shopify (NotMid). */
export async function resolveTrackedShopifyAdminUrl(
  product: TrackedProduct,
): Promise<string> {
  const productId = (product.notmid_shopify_product_id ?? '').trim()
  if (productId) {
    const url = shopifyProductAdminUrl(productId)
    if (url) return url
  }

  const variantId = (product.notmid_shopify_variant_id ?? '').trim()
  if (!variantId) {
    throw new Error('Este producto no está vinculado a Shopify')
  }

  const json = await apiFetch<{ url: string }>(
    '/api/importados-sync/products',
    'GET',
    undefined,
    `admin_for_variant=${encodeURIComponent(variantId)}`,
  )
  if (!json.url) throw new Error('No pude armar el link de Shopify')
  return json.url
}

export async function createTrackedProduct(
  input: TrackedProductInput,
): Promise<TrackedProduct> {
  let handle = input.shopify_handle?.trim() || null
  if (input.provider === 'lethal' && !handle) {
    handle = extractLethalHandle(input.product_url)
  }
  const json = await apiFetch<{ product: TrackedProduct }>(
    '/api/importados-sync/products',
    'POST',
    {
      provider: input.provider,
      product_url: input.product_url.trim(),
      shopify_handle: handle,
      notmid_shopify_variant_id: input.notmid_shopify_variant_id?.trim() || null,
      is_active: input.is_active ?? true,
    },
  )
  return json.product
}

/** Lee Lethal/MK, crea el producto en borrador en NotMid (precio cotizado) y lo agrega al sync. */
export async function createNotmidAndTrack(input: {
  provider: TrackedProvider
  product_url: string
  peso_kg: number
}): Promise<{
  product: TrackedProduct
  shopify: CreatedShopifyInfo
  message?: string
  quote?: { precio_contado_ars?: number; precio_cuotas_ars?: number }
}> {
  return apiFetch('/api/importados-sync/create-product', 'POST', {
    provider: input.provider,
    product_url: input.product_url.trim(),
    peso_kg: input.peso_kg,
  })
}

const CREATE_RETRY_ATTEMPTS = 3
const CREATE_RETRY_DELAY_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Igual que createNotmidAndTrack, con reintentos ante timeout/red (lotes grandes). */
export async function createNotmidAndTrackResilient(
  input: Parameters<typeof createNotmidAndTrack>[0],
  onRetry?: (attempt: number, error: string) => void,
): Promise<Awaited<ReturnType<typeof createNotmidAndTrack>>> {
  let lastError = 'Error desconocido'
  for (let attempt = 1; attempt <= CREATE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await createNotmidAndTrack(input)
    } catch (err) {
      lastError = formatSupabaseOrError(err)
      if (isImportadosAlreadyTrackedError(lastError)) throw err
      if (attempt < CREATE_RETRY_ATTEMPTS && isImportadosTransientError(lastError)) {
        onRetry?.(attempt + 1, lastError)
        await sleep(CREATE_RETRY_DELAY_MS * attempt)
        continue
      }
      throw err
    }
  }
  throw new Error(lastError)
}

export async function updateTrackedProductRow(
  id: string,
  patch: Partial<TrackedProductInput>,
): Promise<void> {
  await apiFetch('/api/importados-sync/products', 'PATCH', { id, ...patch })
}

export async function deleteTrackedProduct(id: string): Promise<void> {
  await apiFetch(
    '/api/importados-sync/products',
    'DELETE',
    undefined,
    `id=${encodeURIComponent(id)}`,
  )
}

export type VariantMapHealthItem = {
  id: string
  handle: string | null
  provider: string
  status: 'complete' | 'incomplete' | 'monitor_only'
  variantCount: number
  reason?: string
}

export type VariantMapHealthReport = {
  total: number
  complete: number
  incomplete: number
  monitorOnly: number
  items: VariantMapHealthItem[]
}

export async function fetchVariantMapHealth(): Promise<VariantMapHealthReport> {
  const json = await apiFetch<{ report: VariantMapHealthReport }>(
    '/api/importados-sync/variant-map-health',
    'GET',
  )
  return json.report
}

export async function repairVariantMaps(): Promise<{
  repaired: number
  failed: Array<{ id: string; handle: string | null; error: string }>
  report: VariantMapHealthReport
}> {
  return apiFetch('/api/importados-sync/variant-map-health', 'POST')
}

export async function syncTrackedProductStock(id: string): Promise<{
  shopifyRestocked?: boolean
  shopifyZeroed?: boolean
  locations?: string[]
  detail?: {
    inStock: boolean
    price: number
    quantities?: Array<{ option: string; qty: number; notmidVariantId: string }>
  }
  warnings?: string[]
  error?: string
}> {
  return apiFetch('/api/importados-sync/sync-product', 'POST', { id })
}

export type StockAuditVariantRow = {
  notmidVariantId: string
  label: string
  sku: string | null
  supplierQty: number | null
  shopifyQty: number
  status: 'ok' | 'mismatch' | 'missing_supplier' | 'repaired' | 'error'
  detail?: string
}

export type StockAuditProductRow = {
  id: string
  provider: string
  handle: string | null
  title: string
  url: string
  linked: boolean
  monitorOnly: boolean
  dbInStock: boolean | null
  catalogInStock: boolean | null
  locationName: string | null
  status: 'ok' | 'mismatch' | 'monitor_only' | 'unlinked' | 'error' | 'repaired'
  variants: StockAuditVariantRow[]
  error?: string
  warnings?: string[]
}

export type StockAuditReport = {
  at: string
  locationName: string | null
  total: number
  ok: number
  mismatch: number
  repaired: number
  monitorOnly: number
  errors: number
  products: StockAuditProductRow[]
  durationMs: number
}

/** Audita (y repara) un lote. El front llama en loop hasta cubrir todos. */
export async function runStockAuditBatch(input?: {
  offset?: number
  maxProducts?: number
  repair?: boolean
}): Promise<StockAuditReport> {
  return apiFetch('/api/importados-sync/stock-audit', 'POST', {
    offset: input?.offset ?? 0,
    maxProducts: input?.maxProducts ?? 6,
    repair: input?.repair !== false,
  })
}

export async function auditTrackedProductStock(
  id: string,
  repair = true,
): Promise<StockAuditProductRow> {
  const json = await apiFetch<{ product: StockAuditProductRow }>(
    '/api/importados-sync/stock-audit',
    'POST',
    { id, repair },
  )
  return json.product
}
