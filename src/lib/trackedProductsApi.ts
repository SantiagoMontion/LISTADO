import { supabase } from './supabase'

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
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Tenés que iniciar sesión')
  return token
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
    error?: string
    products?: TrackedProduct[]
    product?: TrackedProduct
    shopify?: CreatedShopifyInfo
    message?: string
    quote?: { precio_contado_ars?: number; precio_cuotas_ars?: number }
  }
  if (!resp.ok || json.ok === false) {
    throw new Error(json.error || `Error HTTP ${resp.status}`)
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
