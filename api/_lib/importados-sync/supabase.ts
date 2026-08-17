import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv, type Provider } from './env.js'
import { parseOosPending, type OosPendingMap } from './inventoryWritePolicy.js'

export type VariantMapEntry = {
  supplierVariantId: string
  option: string
  notmidVariantId: string
  sku: string | null
  /** Peso Aerobox (kg) tipeado en el Hub. Vive en NOTBRAIN, no en Shopify. */
  peso_kg?: number | null
}

export type TrackedProduct = {
  id: string
  provider: Provider
  product_url: string
  shopify_handle: string | null
  notmid_shopify_variant_id: string | null
  notmid_shopify_product_id: string | null
  variant_map: VariantMapEntry[] | null
  current_price: number | null
  in_stock: boolean | null
  /** Min qty entre variantes tras el último sync (TTL de rechequeo). */
  last_known_qty: number | null
  /** Peso paquete kg (cotización). */
  peso_kg: number | null
  /** Primera señal OOS por variante NotMid (doble confirmación). */
  oos_pending: OosPendingMap
  last_checked: string | null
  is_active: boolean
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client
  const { url, serviceRoleKey } = getSupabaseEnv()
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export function pesoKgFromTracked(product: {
  peso_kg?: number | null
  variant_map?: VariantMapEntry[] | null
}): number | null {
  const stored = Number(product.peso_kg)
  if (Number.isFinite(stored) && stored > 0) return stored
  for (const entry of product.variant_map ?? []) {
    const fromMap = Number(entry.peso_kg)
    if (Number.isFinite(fromMap) && fromMap > 0) return fromMap
  }
  return null
}

/** Cotización: kg de esa variante NotMid; si no hay, el kg del producto. */
export function pesoKgForNotmidVariant(
  product: {
    peso_kg?: number | null
    variant_map?: VariantMapEntry[] | null
  },
  notmidVariantId: string | null | undefined,
): number | null {
  const id = String(notmidVariantId ?? '').trim()
  if (id) {
    const hit = (product.variant_map ?? []).find((entry) => String(entry.notmidVariantId) === id)
    const fromHit = Number(hit?.peso_kg)
    if (Number.isFinite(fromHit) && fromHit > 0) return fromHit
  }
  return pesoKgFromTracked(product)
}

export function variantMapWithPesoKg(
  map: VariantMapEntry[] | null | undefined,
  pesoKg: number,
): VariantMapEntry[] {
  return (map ?? []).map((entry) => ({ ...entry, peso_kg: pesoKg }))
}

export function normalizeTrackedProduct(row: Record<string, unknown>): TrackedProduct {
  const variantMap = Array.isArray(row.variant_map)
    ? (row.variant_map as TrackedProduct['variant_map'])
    : null
  return {
    id: String(row.id),
    provider: row.provider as TrackedProduct['provider'],
    product_url: String(row.product_url ?? ''),
    shopify_handle: typeof row.shopify_handle === 'string' ? row.shopify_handle : null,
    notmid_shopify_variant_id:
      row.notmid_shopify_variant_id === null || row.notmid_shopify_variant_id === undefined
        ? null
        : String(row.notmid_shopify_variant_id),
    notmid_shopify_product_id:
      row.notmid_shopify_product_id === null || row.notmid_shopify_product_id === undefined
        ? null
        : String(row.notmid_shopify_product_id),
    variant_map: variantMap,
    current_price:
      row.current_price === null || row.current_price === undefined
        ? null
        : Number(row.current_price),
    in_stock: typeof row.in_stock === 'boolean' ? row.in_stock : null,
    last_known_qty:
      row.last_known_qty === null || row.last_known_qty === undefined
        ? null
        : Number(row.last_known_qty),
    peso_kg: pesoKgFromTracked({
      peso_kg:
        row.peso_kg === null || row.peso_kg === undefined ? null : Number(row.peso_kg),
      variant_map: variantMap,
    }),
    oos_pending: parseOosPending(row.oos_pending),
    last_checked: typeof row.last_checked === 'string' ? row.last_checked : null,
    is_active: Boolean(row.is_active),
  }
}

export async function fetchActiveTrackedProducts(): Promise<TrackedProduct[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('tracked_products')
    .select(
      'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, peso_kg, oos_pending, last_checked, is_active',
    )
    .eq('is_active', true)

  if (!error) {
    return (data ?? []).map((row) => normalizeTrackedProduct(row))
  }

  // Fallback si migration 008 aún no está
  if (/oos_pending/i.test(error.message)) {
    const noPending = await supabase
      .from('tracked_products')
      .select(
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, peso_kg, last_checked, is_active',
      )
      .eq('is_active', true)
    if (!noPending.error) {
      return (noPending.data ?? []).map((row) =>
        normalizeTrackedProduct({ ...row, oos_pending: {} }),
      )
    }
  }

  // Fallback if migration 007 / 006 / 003 not applied yet
  const fallback = await supabase
    .from('tracked_products')
    .select(
      'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, last_checked, is_active',
    )
    .eq('is_active', true)
  if (!fallback.error) {
    return (fallback.data ?? []).map((row) =>
      normalizeTrackedProduct({ ...row, peso_kg: null, oos_pending: {} }),
    )
  }
  const noQty = await supabase
    .from('tracked_products')
    .select(
      'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_checked, is_active',
    )
    .eq('is_active', true)
  if (noQty.error) {
    const legacy = await supabase
      .from('tracked_products')
      .select(
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
      )
      .eq('is_active', true)
    if (legacy.error) {
      throw new Error(`Supabase fetch tracked_products failed: ${error.message}`)
    }
    return (legacy.data ?? []).map((row) =>
      normalizeTrackedProduct({
        ...row,
        notmid_shopify_product_id: null,
        variant_map: null,
        last_known_qty: null,
        peso_kg: null,
        oos_pending: {},
      }),
    )
  }
  return (noQty.data ?? []).map((row) =>
    normalizeTrackedProduct({ ...row, last_known_qty: null, peso_kg: null, oos_pending: {} }),
  )
}

export async function updateTrackedProduct(
  id: string,
  patch: {
    current_price?: number
    in_stock?: boolean
    last_known_qty?: number | null
    peso_kg?: number | null
    oos_pending?: OosPendingMap
    /** Omitir para no avanzar TTL (p.ej. heal fallido / needs_restock). */
    last_checked?: string
  },
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('tracked_products')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    // Columnas nuevas pueden no existir aún
    if (/oos_pending|last_known_qty|peso_kg/i.test(error.message)) {
      const {
        last_known_qty: _q,
        peso_kg: _p,
        oos_pending: _o,
        ...rest
      } = patch
      const retry = await supabase
        .from('tracked_products')
        .update({
          ...rest,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (!retry.error) return
      throw new Error(
        `Supabase update tracked_products(${id}) failed: ${retry.error.message}`,
      )
    }
    throw new Error(`Supabase update tracked_products(${id}) failed: ${error.message}`)
  }
}
