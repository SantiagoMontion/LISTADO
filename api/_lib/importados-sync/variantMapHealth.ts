import { fetchSupplierCatalog } from './supplierCatalog.js'
import { getProductIdFromVariant } from './shopify.js'
import { getShopifyEnv } from './env.js'
import {
  getSupabase,
  type TrackedProduct,
  type VariantMapEntry,
} from './supabase.js'
import {
  assessVariantMapHealth,
  type VariantMapHealthReport,
} from './variantMapAssess.js'

export {
  assessVariantMapHealth,
  type VariantMapHealthItem,
  type VariantMapHealthReport,
} from './variantMapAssess.js'

type ShopifyJson = Record<string, unknown>

type ShopifyVariant = {
  id?: number | string
  option1?: string | null
  option2?: string | null
  option3?: string | null
  sku?: string | null
  title?: string
}

export type VariantMapRepairResult = {
  repaired: number
  failed: Array<{ id: string; handle: string | null; error: string }>
  report: VariantMapHealthReport
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

function variantLabel(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' / ')
}

async function shopifyFetch(
  path: string,
): Promise<{ ok: boolean; status: number; json: ShopifyJson | null; text: string }> {
  const { domain, apiVersion, token } = getShopifyEnv()
  const url = `https://${domain}/admin/api/${apiVersion}/${path.replace(/^\//, '')}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
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

function normalizeTrackedRows(rows: unknown[]): TrackedProduct[] {
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>
    return {
      id: String(row.id),
      provider: row.provider as TrackedProduct['provider'],
      product_url: String(row.product_url ?? ''),
      shopify_handle:
        typeof row.shopify_handle === 'string' ? row.shopify_handle : null,
      notmid_shopify_variant_id:
        row.notmid_shopify_variant_id === null ||
        row.notmid_shopify_variant_id === undefined
          ? null
          : String(row.notmid_shopify_variant_id),
      notmid_shopify_product_id:
        row.notmid_shopify_product_id === null ||
        row.notmid_shopify_product_id === undefined
          ? null
          : String(row.notmid_shopify_product_id),
      variant_map: Array.isArray(row.variant_map)
        ? (row.variant_map as VariantMapEntry[])
        : null,
      current_price:
        row.current_price === null || row.current_price === undefined
          ? null
          : Number(row.current_price),
      in_stock: typeof row.in_stock === 'boolean' ? row.in_stock : null,
      last_known_qty:
        row.last_known_qty === null || row.last_known_qty === undefined
          ? null
          : Number(row.last_known_qty),
      peso_kg:
        row.peso_kg === null || row.peso_kg === undefined ? null : Number(row.peso_kg),
      oos_pending: {},
      last_checked:
        typeof row.last_checked === 'string' ? row.last_checked : null,
      is_active: Boolean(row.is_active),
    }
  })
}

export async function fetchTrackedProductsForHealth(): Promise<TrackedProduct[]> {
  const sb = getSupabase()
  const withMap = await sb
    .from('tracked_products')
    .select(
      'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_checked, is_active',
    )
    .order('created_at', { ascending: false })

  if (!withMap.error) {
    return normalizeTrackedRows(withMap.data ?? [])
  }

  if (/variant_map|column/i.test(withMap.error.message)) {
    throw new Error(
      'La columna variant_map no existe en Supabase. Aplicá la migración 003_tracked_products_variant_map.sql',
    )
  }

  if (/notmid_shopify_product_id|column/i.test(withMap.error.message)) {
    const fallback = await sb
      .from('tracked_products')
      .select(
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, variant_map, current_price, in_stock, last_checked, is_active',
      )
      .order('created_at', { ascending: false })
    if (fallback.error) throw new Error(fallback.error.message)
    return normalizeTrackedRows(
      (fallback.data ?? []).map((row) => ({
        ...row,
        notmid_shopify_product_id: null,
      })),
    )
  }

  throw new Error(withMap.error.message)
}

async function resolveNotmidProductId(product: TrackedProduct): Promise<string> {
  const fromCol = extractNumericId(product.notmid_shopify_product_id)
  if (fromCol) return fromCol
  const variantId = extractNumericId(product.notmid_shopify_variant_id)
  if (!variantId) {
    throw new Error('No hay product_id ni variant_id de NotMid')
  }
  return getProductIdFromVariant(variantId)
}

async function fetchNotmidVariants(productId: string): Promise<ShopifyVariant[]> {
  const { ok, status, json, text } = await shopifyFetch(
    `products/${productId}.json?fields=id,variants`,
  )
  if (!ok) {
    throw new Error(`Shopify product ${productId} failed (${status}): ${text.slice(0, 200)}`)
  }
  const product = json?.product as { variants?: ShopifyVariant[] } | undefined
  return product?.variants ?? []
}

function buildVariantMapFromSides(
  notmidVariants: ShopifyVariant[],
  supplierVariants: Array<{
    id: string
    option1: string | null
    option2: string | null
    option3: string | null
    title: string
    sku: string | null
  }>,
): VariantMapEntry[] {
  const byLabel = new Map<string, (typeof supplierVariants)[number]>()
  const bySku = new Map<string, (typeof supplierVariants)[number]>()

  for (const v of supplierVariants) {
    const label = variantLabel([v.option1, v.option2, v.option3]) || v.title.trim()
    if (label) byLabel.set(label.toLowerCase(), v)
    if (v.option1?.trim()) {
      const only = v.option1.trim().toLowerCase()
      if (!byLabel.has(only)) byLabel.set(only, v)
    }
    if (v.sku?.trim()) bySku.set(v.sku.trim().toLowerCase(), v)
  }

  const usedSupplier = new Set<string>()
  const map: VariantMapEntry[] = []

  for (const created of notmidVariants) {
    const notmidVariantId = extractNumericId(created.id)
    if (!notmidVariantId) continue

    const label = variantLabel([created.option1, created.option2, created.option3])
    let supplier =
      (label && byLabel.get(label.toLowerCase())) ||
      (created.option1 && byLabel.get(created.option1.trim().toLowerCase())) ||
      (created.sku && bySku.get(created.sku.trim().toLowerCase())) ||
      null

    // Último recurso: misma cantidad y mismo índice
    if (!supplier && notmidVariants.length === supplierVariants.length) {
      const idx = notmidVariants.indexOf(created)
      supplier = supplierVariants[idx] ?? null
    }

    // Un solo supplier + un solo notmid
    if (!supplier && notmidVariants.length === 1 && supplierVariants.length === 1) {
      supplier = supplierVariants[0]
    }

    if (!supplier || usedSupplier.has(supplier.id)) {
      continue
    }
    usedSupplier.add(supplier.id)

    map.push({
      supplierVariantId: supplier.id,
      option: label || supplier.title || 'Default',
      notmidVariantId,
      sku: created.sku || supplier.sku || null,
    })
  }

  if (!map.length) {
    throw new Error('No pude emparejar variantes NotMid ↔ proveedor')
  }
  if (map.length < notmidVariants.length) {
    // Parcial: todavía útil si al menos algunas matchean; pero marcamos incompleto si faltan
    // Preferimos fallar si perdimos más de la mitad
    if (map.length < Math.ceil(notmidVariants.length / 2)) {
      throw new Error(
        `Solo emparejé ${map.length} de ${notmidVariants.length} variantes`,
      )
    }
  }

  return map
}

export async function repairTrackedProductVariantMap(
  product: TrackedProduct,
): Promise<VariantMapEntry[]> {
  const productId = await resolveNotmidProductId(product)
  const [notmidVariants, catalog] = await Promise.all([
    fetchNotmidVariants(productId),
    fetchSupplierCatalog(product.provider, product.product_url),
  ])

  if (!notmidVariants.length) {
    throw new Error('El producto NotMid no tiene variantes')
  }
  if (!catalog.variants.length) {
    throw new Error('El proveedor no devolvió variantes')
  }

  const map = buildVariantMapFromSides(
    notmidVariants,
    catalog.variants.map((v) => ({
      id: v.id,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      title: v.title,
      sku: v.sku,
    })),
  )

  const sb = getSupabase()
  const patch: Record<string, unknown> = {
    variant_map: map,
    notmid_shopify_product_id: productId,
    updated_at: new Date().toISOString(),
  }
  // Asegurar primera variante
  if (!extractNumericId(product.notmid_shopify_variant_id) && map[0]?.notmidVariantId) {
    patch.notmid_shopify_variant_id = map[0].notmidVariantId
  }

  const { error } = await sb.from('tracked_products').update(patch).eq('id', product.id)
  if (error) throw new Error(error.message)
  return map
}

export async function repairIncompleteVariantMaps(): Promise<VariantMapRepairResult> {
  const products = await fetchTrackedProductsForHealth()
  const before = assessVariantMapHealth(products)
  const incompleteIds = new Set(
    before.items.filter((i) => i.status === 'incomplete').map((i) => i.id),
  )

  const failed: VariantMapRepairResult['failed'] = []
  let repaired = 0

  for (const product of products) {
    if (!incompleteIds.has(product.id)) continue
    try {
      await repairTrackedProductVariantMap(product)
      repaired += 1
      // Evitar martillar Lethal/MK
      await new Promise((r) => setTimeout(r, 700))
    } catch (err) {
      failed.push({
        id: product.id,
        handle: product.shopify_handle,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const afterProducts = await fetchTrackedProductsForHealth()
  return {
    repaired,
    failed,
    report: assessVariantMapHealth(afterProducts),
  }
}
